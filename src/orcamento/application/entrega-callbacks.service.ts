import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from '../domain/billing.repository';
import { Cobranca } from '../domain/cobranca.entity';
import { Orcamento } from '../domain/orcamento.entity';
import { EventoCallback } from '../domain/tipos';
import { CALLBACK_OS_GATEWAY, CallbackOsGateway } from './ports/callback-os.gateway';

/**
 * Entrega depois do commit e nunca rejeita: o que nao for confirmado continua
 * pendente no agregado e o job de reconciliacao reenvia com o mesmo `id`.
 */
@Injectable()
export class EntregaCallbacksService {
  private readonly logger = new Logger(EntregaCallbacksService.name);

  constructor(
    @Inject(CALLBACK_OS_GATEWAY) private readonly gateway: CallbackOsGateway,
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
  ) {}

  async entregarOrcamento(orcamento: Orcamento): Promise<void> {
    await this.entregar(orcamento.eventoPendente(), (id) =>
      this.repositorio.marcarCallbackOrcamentoEntregue(orcamento.dados.id, id, new Date()),
    );
  }

  async entregarCobranca(cobranca: Cobranca): Promise<void> {
    await this.entregar(cobranca.eventoPendente(), (id) =>
      this.repositorio.marcarCallbackCobrancaEntregue(cobranca.dados.id, id, new Date()),
    );
  }

  private async entregar(
    evento: EventoCallback | null,
    marcar: (callbackId: string) => Promise<void>,
  ): Promise<void> {
    if (!evento) return;
    try {
      await this.gateway.enviar(evento);
      await marcar(evento.id);
    } catch (e) {
      this.logger.warn({
        msg: 'callback nao confirmado; sera reenviado',
        numeroOS: evento.numeroOS,
        type: evento.type,
        id: evento.id,
        erro: (e as Error).message,
      });
    }
  }
}
