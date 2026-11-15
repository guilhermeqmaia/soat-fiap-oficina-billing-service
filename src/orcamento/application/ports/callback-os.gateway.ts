import { EventoCallback } from '../../domain/tipos';

export const CALLBACK_OS_GATEWAY = Symbol('CALLBACK_OS_GATEWAY');

export interface CallbackOsGateway {
  /** Rejeita quando o OS nao confirmou; quem chama mantem o callback pendente. */
  enviar(evento: EventoCallback): Promise<void>;
}

/**
 * O OS recusou o callback de forma permanente (4xx que nao e `409`): repetir
 * com o mesmo corpo nao muda a resposta. Conta para o teto `MAX_FALHAS_CALLBACK`.
 */
export class CallbackRecusadoError extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = CallbackRecusadoError.name;
  }
}
