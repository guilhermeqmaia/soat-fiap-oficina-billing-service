import { Dinheiro } from './dinheiro.vo';
import { ResultadoOrder } from './resultado-order';
import {
  EstadoCallback,
  EventoCallback,
  Lancamento,
  StatusCobranca,
  TipoLancamento,
} from './tipos';

export interface CobrancaProps {
  readonly id: string;
  readonly orcamentoId: string;
  readonly numeroOS: string;
  readonly tentativa: number;
  readonly idempotencyKey: string;
  readonly valor: Dinheiro;
  orderId: string | null;
  linkPagamento: string | null;
  status: StatusCobranca;
  pagoEm: Date | null;
  recusadaEm: Date | null;
  motivoRecusa: string | null;
  version: number;
  callback: EstadoCallback | null;
}

export interface CriarCobrancaInput {
  readonly id: string;
  readonly orcamentoId: string;
  readonly numeroOS: string;
  readonly tentativa: number;
  readonly valor: Dinheiro;
}

export class Cobranca {
  private constructor(private readonly props: CobrancaProps) {}

  static criar(input: CriarCobrancaInput): Cobranca {
    return new Cobranca({
      ...input,
      idempotencyKey: `cobranca:${input.numeroOS}:${input.tentativa}`,
      orderId: null,
      linkPagamento: null,
      status: StatusCobranca.PENDENTE,
      pagoEm: null,
      recusadaEm: null,
      motivoRecusa: null,
      version: 0,
      callback: null,
    });
  }

  static reconstituir(props: CobrancaProps): Cobranca {
    return new Cobranca(props);
  }

  get dados(): Readonly<CobrancaProps> {
    return this.props;
  }

  /** A order ja existe e a cobranca continua valida ou foi paga: `cobrar` devolve esta. */
  get reaproveitavel(): boolean {
    return (
      this.props.status === StatusCobranca.APROVADA || this.props.status === StatusCobranca.PENDENTE
    );
  }

  vincularOrder(orderId: string, linkPagamento: string): void {
    this.props.orderId = orderId;
    this.props.linkPagamento = linkPagamento;
  }

  /**
   * Aplica o estado consultado no Mercado Pago. `false` = nada mudou. Uma cobranca
   * RECUSADA ainda pode virar APROVADA: o cliente pode tentar de novo no mesmo checkout.
   */
  aplicar(resultado: ResultadoOrder, agora: Date, callbackId: string): boolean {
    const { status } = this.props;
    if (status !== StatusCobranca.PENDENTE && status !== StatusCobranca.RECUSADA) return false;
    if (resultado.tipo === 'PENDENTE') return false;
    if (resultado.tipo === 'APROVADA') {
      this.props.status = StatusCobranca.APROVADA;
      this.props.pagoEm = agora;
      this.props.motivoRecusa = null;
    } else {
      if (status === StatusCobranca.RECUSADA) return false;
      this.props.status =
        resultado.tipo === 'EXPIRADA' ? StatusCobranca.EXPIRADA : StatusCobranca.RECUSADA;
      this.props.recusadaEm = agora;
      this.props.motivoRecusa = resultado.motivo;
    }
    this.props.callback = { id: callbackId, ultimaTentativaEm: agora, entregueEm: null };
    return true;
  }

  /** `false` = so cobranca PENDENTE e cancelada. */
  cancelar(): boolean {
    if (this.props.status !== StatusCobranca.PENDENTE) return false;
    this.props.status = StatusCobranca.CANCELADA;
    return true;
  }

  lancamento(tipo: TipoLancamento, ocorridoEm: Date): Lancamento {
    return {
      tipo,
      valor: this.props.valor,
      numeroOS: this.props.numeroOS,
      orcamentoId: this.props.orcamentoId,
      orderId: this.props.orderId,
      ocorridoEm,
    };
  }

  /** Evento a entregar ao OS Service; `null` quando nao ha callback pendente. */
  eventoPendente(): EventoCallback | null {
    const { callback, status, numeroOS, orderId, valor, pagoEm, recusadaEm, motivoRecusa } =
      this.props;
    if (!callback || callback.entregueEm) return null;
    if (status === StatusCobranca.APROVADA && pagoEm) {
      return {
        id: callback.id,
        type: 'billing.pagamento-aprovado',
        numeroOS,
        occurredAt: pagoEm,
        data: { numeroOS, orderId, valor: valor.toString() },
      };
    }
    if (recusadaEm) {
      return {
        id: callback.id,
        type: 'billing.pagamento-recusado',
        numeroOS,
        occurredAt: recusadaEm,
        data: { numeroOS, orderId, motivo: motivoRecusa ?? 'pagamento recusado' },
      };
    }
    return null;
  }

  confirmarPersistencia(): void {
    this.props.version += 1;
  }
}
