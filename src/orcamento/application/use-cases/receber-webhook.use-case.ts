import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { ProcessarOrderUseCase } from './processar-order.use-case';

export interface ReceberWebhookInput {
  orderId: string;
  xRequestId: string;
  tipo: string | null;
  action: string | null;
  payload: unknown;
}

/**
 * Registra a notificacao (ja autenticada pelo `x-signature`) e responde sem
 * esperar o processamento (limite de 22 s do Mercado Pago). Se o processamento
 * falhar, a reconciliacao fecha a cobranca.
 */
@Injectable()
export class ReceberWebhookUseCase {
  private readonly logger = new Logger(ReceberWebhookUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    private readonly processarOrder: ProcessarOrderUseCase,
  ) {}

  async execute(input: ReceberWebhookInput): Promise<void> {
    await this.repositorio.registrarWebhook({
      orderId: input.orderId,
      xRequestId: input.xRequestId,
      action: input.action,
      payload: input.payload,
      assinaturaValida: true,
      recebidoEm: new Date(),
    });
    if (input.tipo === 'order') void this.processar(input.orderId);
  }

  private async processar(orderId: string): Promise<void> {
    try {
      await this.processarOrder.porOrderId(orderId);
    } catch (e) {
      this.logger.warn({
        msg: 'falha ao processar webhook; reconciliacao fecha a cobranca',
        orderId,
        erro: (e as Error).message,
      });
    }
  }
}
