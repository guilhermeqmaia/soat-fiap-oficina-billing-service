import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from '../domain/billing.repository';
import { Cobranca } from '../domain/cobranca.entity';
import { Orcamento } from '../domain/orcamento.entity';
import { EventoCallback, MAX_FALHAS_CALLBACK } from '../domain/tipos';
import {
  CALLBACK_OS_GATEWAY,
  CallbackOsGateway,
  CallbackRecusadoError,
} from './ports/callback-os.gateway';

/**
 * Entrega depois do commit e nunca rejeita: o que nao for confirmado continua
 * pendente no agregado e o job de reconciliacao reenvia com o mesmo `id`. Recusa
 * permanente do OS (4xx) conta ate `MAX_FALHAS_CALLBACK`; no teto, o reenvio para
 * e fica um erro no log para intervencao manual.
 */
@Injectable()
export class EntregaCallbacksService {
  private readonly logger = new Logger(EntregaCallbacksService.name);

  constructor(
    @Inject(CALLBACK_OS_GATEWAY) private readonly gateway: CallbackOsGateway,
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
  ) {}

  async entregarOrcamento(orcamento: Orcamento): Promise<void> {
    const { id } = orcamento.dados;
    await this.entregar(orcamento.eventoPendente(), {
      marcar: (callbackId) =>
        this.repositorio.marcarCallbackOrcamentoEntregue(id, callbackId, new Date()),
      contarFalha: (callbackId) => this.repositorio.registrarFalhaCallbackOrcamento(id, callbackId),
    });
  }

  async entregarCobranca(cobranca: Cobranca): Promise<void> {
    const { id } = cobranca.dados;
    await this.entregar(cobranca.eventoPendente(), {
      marcar: (callbackId) =>
        this.repositorio.marcarCallbackCobrancaEntregue(id, callbackId, new Date()),
      contarFalha: (callbackId) => this.repositorio.registrarFalhaCallbackCobranca(id, callbackId),
    });
  }

  private async entregar(
    evento: EventoCallback | null,
    registro: {
      marcar: (callbackId: string) => Promise<void>;
      contarFalha: (callbackId: string) => Promise<number>;
    },
  ): Promise<void> {
    if (!evento) return;
    try {
      await this.gateway.enviar(evento);
      await registro.marcar(evento.id);
    } catch (e) {
      const contexto = {
        numeroOS: evento.numeroOS,
        type: evento.type,
        id: evento.id,
        erro: (e as Error).message,
      };
      if (!(e instanceof CallbackRecusadoError)) {
        this.logger.warn({ msg: 'callback nao confirmado; sera reenviado', ...contexto });
        return;
      }
      await this.registrarRecusa(evento, e, contexto, registro.contarFalha);
    }
  }

  private async registrarRecusa(
    evento: EventoCallback,
    erro: CallbackRecusadoError,
    contexto: Record<string, unknown>,
    contarFalha: (callbackId: string) => Promise<number>,
  ): Promise<void> {
    try {
      const falhas = await contarFalha(evento.id);
      const log = { ...contexto, status: erro.status, falhas, teto: MAX_FALHAS_CALLBACK };
      if (falhas >= MAX_FALHAS_CALLBACK) {
        this.logger.error({ msg: 'callback recusado pelo OS no teto; reenvio encerrado', ...log });
      } else {
        this.logger.warn({ msg: 'callback recusado pelo OS; sera reenviado', ...log });
      }
    } catch (falha) {
      this.logger.warn({
        msg: 'callback recusado pelo OS; falha ao contar a recusa',
        ...contexto,
        erroContagem: (falha as Error).message,
      });
    }
  }
}
