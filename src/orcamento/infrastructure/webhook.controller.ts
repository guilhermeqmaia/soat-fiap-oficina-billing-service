import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@guilhermeqmaia/oficina-kit/auth';
import { ReceberWebhookUseCase } from '../application/use-cases/receber-webhook.use-case';
import { assinaturaValida } from './assinatura-webhook';

export const MP_WEBHOOK_SECRET = Symbol('MP_WEBHOOK_SECRET');

const TAMANHO_MAXIMO_ID = 128;

interface CorpoWebhook {
  action?: string;
  type?: string;
  data?: { id?: unknown };
}

class WebhookRecebidoDto {
  @ApiProperty() recebido: boolean;
}

/** Rota publica no gateway: a autenticacao e o `x-signature` do Mercado Pago (ADR-0012). */
@ApiTags('Webhooks')
@SkipThrottle()
@Public()
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly receber: ReceberWebhookUseCase,
    @Inject(MP_WEBHOOK_SECRET) private readonly segredo: string,
  ) {}

  @Post('mercadopago')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notificacao de Order do Mercado Pago (publica, valida x-signature)' })
  @ApiQuery({ name: 'type', required: false, example: 'order' })
  @ApiQuery({ name: 'data.id', required: false, description: 'Id da order' })
  @ApiQuery({ name: 'data_id', required: false, description: 'Forma alternativa de data.id' })
  @ApiHeader({ name: 'x-signature', required: true, description: 'ts=<ts>,v1=<hmac>' })
  @ApiHeader({ name: 'x-request-id', required: true })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: WebhookRecebidoDto })
  @ApiBadRequestResponse({ description: 'Notificacao sem data.id valido' })
  @ApiUnauthorizedResponse({ description: 'Assinatura invalida' })
  async mercadoPago(
    @Query() query: Record<string, unknown>,
    @Headers('x-signature') assinatura: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Body() corpo: CorpoWebhook,
  ): Promise<{ recebido: boolean }> {
    // A documentacao do hub cita `data.id` e `data_id`: as duas formas sao aceitas.
    const orderId = query['data.id'] ?? query['data_id'] ?? corpo?.data?.id;
    if (typeof orderId !== 'string' || !orderId || orderId.length > TAMANHO_MAXIMO_ID) {
      throw new BadRequestException('Notificacao sem data.id valido');
    }
    const valida = assinaturaValida(this.segredo, { assinatura, xRequestId, dataId: orderId });
    await this.receber.execute({
      orderId,
      xRequestId: (xRequestId ?? '').slice(0, TAMANHO_MAXIMO_ID),
      tipo: (query.type as string | undefined) ?? corpo?.type ?? null,
      action: corpo?.action?.slice(0, TAMANHO_MAXIMO_ID) ?? null,
      payload: corpo ?? {},
      assinaturaValida: valida,
    });
    if (!valida) throw new UnauthorizedException('Assinatura invalida');
    return { recebido: true };
  }
}
