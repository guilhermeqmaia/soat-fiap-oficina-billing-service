import { Inject, Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { Cobranca } from '../../domain/cobranca.entity';
import {
  OrcamentoConflitoError,
  OrcamentoNaoEncontradoError,
  RegistroDuplicadoError,
} from '../../domain/errors';
import { Orcamento } from '../../domain/orcamento.entity';
import { StatusOrcamento, TipoLancamento } from '../../domain/tipos';
import { GERADOR_ID, GeradorId } from '../ports/billing.config';
import { MERCADO_PAGO_GATEWAY, MercadoPagoGateway } from '../ports/mercado-pago.gateway';

export interface CobrarOutput {
  numeroOS: string;
  orderId: string;
  linkPagamento: string;
  valor: string;
}

/**
 * Idempotente por OS: repetir devolve a cobranca vigente. A linha e reservada
 * antes de chamar o Mercado Pago; se a chamada falhar, a repeticao reusa a mesma
 * `X-Idempotency-Key` e nao duplica a order. Nova order so depois de recusa/expiracao.
 */
@Injectable()
export class CobrarOrcamentoUseCase implements UseCase<{ numeroOS: string }, CobrarOutput> {
  private readonly logger = new Logger(CobrarOrcamentoUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(MERCADO_PAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
    @Inject(GERADOR_ID) private readonly ids: GeradorId,
  ) {}

  async execute({ numeroOS }: { numeroOS: string }): Promise<CobrarOutput> {
    const orcamento = await this.repositorio.buscarUltimo(numeroOS);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(numeroOS);
    if (orcamento.dados.status !== StatusOrcamento.APROVADO) {
      throw new OrcamentoConflitoError(`Orcamento nao aprovado (status ${orcamento.dados.status})`);
    }

    const cobranca = await this.reservar(orcamento);
    const { orderId, linkPagamento } = cobranca.dados;
    if (orderId && linkPagamento) return this.saida(cobranca, orderId, linkPagamento);

    const order = await this.mercadoPago.criarOrder({
      numeroOS,
      valor: cobranca.dados.valor.toString(),
      idempotencyKey: cobranca.dados.idempotencyKey,
      itens: orcamento.dados.itens.map((item) => ({
        titulo: item.nome,
        quantidade: item.quantidade,
        precoUnitario: item.precoUnitario.toString(),
      })),
    });
    cobranca.vincularOrder(order.orderId, order.linkPagamento);
    await this.repositorio.persistir({
      cobranca,
      lancamentos: [cobranca.lancamento(TipoLancamento.COBRANCA_CRIADA, new Date())],
    });
    return this.saida(cobranca, order.orderId, order.linkPagamento);
  }

  private async reservar(orcamento: Orcamento): Promise<Cobranca> {
    const { numeroOS, id, total } = orcamento.dados;
    const anterior = await this.repositorio.buscarUltimaCobranca(numeroOS);
    if (anterior?.reaproveitavel) return anterior;

    const nova = Cobranca.criar({
      id: this.ids.novo(),
      orcamentoId: id,
      numeroOS,
      tentativa: (anterior?.dados.tentativa ?? 0) + 1,
      valor: total,
    });
    try {
      await this.repositorio.persistir({ cobranca: nova });
    } catch (e) {
      const concorrente =
        e instanceof RegistroDuplicadoError
          ? await this.repositorio.buscarUltimaCobranca(numeroOS)
          : null;
      if (concorrente?.reaproveitavel) return concorrente;
      throw e;
    }
    if (anterior?.dados.orderId) await this.cancelarOrderAntiga(anterior.dados.orderId, numeroOS);
    return nova;
  }

  /** Uma order recusada continua pagavel no checkout; a substituta a invalida. */
  private async cancelarOrderAntiga(orderId: string, numeroOS: string): Promise<void> {
    try {
      await this.mercadoPago.cancelarOrder(orderId);
    } catch (e) {
      this.logger.warn({
        msg: 'order anterior nao cancelada',
        numeroOS,
        orderId,
        erro: (e as Error).message,
      });
    }
  }

  private saida(cobranca: Cobranca, orderId: string, linkPagamento: string): CobrarOutput {
    const { numeroOS, valor } = cobranca.dados;
    return { numeroOS, orderId, linkPagamento, valor: valor.toString() };
  }
}
