import { createHmac } from 'crypto';
import { ArgumentsHost, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ClienteHttpInterno, HttpInternoError } from '@guilhermeqmaia/oficina-kit/http';
import { CallbackRecusadoError } from '../application/ports/callback-os.gateway';
import { CLIENTE } from '../../test/builders';
import { ReceberWebhookUseCase } from '../application/use-cases/receber-webhook.use-case';
import { ReconciliarUseCase } from '../application/use-cases/reconciliar.use-case';
import { ConcorrenciaError, OrcamentoConflitoError } from '../domain/errors';
import { assinaturaValida, TOLERANCIA_TS_MS } from './assinatura-webhook';
import { ConflitoTransitorioFilter } from './conflito-transitorio.filter';
import { HttpCallbackOsGateway, TIMEOUT_CALLBACK_MS } from './http-callback-os.gateway';
import { MercadoPagoSdkGateway, OrderClient } from './mercado-pago-sdk.gateway';
import { OrcamentoController } from './orcamento.controller';
import { OrcamentoConflitoFilter } from './orcamento-conflito.filter';
import { PagamentoController } from './pagamento.controller';
import { ReconciliacaoJob } from './reconciliacao.job';
import { WebhookController, webhooksRecebidos } from './webhook.controller';

const SEGREDO = 'segredo-de-teste';

function assinar(id: string, requestId: string, ts = String(Date.now()), segredo = SEGREDO) {
  const v1 = createHmac('sha256', segredo)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('assinaturaValida', () => {
  const dados = { xRequestId: 'r1', dataId: '123' };

  it('aceita a assinatura correta', () => {
    expect(assinaturaValida(SEGREDO, { ...dados, assinatura: assinar('123', 'r1') })).toBe(true);
  });

  it('usa o id em minusculas quando alfanumerico', () => {
    const assinatura = assinar('ord01abc', 'r1');
    expect(assinaturaValida(SEGREDO, { ...dados, dataId: 'ORD01ABC', assinatura })).toBe(true);
  });

  it('mantem o id com outros caracteres como veio', () => {
    const assinatura = assinar('ORD-1', 'r1');
    expect(assinaturaValida(SEGREDO, { ...dados, dataId: 'ORD-1', assinatura })).toBe(true);
  });

  it.each([
    ['segredo errado', { ...dados, assinatura: assinar('123', 'r1', '1', 'outro') }],
    ['id adulterado', { ...dados, dataId: '999', assinatura: assinar('123', 'r1') }],
    ['request-id adulterado', { ...dados, xRequestId: 'r2', assinatura: assinar('123', 'r1') }],
    ['sem assinatura', dados],
    ['sem request-id', { dataId: '123', assinatura: assinar('123', 'r1') }],
    ['sem ts', { ...dados, assinatura: 'v1=abc' }],
    ['sem v1', { ...dados, assinatura: 'ts=1' }],
    ['v1 de tamanho errado', { ...dados, assinatura: 'ts=1,v1=abcd' }],
  ])('rejeita: %s', (_nome, entrada) => {
    expect(assinaturaValida(SEGREDO, entrada)).toBe(false);
  });

  it('aceita ts em segundos dentro da janela', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(assinaturaValida(SEGREDO, { ...dados, assinatura: assinar('123', 'r1', ts) })).toBe(
      true,
    );
  });

  it.each([
    ['antigo', -1],
    ['no futuro', 1],
  ])('rejeita ts %s alem da tolerancia (replay)', (_nome, sinal) => {
    const agora = new Date('2026-11-15T12:00:00Z');
    const ts = String(agora.getTime() + sinal * (TOLERANCIA_TS_MS + 1000));
    const assinatura = assinar('123', 'r1', ts);
    expect(assinaturaValida(SEGREDO, { ...dados, assinatura }, agora)).toBe(false);
    expect(assinaturaValida(SEGREDO, { ...dados, assinatura }, new Date(Number(ts)))).toBe(true);
  });

  it('rejeita ts que nao e numero', () => {
    expect(assinaturaValida(SEGREDO, { ...dados, assinatura: assinar('123', 'r1', 'abc') })).toBe(
      false,
    );
  });

  it('sem segredo configurado nada e valido', () => {
    expect(assinaturaValida('', { ...dados, assinatura: assinar('123', 'r1') })).toBe(false);
  });
});

describe('MercadoPagoSdkGateway', () => {
  const orders: jest.Mocked<OrderClient> = { create: jest.fn(), get: jest.fn(), cancel: jest.fn() };
  const gateway = new MercadoPagoSdkGateway(orders, {
    payerEmail: 'comprador@testuser.com',
    retornoBaseUrl: 'https://oficina.test/pagamento/',
    expiracaoOrder: 'P1D',
  });
  const entrada = {
    numeroOS: 'OS-1',
    valor: '300.00',
    idempotencyKey: 'cobranca:OS-1:1',
    itens: [{ titulo: 'Troca', quantidade: 1, precoUnitario: '300.00' }],
  };

  beforeEach(() => jest.resetAllMocks());

  it('cria a order no formato do Checkout Pro', async () => {
    orders.create.mockResolvedValue({ id: 'ORD1', checkout_url: 'https://mp/1' });
    await expect(gateway.criarOrder(entrada)).resolves.toEqual({
      orderId: 'ORD1',
      linkPagamento: 'https://mp/1',
    });
    expect(orders.create).toHaveBeenCalledWith({
      body: {
        type: 'online',
        processing_mode: 'manual',
        external_reference: 'OS-1',
        total_amount: '300.00',
        expiration_time: 'P1D',
        payer: { email: 'comprador@testuser.com' },
        items: [{ title: 'Troca', quantity: 1, unit_price: '300.00' }],
        config: {
          online: {
            success_url: 'https://oficina.test/pagamento/sucesso',
            failure_url: 'https://oficina.test/pagamento/falha',
            pending_url: 'https://oficina.test/pagamento/pendente',
            auto_return: 'approved',
          },
        },
      },
      requestOptions: { idempotencyKey: 'cobranca:OS-1:1' },
    });
  });

  it('falha se a resposta nao trouxer checkout_url', async () => {
    orders.create.mockResolvedValue({ id: 'ORD1' });
    await expect(gateway.criarOrder(entrada)).rejects.toThrow('checkout_url');
    orders.create.mockResolvedValue({ checkout_url: 'x' });
    await expect(gateway.criarOrder(entrada)).rejects.toThrow('checkout_url');
  });

  it('traduz a consulta', async () => {
    orders.get.mockResolvedValue({
      status: 'processed',
      status_detail: 'accredited',
      transactions: { payments: [{ status: 'processed', status_detail: 'accredited' }] },
    });
    await expect(gateway.consultarOrder('ORD1')).resolves.toEqual({
      status: 'processed',
      statusDetail: 'accredited',
      pagamentos: [{ status: 'processed', statusDetail: 'accredited' }],
    });
  });

  it('order sem transacoes tem lista vazia', async () => {
    orders.get.mockResolvedValue({ status: 'created' });
    await expect(gateway.consultarOrder('ORD1')).resolves.toMatchObject({ pagamentos: [] });
  });

  it.each([
    [{ status: 400, message: 'payer comprador@testuser.com invalido' }, 'status 400'],
    [new Error('comprador@testuser.com'), 'status desconhecido'],
    [undefined, 'status desconhecido'],
  ])('erro do SDK nao vaza dados do pagador: %j', async (falha, esperado) => {
    orders.create.mockRejectedValue(falha);
    orders.get.mockRejectedValue(falha);
    orders.cancel.mockRejectedValue(falha);
    for (const chamada of [
      gateway.criarOrder(entrada),
      gateway.consultarOrder('ORD1'),
      gateway.cancelarOrder('ORD1'),
    ]) {
      const erro: Error = await chamada.catch((e) => e);
      expect(erro.message).toContain(esperado);
      expect(erro.message).not.toContain('comprador@');
    }
  });

  it('cancela com chave estavel', async () => {
    orders.cancel.mockResolvedValue({});
    await gateway.cancelarOrder('ORD1');
    expect(orders.cancel).toHaveBeenCalledWith({
      id: 'ORD1',
      requestOptions: { idempotencyKey: 'cancelar:ORD1' },
    });
  });
});

describe('HttpCallbackOsGateway', () => {
  it('envia o envelope com id estavel, correlacao e timeout ampliado', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200 });
    const gateway = new HttpCallbackOsGateway(
      { post } as unknown as ClienteHttpInterno,
      'http://os',
    );
    const occurredAt = new Date('2026-11-09T12:00:00Z');
    await gateway.enviar({
      id: '0192f3a0-7c6e-7d2a-9b1e-3f4c5d6e7f80',
      type: 'billing.orcamento-aprovado',
      numeroOS: 'OS 1',
      occurredAt,
      data: { numeroOS: 'OS 1', orcamentoId: 'o' },
    });
    expect(post).toHaveBeenCalledWith(
      'http://os/ordens-servico/OS%201/eventos',
      {
        id: '0192f3a0-7c6e-7d2a-9b1e-3f4c5d6e7f80',
        type: 'billing.orcamento-aprovado',
        version: 1,
        occurredAt: occurredAt.toISOString(),
        producer: 'billing-service',
        data: { numeroOS: 'OS 1', orcamentoId: 'o' },
      },
      { correlationId: 'OS 1', timeoutMs: TIMEOUT_CALLBACK_MS },
    );
  });
});

describe('HttpCallbackOsGateway: classificacao das falhas', () => {
  const evento = {
    id: 'cb',
    type: 'billing.orcamento-aprovado',
    numeroOS: 'OS-1',
    occurredAt: new Date(),
    data: {},
  };
  const falha = (status: number | undefined) =>
    new HttpInternoError('falhou', 'POST', 'http://os', status, {}, 1);
  const gatewayFalhando = (erro: unknown) =>
    new HttpCallbackOsGateway(
      { post: jest.fn().mockRejectedValue(erro) } as unknown as ClienteHttpInterno,
      'http://os',
    );

  it.each([400, 404])('%i do OS e recusa permanente', async (status) => {
    await expect(gatewayFalhando(falha(status)).enviar(evento)).rejects.toThrow(
      CallbackRecusadoError,
    );
  });

  it.each([
    ['409 (conflito de versao)', falha(409)],
    ['5xx esgotado', falha(503)],
    ['timeout', falha(undefined)],
    ['erro qualquer', new Error('rede')],
  ])('%s continua transitorio', async (_nome, erro) => {
    const promessa = gatewayFalhando(erro).enviar(evento);
    await expect(promessa).rejects.toBe(erro);
  });
});

describe('ConflitoTransitorioFilter', () => {
  it('responde 503 com Retry-After, nunca 409 { motivo }', () => {
    const json = jest.fn();
    const resposta = { status: jest.fn(), setHeader: jest.fn(), json };
    resposta.status.mockReturnValue(resposta);
    resposta.setHeader.mockReturnValue(resposta);
    const host = {
      switchToHttp: () => ({ getResponse: () => resposta }),
    } as unknown as ArgumentsHost;
    new ConflitoTransitorioFilter().catch(new ConcorrenciaError('Cobranca'), host);
    expect(resposta.status).toHaveBeenCalledWith(503);
    expect(resposta.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(json.mock.calls[0][0]).toMatchObject({ statusCode: 503 });
    expect(json.mock.calls[0][0]).not.toHaveProperty('motivo');
  });
});

describe('OrcamentoConflitoFilter', () => {
  it('responde 409 { motivo }', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    new OrcamentoConflitoFilter().catch(new OrcamentoConflitoError('nao aprovado'), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ motivo: 'nao aprovado' });
  });
});

async function valorMetrica(resultado: string): Promise<number> {
  const { values } = await webhooksRecebidos.get();
  return values.find((v) => v.labels.resultado === resultado)?.value ?? 0;
}

describe('WebhookController', () => {
  const execute = jest.fn();
  const controller = new WebhookController(
    { execute } as unknown as ReceberWebhookUseCase,
    SEGREDO,
  );
  const corpo = { action: 'order.processed', type: 'order', data: { id: 'corpo' } };

  beforeEach(() => execute.mockReset().mockResolvedValue(undefined));

  it('aceita data.id da query', async () => {
    const assinatura = assinar('ord1', 'r1');
    await expect(
      controller.mercadoPago({ 'data.id': 'ORD1', type: 'order' }, assinatura, 'r1', corpo),
    ).resolves.toEqual({ recebido: true });
    expect(execute).toHaveBeenCalledWith({
      orderId: 'ORD1',
      xRequestId: 'r1',
      tipo: 'order',
      action: 'order.processed',
      payload: corpo,
    });
  });

  it('aceita data_id', async () => {
    await controller.mercadoPago({ data_id: 'ord2' }, assinar('ord2', 'r1'), 'r1', corpo);
    expect(execute.mock.calls[0][0]).toMatchObject({ orderId: 'ord2', tipo: 'order' });
  });

  it('cai no corpo quando a query nao traz o id', async () => {
    await controller.mercadoPago({}, assinar('corpo', 'r1'), 'r1', corpo);
    expect(execute.mock.calls[0][0].orderId).toBe('corpo');
  });

  it('assinatura invalida: 401 sem gravar nada, so metrica', async () => {
    const antes = await valorMetrica('assinatura_invalida');
    await expect(
      controller.mercadoPago({ data_id: 'a' }, 'ts=1,v1=00', undefined, {}),
    ).rejects.toThrow(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
    expect(await valorMetrica('assinatura_invalida')).toBe(antes + 1);
  });

  it('sem type nem action segue com nulos', async () => {
    await controller.mercadoPago({ data_id: 'ord3' }, assinar('ord3', 'r1'), 'r1', {});
    expect(execute.mock.calls[0][0]).toMatchObject({ tipo: null, action: null });
  });

  it.each([
    ['sem id', {}, {}],
    ['id nao textual', {}, { data: { id: 1 } }],
    ['id longo demais', { data_id: 'x'.repeat(129) }, {}],
  ])('400: %s', async (_nome, query, body) => {
    await expect(controller.mercadoPago(query, 'x', 'r', body)).rejects.toThrow(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('Controllers', () => {
  const gerar = { execute: jest.fn() };
  const cobrar = { execute: jest.fn() };
  const cancelar = { execute: jest.fn() };
  const decidir = { execute: jest.fn() };
  const consultas = { listar: jest.fn(), buscar: jest.fn(), pagamento: jest.fn() };
  const controller = new OrcamentoController(
    gerar as never,
    cobrar as never,
    cancelar as never,
    decidir as never,
    consultas as never,
  );

  it.each([
    [true, 201],
    [false, 200],
  ])('POST /orcamentos criado=%s responde %i sem vazar o flag', async (criado, http) => {
    gerar.execute.mockResolvedValue({ criado, numeroOS: 'OS-1' });
    const status = jest.fn();
    const saida = await controller.criar({} as never, { status } as never);
    expect(status).toHaveBeenCalledWith(http);
    expect(saida).toEqual({ numeroOS: 'OS-1' });
  });

  it('delegam aos casos de uso', () => {
    controller.cobrar('OS-1');
    expect(cobrar.execute).toHaveBeenCalledWith({ numeroOS: 'OS-1' });
    controller.cancelar('OS-1', { motivo: 'm' });
    expect(cancelar.execute).toHaveBeenCalledWith({ numeroOS: 'OS-1', motivo: 'm' });
    controller.aprovar('OS-1', CLIENTE);
    expect(decidir.execute).toHaveBeenCalledWith({
      numeroOS: 'OS-1',
      usuario: CLIENTE,
      decisao: 'APROVAR',
    });
    controller.rejeitar('OS-1', { motivo: 'm' }, CLIENTE);
    expect(decidir.execute).toHaveBeenLastCalledWith({
      numeroOS: 'OS-1',
      usuario: CLIENTE,
      decisao: 'REJEITAR',
      motivo: 'm',
    });
    controller.listar('c', CLIENTE);
    expect(consultas.listar).toHaveBeenCalledWith('c', CLIENTE);
    controller.buscar('OS-1', CLIENTE);
    expect(consultas.buscar).toHaveBeenCalledWith('OS-1', CLIENTE);
    new PagamentoController(consultas as never).buscar('OS-1', CLIENTE);
    expect(consultas.pagamento).toHaveBeenCalledWith('OS-1', CLIENTE);
  });
});

describe('ReconciliacaoJob', () => {
  const execute = jest.fn();
  const reconciliar = { execute } as unknown as ReconciliarUseCase;

  beforeEach(() => execute.mockReset().mockResolvedValue(undefined));

  it('nao roda quando desabilitado', async () => {
    await new ReconciliacaoJob(reconciliar, false).executar();
    expect(execute).not.toHaveBeenCalled();
  });

  it('nao sobrepoe execucoes e libera ao terminar', async () => {
    let terminar = () => {};
    execute.mockReturnValueOnce(new Promise<void>((r) => (terminar = r)));
    const job = new ReconciliacaoJob(reconciliar, true);
    const primeira = job.executar();
    await job.executar();
    expect(execute).toHaveBeenCalledTimes(1);
    terminar();
    await primeira;
    await job.executar();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('nao propaga falhas', async () => {
    execute.mockRejectedValue(new Error('banco fora'));
    await expect(new ReconciliacaoJob(reconciliar, true).executar()).resolves.toBeUndefined();
  });
});
