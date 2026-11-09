export const BILLING_CONFIG = Symbol('BILLING_CONFIG');
export const GERADOR_ID = Symbol('GERADOR_ID');

export interface BillingConfig {
  readonly validadeOrcamentoMs: number;
  /** Espera antes de reenviar um callback nao confirmado. */
  readonly reentregaCallbackMs: number;
  /** Idade minima de uma cobranca PENDENTE para consultar o Mercado Pago (ADR-0012: 15 min). */
  readonly reconciliacaoMs: number;
  readonly loteReconciliacao: number;
}

export interface GeradorId {
  novo(): string;
}
