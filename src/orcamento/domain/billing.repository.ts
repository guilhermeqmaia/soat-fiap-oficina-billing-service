import { Cobranca } from './cobranca.entity';
import { Orcamento } from './orcamento.entity';
import { Lancamento } from './tipos';

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');

export interface Alteracoes {
  readonly orcamento?: Orcamento;
  readonly cobranca?: Cobranca;
  readonly lancamentos?: readonly Lancamento[];
}

export interface RegistroWebhook {
  readonly orderId: string;
  readonly xRequestId: string;
  readonly action: string | null;
  readonly payload: unknown;
  readonly assinaturaValida: boolean;
  readonly recebidoEm: Date;
}

export interface OrcamentoComCobranca {
  readonly orcamento: Orcamento;
  readonly cobranca: Cobranca | null;
}

export interface BillingRepository {
  /** Grava tudo numa transacao. Lanca `ConcorrenciaError` ou `RegistroDuplicadoError`. */
  persistir(alteracoes: Alteracoes): Promise<void>;
  buscarAtivo(numeroOS: string): Promise<Orcamento | null>;
  buscarUltimo(numeroOS: string): Promise<Orcamento | null>;
  listarPorCliente(clienteId: string): Promise<OrcamentoComCobranca[]>;
  buscarUltimaCobranca(numeroOS: string): Promise<Cobranca | null>;
  buscarCobrancaPorOrderId(orderId: string): Promise<Cobranca | null>;
  /** `false` = esta notificacao ja tinha sido registrada. */
  registrarWebhook(registro: RegistroWebhook): Promise<boolean>;
  marcarCallbackOrcamentoEntregue(id: string, callbackId: string, agora: Date): Promise<void>;
  marcarCallbackCobrancaEntregue(id: string, callbackId: string, agora: Date): Promise<void>;
  /** Reservas com lease por timestamp: varias replicas do job nao pegam o mesmo registro. */
  reservarOrcamentosComCallback(limite: Date, agora: Date, lote: number): Promise<Orcamento[]>;
  reservarCobrancasComCallback(limite: Date, agora: Date, lote: number): Promise<Cobranca[]>;
  reservarCobrancasPendentes(limite: Date, agora: Date, lote: number): Promise<Cobranca[]>;
}
