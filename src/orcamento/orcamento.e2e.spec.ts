import { INestApplication } from '@nestjs/common';
import nock from 'nock';
import request from 'supertest';
import {
  ate,
  CallbackRecebido,
  cabecalhosWebhook,
  corpoOrcamento,
  mpCancelandoOrder,
  mpConsultandoOrder,
  mpCriandoOrder,
  osRecebendoCallbacks,
  subirApp,
  tokenAtendente,
  tokenCliente,
  tokenServico,
} from '../test/app-harness';
import { startTestDatabase, stopTestDatabase } from '../test/database.container';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliarUseCase } from './application/use-cases/reconciliar.use-case';

jest.setTimeout(120000);

const PAGO = { status: 'processed', status_detail: 'accredited' };
const DEPOIS_DA_JANELA = () => new Date(Date.now() + 60 * 60 * 1000);

describe('Billing (e2e com Postgres real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let callbacks: CallbackRecebido[];
  let seq = 0;
  let numero: string;

  const http = () => request(app.getHttpServer());
  const gerar = () =>
    http().post('/orcamentos').set('Authorization', tokenServico()).send(corpoOrcamento(numero));
  const aprovar = () =>
    http().post(`/orcamentos/${numero}/aprovar`).set('Authorization', tokenCliente('cli-1'));
  const cobrar = () =>
    http().post(`/orcamentos/${numero}/cobrar`).set('Authorization', tokenServico());
  const webhook = (orderId: string, cabecalhos = cabecalhosWebhook(orderId)) =>
    http()
      .post(`/webhooks/mercadopago?type=order&data.id=${orderId}`)
      .set(cabecalhos)
      .send({ action: 'order.processed', type: 'order', data: { id: orderId } });
  const tiposLedger = async () =>
    (
      await prisma.lancamento.findMany({
        where: { numeroOS: numero },
        orderBy: { id: 'asc' },
      })
    ).map((l) => l.tipo);

  async function aprovado() {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks);
    await aprovar().expect(200);
    await ate(() => callbacks.length === 1);
    await ate(async () => {
      const row = await prisma.orcamento.findFirstOrThrow({ where: { numeroOS: numero } });
      return row.callbackEntregueEm !== null;
    });
    callbacks.length = 0;
  }

  async function comOrder(orderId: string) {
    await aprovado();
    mpCriandoOrder(orderId);
    await cobrar().expect(201);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = await startTestDatabase();
    app = await subirApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    nock.restore();
    await app.close();
    await stopTestDatabase();
  });

  beforeEach(() => {
    nock.cleanAll();
    callbacks = [];
    numero = `OS-E2E-${++seq}`;
  });

  it('caminho feliz: orcamento, aprovacao, cobranca, webhook e callback', async () => {
    const corpoMp: unknown[] = [];
    const gerado = await gerar().expect(201);
    expect(gerado.body).toMatchObject({ numeroOS: numero, total: '300.00' });

    osRecebendoCallbacks(callbacks);
    const decisao = await aprovar().expect(200);
    expect(decisao.body.status).toBe('APROVADO');
    await ate(() => callbacks.length === 1);
    expect(callbacks[0]).toMatchObject({
      numero,
      corpo: {
        type: 'billing.orcamento-aprovado',
        version: 1,
        producer: 'billing-service',
        data: { numeroOS: numero, orcamentoId: gerado.body.orcamentoId },
      },
    });
    expect(callbacks[0].autorizacao).toMatch(/^Bearer /);

    mpCriandoOrder('ORD1E2E', corpoMp);
    const cobranca = await cobrar().expect(201);
    expect(cobranca.body).toEqual({
      numeroOS: numero,
      orderId: 'ORD1E2E',
      linkPagamento: 'https://mp.test/ORD1E2E',
      valor: '300.00',
    });
    expect(corpoMp[0]).toMatchObject({
      external_reference: numero,
      total_amount: '300.00',
      processing_mode: 'manual',
    });

    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder('ORD1E2E', PAGO);
    await webhook('ORD1E2E').expect(200, { recebido: true });
    await ate(() => callbacks.length === 2);
    expect(callbacks[1].corpo).toMatchObject({
      type: 'billing.pagamento-aprovado',
      data: { numeroOS: numero, orderId: 'ORD1E2E', valor: '300.00' },
    });

    await ate(async () => (await tiposLedger()).length === 4);
    expect(await tiposLedger()).toEqual([
      'ORCAMENTO_GERADO',
      'ORCAMENTO_APROVADO',
      'COBRANCA_CRIADA',
      'PAGAMENTO_APROVADO',
    ]);

    const pagamento = await http()
      .get(`/pagamentos/${numero}`)
      .set('Authorization', tokenCliente('cli-1'))
      .expect(200);
    expect(pagamento.body).toMatchObject({ orderId: 'ORD1E2E', status: 'APROVADA' });
  });

  it('POST /orcamentos repetido devolve 200 com o existente', async () => {
    const primeiro = await gerar().expect(201);
    const segundo = await gerar().expect(200);
    expect(segundo.body).toEqual(primeiro.body);
  });

  it('POSTs simultaneos criam um unico orcamento (indice parcial)', async () => {
    const respostas = await Promise.all([gerar(), gerar(), gerar(), gerar()]);
    expect(respostas.map((r) => r.status).filter((s) => s === 201).length).toBe(1);
    expect(respostas.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await prisma.orcamento.count({ where: { numeroOS: numero } })).toBe(1);
  });

  it('valida o corpo e as roles', async () => {
    await http()
      .post('/orcamentos')
      .set('Authorization', tokenServico())
      .send({ numeroOS: numero, clienteId: 'c', itens: [] })
      .expect(400);
    await http()
      .post('/orcamentos')
      .set('Authorization', tokenCliente('cli-1'))
      .send(corpoOrcamento(numero))
      .expect(403);
    await http().post('/orcamentos').send(corpoOrcamento(numero)).expect(401);
  });

  it('posse: outro cliente recebe 403; atendente consulta', async () => {
    await gerar().expect(201);
    await http()
      .post(`/orcamentos/${numero}/aprovar`)
      .set('Authorization', tokenCliente('cli-2'))
      .expect(403);
    await http()
      .get(`/orcamentos/${numero}`)
      .set('Authorization', tokenCliente('cli-2'))
      .expect(403);
    await http().get(`/orcamentos/${numero}`).set('Authorization', tokenAtendente()).expect(200);
    const lista = await http()
      .get('/orcamentos?clienteId=cli-1')
      .set('Authorization', tokenAtendente())
      .expect(200);
    expect(lista.body.some((o: { numeroOS: string }) => o.numeroOS === numero)).toBe(true);
  });

  it('rejeicao gera callback com motivo e o orcamento nao pode ser aprovado depois', async () => {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks);
    await http()
      .post(`/orcamentos/${numero}/rejeitar`)
      .set('Authorization', tokenCliente('cli-1'))
      .send({ motivo: 'caro' })
      .expect(200);
    await ate(() => callbacks.length === 1);
    expect(callbacks[0].corpo).toMatchObject({
      type: 'billing.orcamento-rejeitado',
      data: { motivo: 'caro' },
    });
    const conflito = await aprovar().expect(409);
    expect(conflito.body.motivo).toContain('REJEITADO');
  });

  it('cobrar sem aprovacao responde 409 { motivo } e sem orcamento 404', async () => {
    await cobrar().expect(404);
    await gerar().expect(201);
    const resposta = await cobrar().expect(409);
    expect(Object.keys(resposta.body)).toEqual(['motivo']);
  });

  it('cobrar repetido nao cria outra order', async () => {
    await comOrder('ORD2E2E');
    const repetida = await cobrar().expect(201);
    expect(repetida.body.orderId).toBe('ORD2E2E');
    expect(await prisma.cobranca.count({ where: { numeroOS: numero } })).toBe(1);
  });

  it('falha no Mercado Pago responde 5xx e a repeticao reaproveita a reserva', async () => {
    await aprovado();
    const chaves: string[] = [];
    nock('https://api.mercadopago.com')
      .post('/v1/orders')
      .reply(500, function () {
        chaves.push(String(this.req.headers['x-idempotency-key']));
        return { message: 'erro' };
      });
    await cobrar().expect(500);
    nock('https://api.mercadopago.com')
      .post('/v1/orders')
      .reply(201, function () {
        chaves.push(String(this.req.headers['x-idempotency-key']));
        return { id: 'ORD3E2E', status: 'created', checkout_url: 'https://mp.test/3' };
      });
    await cobrar().expect(201);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(1);
  });

  it('logs nao expoem o pagador nem quando o Mercado Pago devolve o e-mail no erro', async () => {
    await aprovado();
    const saida: string[] = [];
    const capturar = (texto: string | Uint8Array) => {
      saida.push(String(texto));
      return true;
    };
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(capturar);
    try {
      nock('https://api.mercadopago.com')
        .post('/v1/orders')
        .reply(400, { message: 'payer comprador@testuser.com invalido', status: 400 });
      await cobrar().expect(500);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const logs = saida.join('');
    expect(logs).toContain('Mercado Pago falhou');
    expect(logs).not.toContain(process.env.MP_PAYER_EMAIL as string);
  });

  it('webhook com assinatura invalida: 401, auditado e sem consultar a order', async () => {
    await comOrder('ORD4E2E');
    await webhook('ORD4E2E', { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'r-ruim' }).expect(401);
    const auditoria = await prisma.webhookMercadoPago.findFirstOrThrow({
      where: { orderId: 'ORD4E2E' },
    });
    expect(auditoria).toMatchObject({ assinaturaValida: false, payload: {} });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('webhook repetido: registra uma vez e nao duplica o callback', async () => {
    await comOrder('ORD5E2E');
    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder('ORD5E2E', PAGO);
    const cabecalhos = cabecalhosWebhook('ORD5E2E');
    await webhook('ORD5E2E', cabecalhos).expect(200);
    await ate(() => callbacks.length === 1);
    await ate(async () => {
      const row = await prisma.cobranca.findFirstOrThrow({ where: { numeroOS: numero } });
      return row.callbackEntregueEm !== null;
    });
    await webhook('ORD5E2E', cabecalhos).expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(callbacks).toHaveLength(1);
    expect(await prisma.webhookMercadoPago.count({ where: { orderId: 'ORD5E2E' } })).toBe(1);
  });

  it('recusa avisa o OS e cobrar emite nova order, cancelando a anterior', async () => {
    await comOrder('ORD6E2E');
    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder('ORD6E2E', { status: 'failed', status_detail: 'cc_rejected' });
    await webhook('ORD6E2E').expect(200);
    await ate(() => callbacks.length === 1);
    expect(callbacks[0].corpo).toMatchObject({
      type: 'billing.pagamento-recusado',
      data: { orderId: 'ORD6E2E', motivo: 'cc_rejected' },
    });

    mpCancelandoOrder('ORD6E2E');
    mpCriandoOrder('ORD7E2E');
    const nova = await cobrar().expect(201);
    expect(nova.body.orderId).toBe('ORD7E2E');
    expect(nock.isDone()).toBe(true);
  });

  it('DELETE e idempotente, inclusive sem orcamento', async () => {
    const motivo = { motivo: 'OS cancelada' };
    const del = () =>
      http().delete(`/orcamentos/${numero}`).set('Authorization', tokenServico()).send(motivo);
    await del().expect(200, { numeroOS: numero, orcamentoId: null, estornado: false });
    const { body } = await gerar().expect(201);
    const esperado = { numeroOS: numero, orcamentoId: body.orcamentoId, estornado: false };
    await del().expect(200, esperado);
    await del().expect(200, esperado);
    expect(await tiposLedger()).toEqual(['ORCAMENTO_GERADO', 'ORCAMENTO_CANCELADO']);
  });

  it('reconciliacao reenvia o callback com o mesmo id quando o OS falhou', async () => {
    await gerar().expect(201);
    osRecebendoCallbacks(callbacks, 3, 503);
    await aprovar().expect(200);
    await ate(() => callbacks.length === 3, 15000);
    const idOriginal = callbacks[0].corpo.id;
    await ate(async () => nock.pendingMocks().length === 0);

    await new Promise((r) => setTimeout(r, 100));
    osRecebendoCallbacks(callbacks);
    await app.get(ReconciliarUseCase).execute(DEPOIS_DA_JANELA());
    expect(callbacks).toHaveLength(4);
    expect(callbacks[3].corpo.id).toBe(idOriginal);
    const row = await prisma.orcamento.findFirstOrThrow({ where: { numeroOS: numero } });
    expect(row.callbackEntregueEm).not.toBeNull();
  });

  it('reconciliacao fecha cobranca cujo webhook se perdeu', async () => {
    await comOrder('ORD8E2E');
    await prisma.orcamento.updateMany({
      where: { callbackEntregueEm: null },
      data: { callbackEntregueEm: new Date() },
    });
    osRecebendoCallbacks(callbacks);
    mpConsultandoOrder('ORD8E2E', PAGO);
    await app.get(ReconciliarUseCase).execute(DEPOIS_DA_JANELA());
    expect(callbacks[0].corpo.type).toBe('billing.pagamento-aprovado');
    const row = await prisma.cobranca.findFirstOrThrow({ where: { numeroOS: numero } });
    expect(row.status).toBe('APROVADA');
  });

  it('ledger e append-only no banco', async () => {
    await gerar().expect(201);
    await expect(
      prisma.lancamento.updateMany({ where: { numeroOS: numero }, data: { valor: '1.00' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.lancamento.deleteMany({ where: { numeroOS: numero } })).rejects.toThrow(
      /append-only/,
    );
  });
});
