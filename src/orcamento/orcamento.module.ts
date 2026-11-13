import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Order } from 'mercadopago';
import { v7 as uuidv7 } from 'uuid';
import { EntregaCallbacksService } from './application/entrega-callbacks.service';
import { BILLING_CONFIG, BillingConfig, GERADOR_ID } from './application/ports/billing.config';
import { CALLBACK_OS_GATEWAY } from './application/ports/callback-os.gateway';
import { MERCADO_PAGO_GATEWAY } from './application/ports/mercado-pago.gateway';
import { CancelarOrcamentoUseCase } from './application/use-cases/cancelar-orcamento.use-case';
import { CobrarOrcamentoUseCase } from './application/use-cases/cobrar-orcamento.use-case';
import { ConsultasOrcamentoUseCase } from './application/use-cases/consultas.use-case';
import { DecidirOrcamentoUseCase } from './application/use-cases/decidir-orcamento.use-case';
import { GerarOrcamentoUseCase } from './application/use-cases/gerar-orcamento.use-case';
import { ProcessarOrderUseCase } from './application/use-cases/processar-order.use-case';
import { ReceberWebhookUseCase } from './application/use-cases/receber-webhook.use-case';
import { ReconciliarUseCase } from './application/use-cases/reconciliar.use-case';
import { BILLING_REPOSITORY } from './domain/billing.repository';
import { HttpCallbackOsGateway, OS_SERVICE_URL } from './infrastructure/http-callback-os.gateway';
import {
  MercadoPagoSdkGateway,
  MP_OPCOES,
  MP_ORDER_CLIENT,
  MercadoPagoOpcoes,
} from './infrastructure/mercado-pago-sdk.gateway';
import { OrcamentoController } from './infrastructure/orcamento.controller';
import { PagamentoController } from './infrastructure/pagamento.controller';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { RECONCILIACAO_ATIVA, ReconciliacaoJob } from './infrastructure/reconciliacao.job';
import { MP_WEBHOOK_SECRET, WebhookController } from './infrastructure/webhook.controller';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Abaixo do timeout de 5 s do OS: uma falha aqui ainda cabe na tentativa seguinte dele. */
const MP_TIMEOUT_MS = 4000;

@Module({
  controllers: [OrcamentoController, PagamentoController, WebhookController],
  providers: [
    GerarOrcamentoUseCase,
    CobrarOrcamentoUseCase,
    CancelarOrcamentoUseCase,
    DecidirOrcamentoUseCase,
    ConsultasOrcamentoUseCase,
    ProcessarOrderUseCase,
    ReceberWebhookUseCase,
    ReconciliarUseCase,
    EntregaCallbacksService,
    ReconciliacaoJob,
    { provide: BILLING_REPOSITORY, useClass: PrismaBillingRepository },
    { provide: MERCADO_PAGO_GATEWAY, useClass: MercadoPagoSdkGateway },
    { provide: CALLBACK_OS_GATEWAY, useClass: HttpCallbackOsGateway },
    { provide: GERADOR_ID, useValue: { novo: () => uuidv7() } },
    {
      provide: BILLING_CONFIG,
      inject: [ConfigService],
      useFactory: (c: ConfigService): BillingConfig => ({
        validadeOrcamentoMs: Number(c.get('ORCAMENTO_VALIDADE_DIAS') ?? 7) * DIA_MS,
        reentregaCallbackMs: Number(c.get('CALLBACK_REENTREGA_MS') ?? 120_000),
        reconciliacaoMs: Number(c.get('RECONCILIACAO_APOS_MS') ?? 15 * 60 * 1000),
        loteReconciliacao: Number(c.get('RECONCILIACAO_LOTE') ?? 50),
      }),
    },
    {
      provide: OS_SERVICE_URL,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => c.get<string>('OS_SERVICE_URL') ?? 'http://localhost:3000',
    },
    {
      provide: MP_WEBHOOK_SECRET,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => c.get<string>('MP_WEBHOOK_SECRET') ?? '',
    },
    {
      provide: RECONCILIACAO_ATIVA,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => c.get('RECONCILIACAO_DESABILITADA') !== 'true',
    },
    {
      provide: MP_ORDER_CLIENT,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        new Order(
          new MercadoPagoConfig({
            accessToken: c.get<string>('MP_ACCESS_TOKEN') ?? '',
            options: { timeout: MP_TIMEOUT_MS },
          }),
        ),
    },
    {
      provide: MP_OPCOES,
      inject: [ConfigService],
      useFactory: (c: ConfigService): MercadoPagoOpcoes => ({
        payerEmail: c.get<string>('MP_PAYER_EMAIL') ?? '',
        retornoBaseUrl: c.get<string>('MP_RETORNO_BASE_URL') ?? 'https://exemplo.com/pagamento',
        expiracaoOrder: c.get<string>('MP_ORDER_EXPIRACAO') ?? 'P1D',
      }),
    },
  ],
})
export class OrcamentoModule {}
