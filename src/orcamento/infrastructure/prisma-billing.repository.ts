import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type {
  Cobranca as CobrancaRow,
  Orcamento as OrcamentoRow,
  OrcamentoItem as ItemRow,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Alteracoes,
  BillingRepository,
  OrcamentoComCobranca,
  RegistroWebhook,
} from '../domain/billing.repository';
import { Cobranca } from '../domain/cobranca.entity';
import { Dinheiro } from '../domain/dinheiro.vo';
import { ConcorrenciaError, RegistroDuplicadoError } from '../domain/errors';
import { Orcamento } from '../domain/orcamento.entity';
import { EstadoCallback, StatusCobranca, StatusOrcamento, TipoItem } from '../domain/tipos';

type OrcamentoComItens = OrcamentoRow & { itens: ItemRow[] };

const COM_ITENS = { itens: { orderBy: { posicao: 'asc' } } } as const;

function dinheiro(valor: Prisma.Decimal): Dinheiro {
  return Dinheiro.de(valor.toFixed(2));
}

function callback(row: {
  callbackId: string | null;
  callbackUltimaTentativaEm: Date | null;
  callbackEntregueEm: Date | null;
}): EstadoCallback | null {
  if (!row.callbackId || !row.callbackUltimaTentativaEm) return null;
  return {
    id: row.callbackId,
    ultimaTentativaEm: row.callbackUltimaTentativaEm,
    entregueEm: row.callbackEntregueEm,
  };
}

function colunasCallback(estado: EstadoCallback | null) {
  return {
    callbackId: estado?.id ?? null,
    callbackUltimaTentativaEm: estado?.ultimaTentativaEm ?? null,
    callbackEntregueEm: estado?.entregueEm ?? null,
  };
}

function paraOrcamento(row: OrcamentoComItens): Orcamento {
  return Orcamento.reconstituir({
    id: row.id,
    numeroOS: row.numeroOS,
    clienteId: row.clienteId,
    itens: row.itens.map((item) => ({
      tipo: item.tipo as TipoItem,
      referenciaId: item.referenciaId,
      servicoId: item.servicoId,
      nome: item.nome,
      quantidade: item.quantidade,
      precoUnitario: dinheiro(item.precoUnitario),
    })),
    subtotal: dinheiro(row.subtotal),
    total: dinheiro(row.total),
    validoAte: row.validoAte,
    status: row.status as StatusOrcamento,
    decididoEm: row.decididoEm,
    motivoRejeicao: row.motivoRejeicao,
    motivoCancelamento: row.motivoCancelamento,
    version: row.version,
    callback: callback(row),
  });
}

function paraCobranca(row: CobrancaRow): Cobranca {
  return Cobranca.reconstituir({
    id: row.id,
    orcamentoId: row.orcamentoId,
    numeroOS: row.numeroOS,
    tentativa: row.tentativa,
    idempotencyKey: row.idempotencyKey,
    valor: dinheiro(row.valor),
    orderId: row.orderId,
    linkPagamento: row.linkPagamento,
    status: row.status as StatusCobranca,
    pagoEm: row.pagoEm,
    recusadaEm: row.recusadaEm,
    motivoRecusa: row.motivoRecusa,
    version: row.version,
    callback: callback(row),
  });
}

function duplicado(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async persistir({ orcamento, cobranca, lancamentos = [] }: Alteracoes): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (orcamento) await this.gravarOrcamento(tx, orcamento);
        if (cobranca) await this.gravarCobranca(tx, cobranca);
        if (lancamentos.length > 0) {
          await tx.lancamento.createMany({
            data: lancamentos.map((l) => ({
              tipo: l.tipo,
              valor: l.valor.toString(),
              numeroOS: l.numeroOS,
              orcamentoId: l.orcamentoId,
              orderId: l.orderId ?? null,
              ocorridoEm: l.ocorridoEm,
            })),
          });
        }
      });
    } catch (e) {
      if (duplicado(e)) throw new RegistroDuplicadoError();
      throw e;
    }
    orcamento?.confirmarPersistencia();
    cobranca?.confirmarPersistencia();
  }

  private async gravarOrcamento(tx: Prisma.TransactionClient, orcamento: Orcamento) {
    const d = orcamento.dados;
    const mutaveis = {
      status: d.status,
      decididoEm: d.decididoEm,
      motivoRejeicao: d.motivoRejeicao,
      motivoCancelamento: d.motivoCancelamento,
      ...colunasCallback(d.callback),
    };
    if (d.version === 0) {
      await tx.orcamento.create({
        data: {
          ...mutaveis,
          id: d.id,
          numeroOS: d.numeroOS,
          clienteId: d.clienteId,
          subtotal: d.subtotal.toString(),
          total: d.total.toString(),
          validoAte: d.validoAte,
          itens: {
            create: d.itens.map((item, posicao) => ({
              posicao,
              tipo: item.tipo,
              referenciaId: item.referenciaId,
              servicoId: item.servicoId ?? null,
              nome: item.nome,
              quantidade: item.quantidade,
              precoUnitario: item.precoUnitario.toString(),
            })),
          },
        },
      });
      return;
    }
    const { count } = await tx.orcamento.updateMany({
      where: { id: d.id, version: d.version },
      data: { ...mutaveis, version: { increment: 1 } },
    });
    if (count === 0) throw new ConcorrenciaError('Orcamento');
  }

  private async gravarCobranca(tx: Prisma.TransactionClient, cobranca: Cobranca) {
    const d = cobranca.dados;
    const mutaveis = {
      orderId: d.orderId,
      linkPagamento: d.linkPagamento,
      status: d.status,
      pagoEm: d.pagoEm,
      recusadaEm: d.recusadaEm,
      motivoRecusa: d.motivoRecusa,
      ...colunasCallback(d.callback),
    };
    if (d.version === 0) {
      await tx.cobranca.create({
        data: {
          ...mutaveis,
          id: d.id,
          orcamentoId: d.orcamentoId,
          numeroOS: d.numeroOS,
          tentativa: d.tentativa,
          idempotencyKey: d.idempotencyKey,
          valor: d.valor.toString(),
        },
      });
      return;
    }
    const { count } = await tx.cobranca.updateMany({
      where: { id: d.id, version: d.version },
      data: { ...mutaveis, version: { increment: 1 } },
    });
    if (count === 0) throw new ConcorrenciaError('Cobranca');
  }

  async buscarAtivo(numeroOS: string): Promise<Orcamento | null> {
    const row = await this.prisma.orcamento.findFirst({
      where: { numeroOS, status: { in: ['PENDENTE', 'APROVADO'] } },
      include: COM_ITENS,
    });
    return row ? paraOrcamento(row) : null;
  }

  async buscarUltimo(numeroOS: string): Promise<Orcamento | null> {
    const row = await this.prisma.orcamento.findFirst({
      where: { numeroOS },
      orderBy: { criadoEm: 'desc' },
      include: COM_ITENS,
    });
    return row ? paraOrcamento(row) : null;
  }

  async listarPorCliente(clienteId: string): Promise<OrcamentoComCobranca[]> {
    const rows = await this.prisma.orcamento.findMany({
      where: { clienteId },
      orderBy: { criadoEm: 'desc' },
      take: 100,
      include: { ...COM_ITENS, cobrancas: { orderBy: { tentativa: 'desc' }, take: 1 } },
    });
    return rows.map((row) => ({
      orcamento: paraOrcamento(row),
      cobranca: row.cobrancas[0] ? paraCobranca(row.cobrancas[0]) : null,
    }));
  }

  async buscarUltimaCobranca(numeroOS: string): Promise<Cobranca | null> {
    const row = await this.prisma.cobranca.findFirst({
      where: { numeroOS },
      orderBy: { criadoEm: 'desc' },
    });
    return row ? paraCobranca(row) : null;
  }

  async buscarCobrancaPorOrderId(orderId: string): Promise<Cobranca | null> {
    const row = await this.prisma.cobranca.findUnique({ where: { orderId } });
    return row ? paraCobranca(row) : null;
  }

  async registrarWebhook(registro: RegistroWebhook): Promise<boolean> {
    const { count } = await this.prisma.webhookMercadoPago.createMany({
      data: [{ ...registro, payload: registro.payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    return count > 0;
  }

  async marcarCallbackOrcamentoEntregue(id: string, callbackId: string, agora: Date) {
    await this.prisma.orcamento.updateMany({
      where: { id, callbackId },
      data: { callbackEntregueEm: agora },
    });
  }

  async marcarCallbackCobrancaEntregue(id: string, callbackId: string, agora: Date) {
    await this.prisma.cobranca.updateMany({
      where: { id, callbackId },
      data: { callbackEntregueEm: agora },
    });
  }

  async reservarOrcamentosComCallback(limite: Date, agora: Date, lote: number) {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE orcamento SET callback_ultima_tentativa_em = ${agora}
      WHERE id IN (
        SELECT id FROM orcamento
        WHERE status IN ('APROVADO', 'REJEITADO')
          AND callback_id IS NOT NULL AND callback_entregue_em IS NULL
          AND callback_ultima_tentativa_em <= ${limite}
        ORDER BY callback_ultima_tentativa_em LIMIT ${lote} FOR UPDATE SKIP LOCKED
      ) RETURNING id`;
    const rows = await this.prisma.orcamento.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: COM_ITENS,
    });
    return rows.map(paraOrcamento);
  }

  async reservarCobrancasComCallback(limite: Date, agora: Date, lote: number) {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE cobranca SET callback_ultima_tentativa_em = ${agora}
      WHERE id IN (
        SELECT id FROM cobranca
        WHERE status IN ('APROVADA', 'RECUSADA', 'EXPIRADA')
          AND callback_id IS NOT NULL AND callback_entregue_em IS NULL
          AND callback_ultima_tentativa_em <= ${limite}
        ORDER BY callback_ultima_tentativa_em LIMIT ${lote} FOR UPDATE SKIP LOCKED
      ) RETURNING id`;
    return this.cobrancasPorIds(ids);
  }

  async reservarCobrancasPendentes(limite: Date, agora: Date, lote: number) {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE cobranca SET ultima_consulta_em = ${agora}
      WHERE id IN (
        SELECT id FROM cobranca
        WHERE status = 'PENDENTE' AND order_id IS NOT NULL
          AND COALESCE(ultima_consulta_em, created_at) <= ${limite}
        ORDER BY created_at LIMIT ${lote} FOR UPDATE SKIP LOCKED
      ) RETURNING id`;
    return this.cobrancasPorIds(ids);
  }

  private async cobrancasPorIds(ids: Array<{ id: string }>): Promise<Cobranca[]> {
    const rows = await this.prisma.cobranca.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    return rows.map(paraCobranca);
  }
}
