import { Dinheiro } from './dinheiro.vo';
import { OrcamentoConflitoError } from './errors';
import {
  EstadoCallback,
  EventoCallback,
  ItemOrcamento,
  Lancamento,
  StatusOrcamento,
  TipoLancamento,
} from './tipos';

export interface OrcamentoProps {
  readonly id: string;
  readonly numeroOS: string;
  readonly clienteId: string;
  readonly itens: readonly ItemOrcamento[];
  readonly subtotal: Dinheiro;
  readonly total: Dinheiro;
  readonly validoAte: Date;
  status: StatusOrcamento;
  decididoEm: Date | null;
  motivoRejeicao: string | null;
  motivoCancelamento: string | null;
  version: number;
  callback: EstadoCallback | null;
}

export interface CriarOrcamentoInput {
  readonly id: string;
  readonly numeroOS: string;
  readonly clienteId: string;
  readonly itens: readonly ItemOrcamento[];
  readonly validoAte: Date;
}

/** Itens e valores sao imutaveis desde a criacao; so o ciclo de decisao muda. */
export class Orcamento {
  private constructor(private readonly props: OrcamentoProps) {}

  static criar(input: CriarOrcamentoInput): Orcamento {
    const subtotal = input.itens.reduce(
      (soma, item) => soma.somar(item.precoUnitario.multiplicar(item.quantidade)),
      Dinheiro.zero(),
    );
    return new Orcamento({
      ...input,
      subtotal,
      total: subtotal,
      status: StatusOrcamento.PENDENTE,
      decididoEm: null,
      motivoRejeicao: null,
      motivoCancelamento: null,
      version: 0,
      callback: null,
    });
  }

  static reconstituir(props: OrcamentoProps): Orcamento {
    return new Orcamento(props);
  }

  get dados(): Readonly<OrcamentoProps> {
    return this.props;
  }

  get ativo(): boolean {
    return (
      this.props.status === StatusOrcamento.PENDENTE ||
      this.props.status === StatusOrcamento.APROVADO
    );
  }

  venceu(agora: Date): boolean {
    return this.props.status === StatusOrcamento.PENDENTE && agora > this.props.validoAte;
  }

  /** `false` = ja estava aprovado (idempotente, sem novo callback). */
  aprovar(agora: Date, callbackId: string): boolean {
    if (this.props.status === StatusOrcamento.APROVADO) return false;
    this.exigirPendente('aprovar');
    this.props.status = StatusOrcamento.APROVADO;
    this.registrarDecisao(agora, callbackId);
    return true;
  }

  /** `false` = ja estava rejeitado (idempotente, sem novo callback). */
  rejeitar(agora: Date, callbackId: string, motivo?: string): boolean {
    if (this.props.status === StatusOrcamento.REJEITADO) return false;
    this.exigirPendente('rejeitar');
    this.props.status = StatusOrcamento.REJEITADO;
    this.props.motivoRejeicao = motivo ?? null;
    this.registrarDecisao(agora, callbackId);
    return true;
  }

  expirar(): void {
    this.exigirPendente('expirar');
    this.props.status = StatusOrcamento.EXPIRADO;
  }

  /** `false` = nao havia nada ativo para cancelar (idempotente). */
  cancelar(motivo: string): boolean {
    if (!this.ativo) return false;
    this.props.status = StatusOrcamento.CANCELADO;
    this.props.motivoCancelamento = motivo;
    return true;
  }

  lancamento(tipo: TipoLancamento, ocorridoEm: Date): Lancamento {
    return {
      tipo,
      valor: this.props.total,
      numeroOS: this.props.numeroOS,
      orcamentoId: this.props.id,
      ocorridoEm,
    };
  }

  /** Evento a entregar ao OS Service; `null` quando nao ha callback pendente. */
  eventoPendente(): EventoCallback | null {
    const { callback, decididoEm, status, numeroOS, id, motivoRejeicao } = this.props;
    if (!callback || callback.entregueEm || !decididoEm) return null;
    const rejeitado = status === StatusOrcamento.REJEITADO;
    if (!rejeitado && status !== StatusOrcamento.APROVADO) return null;
    return {
      id: callback.id,
      type: rejeitado ? 'billing.orcamento-rejeitado' : 'billing.orcamento-aprovado',
      numeroOS,
      occurredAt: decididoEm,
      data: {
        numeroOS,
        orcamentoId: id,
        ...(rejeitado && motivoRejeicao ? { motivo: motivoRejeicao } : {}),
      },
    };
  }

  confirmarPersistencia(): void {
    this.props.version += 1;
  }

  private registrarDecisao(agora: Date, callbackId: string): void {
    this.props.decididoEm = agora;
    this.props.callback = { id: callbackId, ultimaTentativaEm: agora, entregueEm: null };
  }

  private exigirPendente(acao: string): void {
    if (this.props.status !== StatusOrcamento.PENDENTE) {
      throw new OrcamentoConflitoError(
        `Nao e possivel ${acao} um orcamento com status ${this.props.status}`,
      );
    }
  }
}
