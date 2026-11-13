export interface SituacaoOrder {
  readonly status?: string;
  readonly statusDetail?: string;
  readonly pagamentos: ReadonlyArray<{ status?: string; statusDetail?: string }>;
}

export type ResultadoOrder =
  | { readonly tipo: 'APROVADA' }
  | { readonly tipo: 'RECUSADA'; readonly motivo: string }
  | { readonly tipo: 'EXPIRADA'; readonly motivo: string }
  | { readonly tipo: 'PENDENTE' };

const STATUS_RECUSADOS = new Set(['failed', 'rejected', 'canceled', 'cancelled']);

/**
 * Traduz o estado de `GET /v1/orders/{id}`. A tabela vem da documentacao do hub
 * (`docs/contratos/exemplos/README.md`): processed + accredited = aprovado. Os
 * demais ramos precisam ser conferidos com orders reais do sandbox (APRO/OTHE/CONT).
 */
export function interpretarOrder(order: SituacaoOrder): ResultadoOrder {
  const { status, statusDetail, pagamentos } = order;
  const ultimo = pagamentos[pagamentos.length - 1];

  if (status === 'processed') {
    const acreditado = statusDetail === 'accredited' || ultimo?.statusDetail === 'accredited';
    return acreditado ? { tipo: 'APROVADA' } : { tipo: 'PENDENTE' };
  }
  if (status === 'expired') return { tipo: 'EXPIRADA', motivo: 'cobranca expirada' };
  if (status && STATUS_RECUSADOS.has(status)) {
    return { tipo: 'RECUSADA', motivo: statusDetail ?? status };
  }
  if (status === 'action_required') {
    if (statusDetail === 'failed') return { tipo: 'RECUSADA', motivo: statusDetail };
    if (ultimo?.status && STATUS_RECUSADOS.has(ultimo.status)) {
      return { tipo: 'RECUSADA', motivo: ultimo.statusDetail ?? ultimo.status };
    }
  }
  return { tipo: 'PENDENTE' };
}
