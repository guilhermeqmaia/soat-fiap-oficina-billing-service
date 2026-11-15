import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ConflitoTransitorioError } from '../domain/errors';

/**
 * Corrida entre requisicoes (versao otimista, indice unico): `503` com
 * `Retry-After`, que o cliente HTTP interno do OS repete. Nunca `409 { motivo }`:
 * para a saga, 409 em `billing.cobrar` e "nao entregue" e a deixaria parada.
 */
@Catch(ConflitoTransitorioError)
export class ConflitoTransitorioFilter implements ExceptionFilter {
  private readonly logger = new Logger(ConflitoTransitorioFilter.name);

  catch(exception: ConflitoTransitorioError, host: ArgumentsHost): void {
    this.logger.warn({ msg: 'conflito transitorio; responde 503', erro: exception.message });
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .setHeader('Retry-After', '1')
      .json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: exception.message,
        error: 'Service Unavailable',
      });
  }
}
