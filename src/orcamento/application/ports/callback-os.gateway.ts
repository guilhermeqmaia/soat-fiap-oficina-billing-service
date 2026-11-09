import { EventoCallback } from '../../domain/tipos';

export const CALLBACK_OS_GATEWAY = Symbol('CALLBACK_OS_GATEWAY');

export interface CallbackOsGateway {
  /** Rejeita quando o OS nao confirmou; quem chama mantem o callback pendente. */
  enviar(evento: EventoCallback): Promise<void>;
}
