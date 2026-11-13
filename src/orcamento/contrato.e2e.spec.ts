import { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml');

jest.setTimeout(120000);

const raiz = path.resolve(__dirname, '../..');
const lerYaml = (arquivo: string) => yaml.load(fs.readFileSync(path.join(raiz, arquivo), 'utf8'));

/** Copia de docs/contratos/asyncapi.yaml do hub; o CI falha se ela divergir do original. */
const asyncapi = lerYaml('docs/contratos/asyncapi.yaml');

function resolverRefs(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(resolverRefs);
  if (!no || typeof no !== 'object') return no;
  const obj = no as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    return resolverRefs(asyncapi.components.schemas[obj.$ref.split('/').pop() as string]);
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolverRefs(v)]));
}

/** Schema de `data` publicado no AsyncAPI para o evento `nome`. */
function schemaDoEvento(nome: string): object {
  const mensagem = Object.values<any>(asyncapi.components.messages).find((m) => m.name === nome);
  if (!mensagem) throw new Error(`Evento ${nome} nao existe no AsyncAPI`);
  return resolverRefs(mensagem.payload.allOf[1].properties.data) as object;
}

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
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const http = () => request(app.getHttpServer());
  const gerar = () =>
    http().post('/orcamentos').set('Authorization', tokenServico()).send(corpoOrcamento(numero));

  function validarEvento(nome: string, dados: unknown) {
    const valido = ajv.validate(schemaDoEvento(nome), dados);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valido).toBe(true);
  }

  function validarCallback(callback: CallbackRecebido) {
    expect(ajv.validate(ENVELOPE, callback.corpo)).toBe(true);
    validarEvento(callback.corpo.type as string, callback.corpo.data);
    expect(callback.corpo.data.numeroOS).toBe(callback.numero);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = await startTestDatabase();
    app = await subirApp();
    // O arquivo publicado, nao um documento gerado na hora: o CI garante que ele acompanha o codigo.
    jestOpenAPI(lerYaml('openapi.yaml'));
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
    validarEvento('billing.orcamento-gerado', criado.body);
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
    validarEvento('billing.cobranca-criada', cobranca.body);

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

  it('pagamento recusado segue o schema do callback', async () => {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks);
    await http()
      .post(`/orcamentos/${numero}/aprovar`)
      .set('Authorization', tokenCliente('cli-1'))
      .expect(200);
    await ate(() => callbacks.length === 1);
    const orderId = `ORDCTR${seq}`;
    mpCriandoOrder(orderId);
    await http()
      .post(`/orcamentos/${numero}/cobrar`)
      .set('Authorization', tokenServico())
      .expect(201);
    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder(orderId, { status: 'failed', status_detail: 'cc_rejected' });
    await http()
      .post(`/webhooks/mercadopago?type=order&data.id=${orderId}`)
      .set(cabecalhosWebhook(orderId))
      .send({ action: 'order.processed', data: { id: orderId } })
      .expect(200);
    await ate(() => callbacks.length === 2);
    expect(callbacks[1].corpo.type).toBe('billing.pagamento-recusado');
    validarCallback(callbacks[1]);
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
    validarEvento('billing.orcamento-cancelado', cancelado.body);
  });
});
