import { createHmac, randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import { mintServiceToken, mintToken } from '@guilhermeqmaia/oficina-kit/testing';
import { Role } from '@guilhermeqmaia/oficina-kit/auth';
import { AppModule } from '../app.module';

export const OS_URL = 'http://os-service.test';
export const MP_URL = 'https://api.mercadopago.com';

/** Mesma configuracao HTTP do `main.ts`, com OS e Mercado Pago interceptados por nock. */
export async function subirApp(): Promise<INestApplication> {
  const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = ref.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  return app;
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

/** Simula o OS Service aceitando callbacks e guarda o que chegou. */
export function osRecebendoCallbacks(destino: CallbackRecebido[], vezes = 1, status = 200): void {
  nock(OS_URL)
    .post(/\/ordens-servico\/.+\/eventos/)
    .times(vezes)
    .reply(function (uri, corpo) {
      destino.push({
        numero: decodeURIComponent(uri.split('/')[2]),
        corpo: corpo as Record<string, unknown>,
        autorizacao: String(this.req.headers.authorization),
      });
      return [status, { aplicado: status === 200, passo: 'X', status: 'EM_ANDAMENTO' }];
    });
}

export function mpCriandoOrder(orderId: string, corpos: unknown[] = []): void {
  nock(MP_URL)
    .post('/v1/orders')
    .reply(201, (_uri, corpo) => {
      corpos.push(corpo);
      return { id: orderId, status: 'created', checkout_url: `https://mp.test/${orderId}` };
    });
}

export function mpConsultandoOrder(orderId: string, order: Record<string, unknown>): void {
  nock(MP_URL)
    .get(`/v1/orders/${orderId}`)
    .reply(200, { id: orderId, ...order });
}

export function mpCancelandoOrder(orderId: string): void {
  nock(MP_URL).post(`/v1/orders/${orderId}/cancel`).reply(200, { id: orderId, status: 'canceled' });
}

/** Polling sem `sleep` fixo: callbacks saem depois da resposta HTTP. */
export async function ate(condicao: () => boolean | Promise<boolean>, limiteMs = 5000) {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) throw new Error('Condicao nao atendida no prazo');
    await new Promise((r) => setTimeout(r, 20));
  }
}
