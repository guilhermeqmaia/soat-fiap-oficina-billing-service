import { AuthenticatedUser, Role } from '@guilhermeqmaia/oficina-kit/auth';
import { NotOwnedByUserError } from '@guilhermeqmaia/oficina-kit/core';
import { Cobranca } from '../domain/cobranca.entity';
import { Orcamento } from '../domain/orcamento.entity';

export interface CobrancaView {
  orderId: string | null;
  status: string;
  linkPagamento: string | null;
  valor: string;
}

export function cobrancaView(cobranca: Cobranca): CobrancaView {
  const { orderId, status, linkPagamento, valor } = cobranca.dados;
  return { orderId, status, linkPagamento, valor: valor.toString() };
}

export function orcamentoView(orcamento: Orcamento, cobranca: Cobranca | null = null) {
  const d = orcamento.dados;
  return {
    numeroOS: d.numeroOS,
    orcamentoId: d.id,
    clienteId: d.clienteId,
    status: d.status,
    subtotal: d.subtotal.toString(),
    total: d.total.toString(),
    validoAte: d.validoAte.toISOString(),
    decididoEm: d.decididoEm?.toISOString() ?? null,
    motivoRejeicao: d.motivoRejeicao,
    itens: d.itens.map((item) => ({
      tipo: item.tipo,
      referenciaId: item.referenciaId,
      servicoId: item.servicoId ?? null,
      nome: item.nome,
      quantidade: item.quantidade,
      precoUnitario: item.precoUnitario.toString(),
    })),
    cobranca: cobranca ? cobrancaView(cobranca) : null,
  };
}

export type OrcamentoView = ReturnType<typeof orcamentoView>;

/** O `sub` do JWT de CLIENTE e o id do cliente; o Billing nao recebe CPF. */
export function garantirPosse(
  usuario: AuthenticatedUser,
  clienteId: string,
  numeroOS: string,
): void {
  if (usuario.role === Role.CLIENTE && usuario.id !== clienteId) {
    throw new NotOwnedByUserError('orcamento', numeroOS);
  }
}
