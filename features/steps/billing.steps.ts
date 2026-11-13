import { strict as assert } from 'assert';
import { Given, Then, When } from '@cucumber/cucumber';
import nock from 'nock';
import request from 'supertest';
import {
  ate,
  cabecalhosWebhook,
  corpoOrcamento,
  mpCancelandoOrder,
  mpConsultandoOrder,
  mpCriandoOrder,
  osRecebendoCallbacks,
  tokenCliente,
  tokenServico,
} from '../../src/test/app-harness';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReconciliarUseCase } from '../../src/orcamento/application/use-cases/reconciliar.use-case';
import { app, BillingWorld } from '../support/world';

const http = () => request(app.getHttpServer());
const prisma = () => app.get(PrismaService);
const DIA_MS = 24 * 60 * 60 * 1000;

function gerar(world: BillingWorld) {
  return http()
    .post('/orcamentos')
    .set('Authorization', tokenServico())
    .send(corpoOrcamento(world.numero));
}

function cobrar(world: BillingWorld) {
  return http().post(`/orcamentos/${world.numero}/cobrar`).set('Authorization', tokenServico());
}

function decidir(world: BillingWorld, acao: string, clienteId = 'cli-1', motivo?: string) {
  return http()
    .post(`/orcamentos/${world.numero}/${acao}`)
    .set('Authorization', tokenCliente(clienteId))
    .send(motivo ? { motivo } : {});
}

async function callbackEntregue(world: BillingWorld) {
  await ate(async () => {
    const row = await prisma().orcamento.findFirstOrThrow({ where: { numeroOS: world.numero } });
    return row.callbackEntregueEm !== null;
  });
}

function comWebhook(world: BillingWorld, cabecalhos: Record<string, string>) {
  return http()
    .post(`/webhooks/mercadopago?type=order&data.id=${world.orderId}`)
    .set(cabecalhos)
    .send({ action: 'order.processed', type: 'order', data: { id: world.orderId } });
}

Given('que o orcamento ja foi gerado', async function (this: BillingWorld) {
  await gerar(this).expect(201);
});

Given('que o cliente ja aprovou o orcamento', async function (this: BillingWorld) {
  osRecebendoCallbacks(this.callbacks);
  await decidir(this, 'aprovar').expect(200);
  await ate(() => this.callbacks.length === 1);
  await callbackEntregue(this);
  this.callbacks.length = 0;
});

Given('que a cobranca ja foi criada', async function (this: BillingWorld) {
  mpCriandoOrder(this.orderId);
  await cobrar(this).expect(201);
});

Given(
  'que o Mercado Pago informa a order como {string} com detalhe {string}',
  function (this: BillingWorld, status: string, detalhe: string) {
    mpConsultandoOrder(this.orderId, { status, status_detail: detalhe });
    if (status !== 'action_required') osRecebendoCallbacks(this.callbacks);
  },
);

Given(
  'que o webhook assinado ja chegou e o pagamento foi recusado',
  async function (this: BillingWorld) {
    await comWebhook(this, cabecalhosWebhook(this.orderId)).expect(200);
    await ate(() => this.callbacks.length === 1);
    await ate(async () => {
      const row = await prisma().cobranca.findFirstOrThrow({ where: { numeroOS: this.numero } });
      return row.status === 'RECUSADA' && row.callbackEntregueEm !== null;
    });
  },
);

When('o OS Service solicita uma nova cobranca', async function (this: BillingWorld) {
  mpCancelandoOrder(this.orderId);
  mpCriandoOrder(`${this.orderId}N`);
  this.resposta = await cobrar(this);
});

When('o OS Service solicita o orcamento', async function (this: BillingWorld) {
  this.resposta = await gerar(this);
});

When('o OS Service cancela o orcamento', async function (this: BillingWorld) {
  this.resposta = await http()
    .delete(`/orcamentos/${this.numero}`)
    .set('Authorization', tokenServico())
    .send({ motivo: 'OS cancelada' });
});

When('o cliente aprova o orcamento', async function (this: BillingWorld) {
  osRecebendoCallbacks(this.callbacks);
  this.resposta = await decidir(this, 'aprovar');
});

When(
  'o cliente rejeita o orcamento com o motivo {string}',
  async function (this: BillingWorld, motivo: string) {
    osRecebendoCallbacks(this.callbacks);
    this.resposta = await decidir(this, 'rejeitar', 'cli-1', motivo);
  },
);

When('outro cliente tenta aprovar o orcamento', async function (this: BillingWorld) {
  this.resposta = await decidir(this, 'aprovar', 'cli-2');
});

When('o OS Service solicita a cobranca', async function (this: BillingWorld) {
  mpCriandoOrder(this.orderId);
  this.resposta = await cobrar(this);
});

When(
  /^o OS Service solicita a cobranca (novamente|sem order prevista)$/,
  async function (this: BillingWorld, _modo: string) {
    this.resposta = await cobrar(this);
  },
);

When('o webhook assinado chega', async function (this: BillingWorld) {
  this.resposta = await comWebhook(this, cabecalhosWebhook(this.orderId));
});

When('um webhook com assinatura invalida chega', async function (this: BillingWorld) {
  this.resposta = await comWebhook(this, { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'ruim' });
});

When('a reconciliacao e executada', async function () {
  await app.get(ReconciliarUseCase).execute(new Date(Date.now() + 60 * 60 * 1000));
});

Then('a resposta tem status {int}', function (this: BillingWorld, status: number) {
  assert.equal(this.resposta.status, status, JSON.stringify(this.resposta.body));
});

Then('o webhook e aceito', function (this: BillingWorld) {
  assert.equal(this.resposta.status, 200);
});

Then('o total do orcamento e {string}', function (this: BillingWorld, total: string) {
  assert.equal(this.resposta.body.total, total);
});

Then('o orcamento vale por {int} dias', function (this: BillingWorld, dias: number) {
  const restante = new Date(this.resposta.body.validoAte).getTime() - Date.now();
  assert.ok(Math.abs(restante - dias * DIA_MS) < 60_000);
});

Then('o ledger registra {string}', async function (this: BillingWorld, tipo: string) {
  const total = await prisma().lancamento.count({
    where: { numeroOS: this.numero, tipo: tipo as never },
  });
  assert.equal(total, 1);
});

Then('o ledger registra {string} uma unica vez', async function (this: BillingWorld, tipo: string) {
  const total = await prisma().lancamento.count({
    where: { numeroOS: this.numero, tipo: tipo as never },
  });
  assert.equal(total, 1);
});

Then('existe um unico orcamento para a OS', async function (this: BillingWorld) {
  assert.equal(await prisma().orcamento.count({ where: { numeroOS: this.numero } }), 1);
});

Then('existe uma unica cobranca para a OS', async function (this: BillingWorld) {
  assert.equal(await prisma().cobranca.count({ where: { numeroOS: this.numero } }), 1);
});

Then('nada foi estornado', function (this: BillingWorld) {
  assert.equal(this.resposta.body.estornado, false);
});

Then('o OS Service recebe o callback {string}', async function (this: BillingWorld, tipo: string) {
  await ate(() => this.callbacks.length === 1);
  assert.equal(this.callbacks[0].corpo.type, tipo);
  assert.equal(this.callbacks[0].numero, this.numero);
});

Then('o callback traz o motivo {string}', function (this: BillingWorld, motivo: string) {
  assert.equal(this.callbacks[0].corpo.data.motivo, motivo);
});

Then(
  'a resposta traz o link de pagamento e o valor {string}',
  function (this: BillingWorld, valor: string) {
    assert.match(this.resposta.body.linkPagamento, /^https:/);
    assert.equal(this.resposta.body.orderId, this.orderId);
    assert.equal(this.resposta.body.valor, valor);
  },
);

Then('a resposta traz uma nova order', function (this: BillingWorld) {
  assert.equal(this.resposta.body.orderId, `${this.orderId}N`);
});

Then('a order anterior e cancelada no Mercado Pago', function () {
  assert.deepEqual(nock.pendingMocks(), []);
});

Then('a resposta informa o motivo', function (this: BillingWorld) {
  assert.equal(typeof this.resposta.body.motivo, 'string');
});

Then('nenhum callback de pagamento e enviado', async function (this: BillingWorld) {
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(this.callbacks.length, 0);
});

Then('a cobranca fica {string}', async function (this: BillingWorld, status: string) {
  await ate(async () => {
    const row = await prisma().cobranca.findFirstOrThrow({ where: { numeroOS: this.numero } });
    return row.status === status;
  });
});
