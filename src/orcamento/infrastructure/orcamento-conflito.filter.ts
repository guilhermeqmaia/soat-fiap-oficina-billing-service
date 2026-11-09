import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { OrcamentoConflitoError } from '../domain/errors';

/** Contrato HTTP interno: recusa de negocio e `409 { motivo }`. */
@Catch(OrcamentoConflitoError)
export class OrcamentoConflitoFilter implements ExceptionFilter {
  catch(exception: OrcamentoConflitoError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(409).json({ motivo: exception.motivo });
  }
}
