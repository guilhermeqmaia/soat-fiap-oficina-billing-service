import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import jestOpenAPI from 'jest-openapi';
import nock from 'nock';
import request from 'supertest';
import {
  ate,
  CallbackRecebido,
  cabecalhosWebhook,
  corpoOrcamento,
  mpConsultandoOrder,
  mpCriandoOrder,
  osRecebendoCallbacks,
  subirApp,
  tokenCliente,
  tokenServico,
} from '../test/app-harness';
import { startTestDatabase, stopTestDatabase } from '../test/database.container';

jest.setTimeout(120000);

const DINHEIRO = { type: 'string', pattern: '^\\d+\\.\\d{2}$' };
const TEXTO = { type: 'string' };

function dados(required: string[], properties: Record<string, unknown>) {
  return { type: 'object', required, properties };
}

/** `data` de cada callback, transcrito de docs/contratos/asyncapi.yaml no hub. */
const SCHEMAS_DATA: Record<string, unknown> = {
  'billing.orcamento-aprovado': dados(['numeroOS', 'orcamentoId'], {
    numeroOS: TEXTO,
    orcamentoId: TEXTO,
  }),
  'billing.orcamento-rejeitado': dados(['numeroOS', 'orcamentoId'], {
    numeroOS: TEXTO,
    orcamentoId: TEXTO,
    motivo: TEXTO,
  }),
  'billing.pagamento-aprovado': dados(['numeroOS', 'orderId', 'valor'], {
    numeroOS: TEXTO,
    orderId: TEXTO,
    valor: DINHEIRO,
  }),
  'billing.pagamento-recusado': dados(['numeroOS', 'orderId', 'motivo'], {
    numeroOS: TEXTO,
    orderId: TEXTO,
    motivo: TEXTO,
  }),
};

const ENVELOPE = {
  type: 'object',
  required: ['id', 'type', 'version', 'occurredAt', 'producer', 'data'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string', pattern: '^[a-z]+\\.[a-z-]+$' },
    version: { type: 'integer', minimum: 1 },
    occurredAt: { type: 'string', format: 'date-time' },
    producer: { enum: ['billing-service'] },
    data: { type: 'object' },
  },
  not: { required: ['correlationId'] },
};

describe('Contrato HTTP (docs/contratos/http-interno.md)', () => {
  let app: INestApplication;
  let seq = 0;
  let numero: string;
  let callbacks: CallbackRecebido[];
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  const http = () => request(app.getHttpServer());
  const gerar = () =>
    http().post('/orcamentos').set('Authorization', tokenServico()).send(corpoOrcamento(numero));

  function validarCallback(callback: CallbackRecebido) {
    expect(ajv.validate(ENVELOPE, callback.corpo)).toBe(true);
    const schema = SCHEMAS_DATA[callback.corpo.type as string];
    expect(schema).toBeDefined();
    expect(ajv.validate(schema as object, callback.corpo.data)).toBe(true);
    expect(callback.corpo.data.numeroOS).toBe(callback.numero);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = await startTestDatabase();
    app = await subirApp();
    const config = new DocumentBuilder().setTitle('billing').setVersion('1.0').build();
    const documento = SwaggerModule.createDocument(app, config);
    jestOpenAPI(documento as unknown as Parameters<typeof jestOpenAPI>[0]);
  });

  afterAll(async () => {
    nock.restore();
    await app.close();
    await stopTestDatabase();
  });

  beforeEach(() => {
    nock.cleanAll();
    callbacks = [];
    numero = `OS-CT-${++seq}`;
  });

  it('POST /orcamentos: 201 e 200 com o schema publicado', async () => {
    const criado = await gerar().expect(201);
    expect(criado).toSatisfyApiSpec();
    expect(criado.body.total).toMatch(/^\d+\.\d{2}$/);
    expect(await gerar().expect(200)).toSatisfyApiSpec();
  });

  it('aprovar, cobrar, webhook e callbacks de sucesso', async () => {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks);
    const aprovado = await http()
      .post(`/orcamentos/${numero}/aprovar`)
      .set('Authorization', tokenCliente('cli-1'))
      .expect(200);
    expect(aprovado).toSatisfyApiSpec();
    await ate(() => callbacks.length === 1);

    const orderId = `ORDCT${seq}`;
    mpCriandoOrder(orderId);
    const cobranca = await http()
      .post(`/orcamentos/${numero}/cobrar`)
      .set('Authorization', tokenServico())
      .expect(201);
    expect(cobranca).toSatisfyApiSpec();

    expect(
      await http()
        .get(`/orcamentos/${numero}`)
        .set('Authorization', tokenCliente('cli-1'))
        .expect(200),
    ).toSatisfyApiSpec();
    expect(
      await http()
        .get(`/pagamentos/${numero}`)
        .set('Authorization', tokenCliente('cli-1'))
        .expect(200),
    ).toSatisfyApiSpec();

    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder(orderId, { status: 'processed', status_detail: 'accredited' });
    const webhook = await http()
      .post(`/webhooks/mercadopago?type=order&data.id=${orderId}`)
      .set(cabecalhosWebhook(orderId))
      .send({ action: 'order.processed', data: { id: orderId } })
      .expect(200);
    expect(webhook).toSatisfyApiSpec();
    await ate(() => callbacks.length === 2);
    callbacks.forEach(validarCallback);
  });

  it('rejeicao e pagamento recusado seguem o schema do callback', async () => {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks);
    const rejeitado = await http()
      .post(`/orcamentos/${numero}/rejeitar`)
      .set('Authorization', tokenCliente('cli-1'))
      .send({ motivo: 'caro' })
      .expect(200);
    expect(rejeitado).toSatisfyApiSpec();
    await ate(() => callbacks.length === 1);
    validarCallback(callbacks[0]);
  });

  it('409 { motivo } de cobrar nao aprovado', async () => {
    await gerar().expect(201);
    const conflito = await http()
      .post(`/orcamentos/${numero}/cobrar`)
      .set('Authorization', tokenServico())
      .expect(409);
    expect(conflito).toSatisfyApiSpec();
    expect(typeof conflito.body.motivo).toBe('string');
  });

  it('DELETE segue o schema', async () => {
    await gerar().expect(201);
    const cancelado = await http()
      .delete(`/orcamentos/${numero}`)
      .set('Authorization', tokenServico())
      .send({ motivo: 'OS cancelada' })
      .expect(200);
    expect(cancelado).toSatisfyApiSpec();
    expect(cancelado.body.estornado).toBe(false);
  });
});
