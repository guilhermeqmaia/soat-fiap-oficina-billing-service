import { Inject, Injectable } from '@nestjs/common';
import {
  ClienteHttpInterno,
  criarEnvelopeHttp,
  HttpInternoError,
} from '@guilhermeqmaia/oficina-kit/http';
import { CallbackOsGateway, CallbackRecusadoError } from '../application/ports/callback-os.gateway';
import { EventoCallback } from '../domain/tipos';

export const OS_SERVICE_URL = Symbol('OS_SERVICE_URL');

/** O OS executa os proximos comandos antes de responder: 5 s (padrao do kit) nao bastam. */
export const TIMEOUT_CALLBACK_MS = 20_000;

@Injectable()
export class HttpCallbackOsGateway implements CallbackOsGateway {
  constructor(
    private readonly http: ClienteHttpInterno,
    @Inject(OS_SERVICE_URL) private readonly osUrl: string,
  ) {}

  async enviar(evento: EventoCallback): Promise<void> {
    const envelope = {
      ...criarEnvelopeHttp({
        type: evento.type,
        producer: 'billing-service',
        data: evento.data,
        occurredAt: evento.occurredAt,
      }),
      id: evento.id,
    };
    const numero = encodeURIComponent(evento.numeroOS);
    try {
      await this.http.post(`${this.osUrl}/ordens-servico/${numero}/eventos`, envelope, {
        correlationId: evento.numeroOS,
        timeoutMs: TIMEOUT_CALLBACK_MS,
      });
    } catch (e) {
      // 409 do OS = conflito de versao da saga ("releia e repita"): continua transitorio.
      if (e instanceof HttpInternoError && e.status && !e.transitoria && e.status !== 409) {
        throw new CallbackRecusadoError(e.status, e.message);
      }
      throw e;
    }
  }
}
