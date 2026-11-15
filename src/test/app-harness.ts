import { createHmac, randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mintServiceToken, mintToken } from '@guilhermeqmaia/oficina-kit/testing';
import { Role } from '@guilhermeqmaia/oficina-kit/auth';
import { AppModule } from '../app.module';
import { OS_SERVICE_URL } from '../orcamento/infrastructure/http-callback-os.gateway';
import { MP_ORDER_CLIENT } from '../orcamento/infrastructure/mercado-pago-sdk.gateway';
import { MercadoPagoFake } from './mercado-pago-fake';
import { ServidorHttpFake } from './servidor-http-fake';

/** Resposta do OS a um callback aplicado (`POST /ordens-servico/{n}/eventos`). */
export const CALLBACK_APLICADO = { aplicado: true, passo: 'X', status: 'EM_ANDAMENTO' };

export interface AppDeTeste {
  readonly app: INestApplication;
  /** OS Service: servidor HTTP real em 127.0.0.1 que grava os callbacks. */
  readonly os: ServidorHttpFake;
  /** Mercado Pago: fake da classe `Order` do SDK, com respostas roteirizadas. */
  readonly mp: MercadoPagoFake;
}

/**
 * Mesma configuracao HTTP do `main.ts`. Sem interceptar o modulo `http` (nock):
 * o OS e um servidor local de verdade e o Mercado Pago entra por provider.
 */
export async function subirApp(): Promise<AppDeTeste> {
  const os = new ServidorHttpFake({ status: 200, body: CALLBACK_APLICADO });
  await os.iniciar();
  const mp = new MercadoPagoFake();
  const ref = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OS_SERVICE_URL)
    .useValue(os.url)
    .overrideProvider(MP_ORDER_CLIENT)
    .useValue(mp)
    .compile();
  const app = ref.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, os, mp };
}

export async function pararApp(teste: AppDeTeste | undefined): Promise<void> {
  await teste?.app.close();
  await teste?.os.parar();
}

export const tokenServico = () => `Bearer ${mintServiceToken({ servico: 'os-service' })}`;

export const tokenCliente = (clienteId: string) =>
  `Bearer ${mintToken({ sub: clienteId, role: Role.CLIENTE })}`;

export const tokenAtendente = () => `Bearer ${mintToken({ sub: 'at-1', role: Role.ATENDENTE })}`;

export function corpoOrcamento(numeroOS: string, clienteId = 'cli-1') {
  return {
    numeroOS,
    clienteId,
    itens: [
      {
        tipo: 'SERVICO',
        referenciaId: 's1',
        nome: 'Troca de pastilha',
        quantidade: 1,
        precoUnitario: '200.00',
      },
      {
        tipo: 'PRODUTO',
        referenciaId: 'p1',
        servicoId: 's1',
        nome: 'Pastilha dianteira',
        quantidade: 2,
        precoUnitario: '50.00',
      },
    ],
  };
}

export function cabecalhosWebhook(orderId: string, requestId: string = randomUUID()) {
  const ts = String(Date.now());
  const v1 = createHmac('sha256', process.env.MP_WEBHOOK_SECRET as string)
    .update(`id:${orderId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

export interface CallbackRecebido {
  numero: string;
  corpo: Record<string, any>;
  autorizacao: string;
}

/** Callbacks que chegaram ao OS fake, na ordem. */
export function callbacksRecebidos(os: ServidorHttpFake): CallbackRecebido[] {
  return os.recebidas
    .filter((r) => r.method === 'POST' && /^\/ordens-servico\/.+\/eventos$/.test(r.url))
    .map((r) => ({
      numero: decodeURIComponent(r.url.split('/')[2]),
      corpo: r.body as Record<string, any>,
      autorizacao: String(r.headers.authorization),
    }));
}

/** Polling sem `sleep` fixo: callbacks saem depois da resposta HTTP. */
export async function ate(condicao: () => boolean | Promise<boolean>, limiteMs = 5000) {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) throw new Error('Condicao nao atendida no prazo');
    await new Promise((r) => setTimeout(r, 20));
  }
}
