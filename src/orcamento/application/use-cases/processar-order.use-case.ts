import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { Cobranca } from '../../domain/cobranca.entity';
import { ConcorrenciaError } from '../../domain/errors';
import { interpretarOrder } from '../../domain/resultado-order';
import { StatusCobranca, TipoLancamento } from '../../domain/tipos';
import { EntregaCallbacksService } from '../entrega-callbacks.service';
import { GERADOR_ID, GeradorId } from '../ports/billing.config';
import { MERCADO_PAGO_GATEWAY, MercadoPagoGateway } from '../ports/mercado-pago.gateway';

/** Fonte de verdade e sempre `GET /v1/orders/{id}`, nunca o corpo do webhook. */
@Injectable()
export class ProcessarOrderUseCase {
  private readonly logger = new Logger(ProcessarOrderUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(MERCADO_PAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
    @Inject(GERADOR_ID) private readonly ids: GeradorId,
    private readonly callbacks: EntregaCallbacksService,
  ) {}

  async porOrderId(orderId: string): Promise<void> {
    const cobranca = await this.repositorio.buscarCobrancaPorOrderId(orderId);
    if (!cobranca) {
      this.logger.warn({ msg: 'order sem cobranca conhecida; ignorada', orderId });
      return;
    }
    await this.porCobranca(cobranca);
  }

  async porCobranca(cobranca: Cobranca): Promise<void> {
    const { orderId, status } = cobranca.dados;
    if (!orderId || (status !== StatusCobranca.PENDENTE && status !== StatusCobranca.RECUSADA)) {
      return;
    }
    const situacao = await this.mercadoPago.consultarOrder(orderId);
    const agora = new Date();
    if (!cobranca.aplicar(interpretarOrder(situacao), agora, this.ids.novo())) return;

    const tipo =
      cobranca.dados.status === StatusCobranca.APROVADA
        ? TipoLancamento.PAGAMENTO_APROVADO
        : TipoLancamento.PAGAMENTO_RECUSADO;
    try {
      await this.repositorio.persistir({
        cobranca,
        lancamentos: [cobranca.lancamento(tipo, agora)],
      });
    } catch (e) {
      if (e instanceof ConcorrenciaError) return; // o webhook e o job correram; o outro ja aplicou
      throw e;
    }
    await this.callbacks.entregarCobranca(cobranca);
  }
}
