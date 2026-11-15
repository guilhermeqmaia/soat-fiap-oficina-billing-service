import { Inject, Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { Cobranca } from '../../domain/cobranca.entity';
import {
  ConflitoTransitorioError,
  OrcamentoConflitoError,
  OrcamentoNaoEncontradoError,
  OrderAnteriorEmProcessamentoError,
  RegistroDuplicadoError,
} from '../../domain/errors';
import { Orcamento } from '../../domain/orcamento.entity';
import { estadoOrderAnterior } from '../../domain/resultado-order';
import { StatusCobranca, StatusOrcamento, TipoLancamento } from '../../domain/tipos';
import { GERADOR_ID, GeradorId } from '../ports/billing.config';
import { MERCADO_PAGO_GATEWAY, MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import { ProcessarOrderUseCase } from './processar-order.use-case';

export interface CobrarOutput {
  numeroOS: string;
  orderId: string;
  linkPagamento: string;
  valor: string;
}

/**
 * Idempotente por OS: repetir devolve a cobranca vigente. A linha e reservada
 * antes de chamar o Mercado Pago; se a chamada falhar, a repeticao reusa a mesma
 * `X-Idempotency-Key` e nao duplica a order. Nova order so depois de recusa/expiracao
 * e so com a order anterior confirmadamente fora de pagamento (ver `encerrarAnterior`).
 */
@Injectable()
export class CobrarOrcamentoUseCase implements UseCase<{ numeroOS: string }, CobrarOutput> {
  private readonly logger = new Logger(CobrarOrcamentoUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(MERCADO_PAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
    @Inject(GERADOR_ID) private readonly ids: GeradorId,
    private readonly processarOrder: ProcessarOrderUseCase,
  ) {}

  /**
   * Uma repeticao do OS (timeout de 5 s) pode correr com a chamada original. Se
   * a outra ja deixou a cobranca com order, ela e a resposta (`201`); senao o
   * conflito sobe como transitorio (`503`) e o OS repete.
   */
  async execute({ numeroOS }: { numeroOS: string }): Promise<CobrarOutput> {
    try {
      return await this.cobrar(numeroOS);
    } catch (e) {
      if (!(e instanceof ConflitoTransitorioError)) throw e;
      const vigente = await this.repositorio.buscarUltimaCobranca(numeroOS);
      const { orderId, linkPagamento } = vigente?.dados ?? {};
      if (vigente?.reaproveitavel && orderId && linkPagamento) {
        return this.saida(vigente, orderId, linkPagamento);
      }
      throw e;
    }
  }

  private async cobrar(numeroOS: string): Promise<CobrarOutput> {
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
    let anterior = await this.repositorio.buscarUltimaCobranca(numeroOS);
    if (anterior?.reaproveitavel) return anterior;
    if (anterior) {
      anterior = await this.encerrarAnterior(anterior);
      if (anterior.reaproveitavel) return anterior;
    }

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
    return nova;
  }

  /**
   * Uma order recusada continua pagavel no checkout ate expirar. Antes de emitir
   * outra: consulta a anterior (pagamento com webhook perdido vira a aprovacao
   * dela, sem nova order) e, se ainda pagavel, cancela. Sem cancelamento
   * confirmado nao ha nova order — a falha sobe (5xx), o OS repete e o cliente
   * nunca recebe dois links pagaveis. Devolve a cobranca vigente depois disso.
   */
  private async encerrarAnterior(anterior: Cobranca): Promise<Cobranca> {
    const { orderId, status, numeroOS } = anterior.dados;
    if (!orderId) return anterior;
    if (status === StatusCobranca.CANCELADA) {
      // O cancelamento do orcamento ja tentou cancelar esta order; aqui e reforco.
      await this.cancelarOrder(orderId, numeroOS, false);
      return anterior;
    }
    if (status !== StatusCobranca.RECUSADA) return anterior; // EXPIRADA: ninguem paga mais

    const situacao = await this.processarOrder.porCobranca(anterior, true);
    // Paga depois da recusa (ou outra requisicao ja reservou a proxima tentativa).
    const vigente = (await this.repositorio.buscarUltimaCobranca(numeroOS)) ?? anterior;
    if (vigente.reaproveitavel) return vigente;
    if (!situacao) return vigente;

    const estado = estadoOrderAnterior(situacao);
    if (estado === 'PROCESSADA') throw new OrderAnteriorEmProcessamentoError(orderId);
    if (estado === 'PAGAVEL') await this.cancelarOrder(orderId, numeroOS, true);
    return vigente;
  }

  private async cancelarOrder(orderId: string, numeroOS: string, obrigatorio: boolean) {
    try {
      await this.mercadoPago.cancelarOrder(orderId);
    } catch (e) {
      this.logger.warn({
        msg: obrigatorio
          ? 'order anterior nao cancelada; nova order adiada para a proxima tentativa'
          : 'order anterior nao cancelada',
        numeroOS,
        orderId,
        erro: (e as Error).message,
      });
      if (obrigatorio) throw e;
    }
  }

  private saida(cobranca: Cobranca, orderId: string, linkPagamento: string): CobrarOutput {
    const { numeroOS, valor } = cobranca.dados;
    return { numeroOS, orderId, linkPagamento, valor: valor.toString() };
  }
}
