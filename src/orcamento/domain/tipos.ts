import { Dinheiro } from './dinheiro.vo';

export enum StatusOrcamento {
  PENDENTE = 'PENDENTE',
  APROVADO = 'APROVADO',
  REJEITADO = 'REJEITADO',
  CANCELADO = 'CANCELADO',
  EXPIRADO = 'EXPIRADO',
}

export enum StatusCobranca {
  PENDENTE = 'PENDENTE',
  APROVADA = 'APROVADA',
  RECUSADA = 'RECUSADA',
  CANCELADA = 'CANCELADA',
  EXPIRADA = 'EXPIRADA',
}

export enum TipoItem {
  SERVICO = 'SERVICO',
  PRODUTO = 'PRODUTO',
}

export enum TipoLancamento {
  ORCAMENTO_GERADO = 'ORCAMENTO_GERADO',
  ORCAMENTO_APROVADO = 'ORCAMENTO_APROVADO',
  ORCAMENTO_REJEITADO = 'ORCAMENTO_REJEITADO',
  ORCAMENTO_EXPIRADO = 'ORCAMENTO_EXPIRADO',
  ORCAMENTO_CANCELADO = 'ORCAMENTO_CANCELADO',
  COBRANCA_CRIADA = 'COBRANCA_CRIADA',
  COBRANCA_CANCELADA = 'COBRANCA_CANCELADA',
  PAGAMENTO_APROVADO = 'PAGAMENTO_APROVADO',
  PAGAMENTO_RECUSADO = 'PAGAMENTO_RECUSADO',
  COBRANCA_EXPIRADA = 'COBRANCA_EXPIRADA',
}

export interface ItemOrcamento {
  readonly tipo: TipoItem;
  readonly referenciaId: string;
  readonly servicoId?: string | null;
  readonly nome: string;
  readonly quantidade: number;
  readonly precoUnitario: Dinheiro;
}

export interface Lancamento {
  readonly tipo: TipoLancamento;
  readonly valor: Dinheiro;
  readonly numeroOS: string;
  readonly orcamentoId: string;
  readonly orderId?: string | null;
  readonly ocorridoEm: Date;
}

/** Controle de entrega do callback: o `id` e estavel para o OS deduplicar as reentregas. */
export interface EstadoCallback {
  readonly id: string;
  readonly ultimaTentativaEm: Date;
  readonly entregueEm: Date | null;
  /** Recusas permanentes (4xx que nao e 409) do OS para este `id`. */
  readonly falhas: number;
}

/**
 * Teto de recusas permanentes: repetir um `400`/`404` nao muda a resposta do OS.
 * Atingido o teto, a reconciliacao para de reenviar e registra um erro. Falhas
 * transitorias (5xx, timeout, `409`) nao contam e seguem sendo reenviadas.
 */
export const MAX_FALHAS_CALLBACK = 5;

export interface EventoCallback {
  readonly id: string;
  readonly type: string;
  readonly numeroOS: string;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}
