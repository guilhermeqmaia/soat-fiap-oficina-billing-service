import { NotOwnedByUserError } from '@guilhermeqmaia/oficina-kit/core';
import {
  ATENDENTE,
  CLIENTE,
  cobrancaComOrder,
  FakeBillingRepository,
  novaCobranca,
  novoOrcamento,
  orcamentoAprovado,
  OUTRO_CLIENTE,
} from '../../../test/builders';
import {
  ClienteIdObrigatorioError,
  CobrancaNaoEncontradaError,
  ConcorrenciaError,
  OrcamentoConflitoError,
  OrcamentoNaoEncontradoError,
  RegistroDuplicadoError,
} from '../../domain/errors';
import { StatusCobranca, StatusOrcamento, TipoItem, TipoLancamento } from '../../domain/tipos';
import { EntregaCallbacksService } from '../entrega-callbacks.service';
import { MercadoPagoGateway } from '../ports/mercado-pago.gateway';
import { BillingConfig } from '../ports/billing.config';
import { CancelarOrcamentoUseCase } from './cancelar-orcamento.use-case';
import { CobrarOrcamentoUseCase } from './cobrar-orcamento.use-case';
import { ConsultasOrcamentoUseCase } from './consultas.use-case';
import { DecidirOrcamentoUseCase } from './decidir-orcamento.use-case';
import { GerarOrcamentoUseCase } from './gerar-orcamento.use-case';
import { ProcessarOrderUseCase } from './processar-order.use-case';
import { ReceberWebhookUseCase } from './receber-webhook.use-case';
import { ReconciliarUseCase } from './reconciliar.use-case';

const CONFIG: BillingConfig = {
  validadeOrcamentoMs: 1000,
  reentregaCallbackMs: 100,
  reconciliacaoMs: 200,
  loteReconciliacao: 10,
};

let contador = 0;
const ids = { novo: () => `id-${++contador}` };

let repo: FakeBillingRepository;
let mp: jest.Mocked<MercadoPagoGateway>;
let enviar: jest.Mock;
let callbacks: EntregaCallbacksService;

const tipos = () => repo.lancamentos.map((l) => l.tipo);
const aguardar = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  repo = new FakeBillingRepository();
  mp = {
    criarOrder: jest.fn().mockResolvedValue({ orderId: 'ORD1', linkPagamento: 'https://mp/1' }),
    consultarOrder: jest.fn(),
    cancelarOrder: jest.fn().mockResolvedValue(undefined),
  };
  enviar = jest.fn().mockResolvedValue(undefined);
  callbacks = new EntregaCallbacksService({ enviar }, repo);
});

describe('GerarOrcamentoUseCase', () => {
  const entrada = {
    numeroOS: 'OS-1',
    clienteId: 'cli-1',
    itens: [
      {
        tipo: TipoItem.SERVICO,
        referenciaId: 's',
        nome: 'n',
        quantidade: 2,
        precoUnitario: '10.50',
      },
    ],
  };
  const useCase = () => new GerarOrcamentoUseCase(repo, CONFIG, ids);

  it('cria com total, validade e lancamento', async () => {
    const saida = await useCase().execute(entrada);
    expect(saida).toMatchObject({ criado: true, numeroOS: 'OS-1', total: '21.00' });
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_GERADO]);
  });

  it('repetir devolve o ativo existente', async () => {
    const primeira = await useCase().execute(entrada);
    const segunda = await useCase().execute(entrada);
    expect(segunda).toEqual({ ...primeira, criado: false });
    expect(repo.orcamentos).toHaveLength(1);
  });

  it('um vencido expira e da lugar a outro', async () => {
    const vencido = novoOrcamento({ validoAte: new Date(Date.now() - 1) });
    repo.orcamentos.push(vencido);
    const saida = await useCase().execute(entrada);
    expect(saida.criado).toBe(true);
    expect(vencido.dados.status).toBe(StatusOrcamento.EXPIRADO);
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_EXPIRADO, TipoLancamento.ORCAMENTO_GERADO]);
  });

  it('na corrida de criacao devolve o orcamento do concorrente', async () => {
    const concorrente = novoOrcamento({ id: 'orc-concorrente' });
    repo.falhas.push(new RegistroDuplicadoError());
    repo.aoFalhar = () => repo.orcamentos.push(concorrente);
    const saida = await useCase().execute(entrada);
    expect(saida).toMatchObject({ criado: false, orcamentoId: 'orc-concorrente' });
  });

  it('propaga duplicidade sem concorrente visivel e outros erros', async () => {
    repo.falhas.push(new RegistroDuplicadoError());
    await expect(useCase().execute(entrada)).rejects.toThrow(RegistroDuplicadoError);
    repo.falhas.push(new Error('banco fora'));
    await expect(useCase().execute(entrada)).rejects.toThrow('banco fora');
  });
});

describe('DecidirOrcamentoUseCase', () => {
  const useCase = () => new DecidirOrcamentoUseCase(repo, ids, callbacks);
  const aprovar = { numeroOS: 'OS-1', usuario: CLIENTE, decisao: 'APROVAR' as const };
  const rejeitar = { ...aprovar, decisao: 'REJEITAR' as const, motivo: 'caro' };

  it('aprova, registra no ledger e envia o callback', async () => {
    repo.orcamentos.push(novoOrcamento());
    const saida = await useCase().execute(aprovar);
    await aguardar();
    expect(saida.status).toBe(StatusOrcamento.APROVADO);
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_APROVADO]);
    expect(enviar).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'billing.orcamento-aprovado' }),
    );
    expect(repo.entreguesOrcamento).toEqual(['orc-1']);
  });

  it('rejeita com motivo', async () => {
    repo.orcamentos.push(novoOrcamento());
    const saida = await useCase().execute(rejeitar);
    await aguardar();
    expect(saida).toMatchObject({ status: StatusOrcamento.REJEITADO, motivoRejeicao: 'caro' });
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_REJEITADO]);
    expect(enviar.mock.calls[0][0].type).toBe('billing.orcamento-rejeitado');
  });

  it('repetir a decisao nao gera outro callback', async () => {
    repo.orcamentos.push(novoOrcamento());
    await useCase().execute(aprovar);
    await useCase().execute(aprovar);
    await aguardar();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(repo.lancamentos).toHaveLength(1);
  });

  it('404 sem orcamento e 403 para outro cliente', async () => {
    await expect(useCase().execute(aprovar)).rejects.toThrow(OrcamentoNaoEncontradoError);
    repo.orcamentos.push(novoOrcamento());
    await expect(useCase().execute({ ...aprovar, usuario: OUTRO_CLIENTE })).rejects.toThrow(
      NotOwnedByUserError,
    );
    expect(repo.persistir).not.toHaveBeenCalled();
  });

  it('vencido expira e recusa a decisao', async () => {
    const vencido = novoOrcamento({ validoAte: new Date(Date.now() - 1) });
    repo.orcamentos.push(vencido);
    await expect(useCase().execute(aprovar)).rejects.toThrow(OrcamentoConflitoError);
    expect(vencido.dados.status).toBe(StatusOrcamento.EXPIRADO);
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_EXPIRADO]);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe('CobrarOrcamentoUseCase', () => {
  const useCase = () => new CobrarOrcamentoUseCase(repo, mp, ids);
  const entrada = { numeroOS: 'OS-1' };

  it('404 sem orcamento e 409 se nao aprovado', async () => {
    await expect(useCase().execute(entrada)).rejects.toThrow(OrcamentoNaoEncontradoError);
    repo.orcamentos.push(novoOrcamento());
    await expect(useCase().execute(entrada)).rejects.toThrow(OrcamentoConflitoError);
    expect(mp.criarOrder).not.toHaveBeenCalled();
  });

  it('cria a order com os itens congelados e a chave da tentativa', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const saida = await useCase().execute(entrada);
    expect(saida).toEqual({
      numeroOS: 'OS-1',
      orderId: 'ORD1',
      linkPagamento: 'https://mp/1',
      valor: '300.00',
    });
    expect(mp.criarOrder).toHaveBeenCalledWith({
      numeroOS: 'OS-1',
      valor: '300.00',
      idempotencyKey: 'cobranca:OS-1:1',
      itens: [
        { titulo: 'Troca de pastilha', quantidade: 1, precoUnitario: '200.00' },
        { titulo: 'Pastilha dianteira', quantidade: 2, precoUnitario: '50.00' },
      ],
    });
    expect(tipos()).toEqual([TipoLancamento.COBRANCA_CRIADA]);
  });

  it('repetir devolve a cobranca vigente sem nova order', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const primeira = await useCase().execute(entrada);
    expect(await useCase().execute(entrada)).toEqual(primeira);
    expect(mp.criarOrder).toHaveBeenCalledTimes(1);
  });

  it('se o Mercado Pago falhou, repete com a mesma chave', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    mp.criarOrder.mockRejectedValueOnce(new Error('timeout'));
    await expect(useCase().execute(entrada)).rejects.toThrow('timeout');
    await useCase().execute(entrada);
    expect(mp.criarOrder.mock.calls[1][0].idempotencyKey).toBe('cobranca:OS-1:1');
    expect(repo.cobrancas).toHaveLength(1);
  });

  it('apos recusa cria nova tentativa e cancela a order antiga', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const recusada = cobrancaComOrder(1, 'ORD-ANTIGA');
    recusada.aplicar({ tipo: 'RECUSADA', motivo: 'x' }, new Date(), 'cb');
    repo.cobrancas.push(recusada);
    await useCase().execute(entrada);
    expect(mp.cancelarOrder).toHaveBeenCalledWith('ORD-ANTIGA');
    expect(mp.criarOrder.mock.calls[0][0].idempotencyKey).toBe('cobranca:OS-1:2');
  });

  it('falha ao cancelar a order antiga nao impede a nova', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const recusada = cobrancaComOrder(1, 'ORD-ANTIGA');
    recusada.aplicar({ tipo: 'RECUSADA', motivo: 'x' }, new Date(), 'cb');
    repo.cobrancas.push(recusada);
    mp.cancelarOrder.mockRejectedValueOnce(new Error('ja expirada'));
    await expect(useCase().execute(entrada)).resolves.toMatchObject({ orderId: 'ORD1' });
  });

  it('recusa sem order nao tenta cancelar', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const recusada = novaCobranca();
    recusada.aplicar({ tipo: 'RECUSADA', motivo: 'x' }, new Date(), 'cb');
    repo.cobrancas.push(recusada);
    await useCase().execute(entrada);
    expect(mp.cancelarOrder).not.toHaveBeenCalled();
  });

  it('na corrida reaproveita a cobranca do concorrente', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    repo.falhas.push(new RegistroDuplicadoError());
    repo.aoFalhar = () => repo.cobrancas.push(cobrancaComOrder(1, 'ORD-CONCORRENTE'));
    await expect(useCase().execute(entrada)).resolves.toMatchObject({
      orderId: 'ORD-CONCORRENTE',
    });
    expect(mp.criarOrder).not.toHaveBeenCalled();
  });

  it('propaga outros erros ao reservar', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    repo.falhas.push(new RegistroDuplicadoError());
    await expect(useCase().execute(entrada)).rejects.toThrow(RegistroDuplicadoError);
    repo.falhas.push(new Error('banco fora'));
    await expect(useCase().execute(entrada)).rejects.toThrow('banco fora');
  });
});

describe('CancelarOrcamentoUseCase', () => {
  const useCase = () => new CancelarOrcamentoUseCase(repo, mp);
  const entrada = { numeroOS: 'OS-1', motivo: 'OS cancelada' };

  it('200 mesmo sem orcamento', async () => {
    await expect(useCase().execute(entrada)).resolves.toEqual({
      numeroOS: 'OS-1',
      orcamentoId: null,
      estornado: false,
    });
  });

  it('cancela e repetir nao gera outro lancamento', async () => {
    repo.orcamentos.push(novoOrcamento());
    const saida = await useCase().execute(entrada);
    await useCase().execute(entrada);
    expect(saida).toEqual({ numeroOS: 'OS-1', orcamentoId: 'orc-1', estornado: false });
    expect(tipos()).toEqual([TipoLancamento.ORCAMENTO_CANCELADO]);
  });

  it('cancela a cobranca pendente e a order', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    repo.cobrancas.push(cobrancaComOrder());
    await useCase().execute(entrada);
    expect(tipos()).toEqual([
      TipoLancamento.ORCAMENTO_CANCELADO,
      TipoLancamento.COBRANCA_CANCELADA,
    ]);
    expect(mp.cancelarOrder).toHaveBeenCalledWith('ORD1');
  });

  it('cobranca sem order nao chama o Mercado Pago', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    repo.cobrancas.push(novaCobranca());
    await useCase().execute(entrada);
    expect(repo.cobrancas[0].dados.status).toBe(StatusCobranca.CANCELADA);
    expect(mp.cancelarOrder).not.toHaveBeenCalled();
  });

  it('falha no Mercado Pago nao desfaz o cancelamento', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    repo.cobrancas.push(cobrancaComOrder());
    mp.cancelarOrder.mockRejectedValueOnce(new Error('fora'));
    await expect(useCase().execute(entrada)).resolves.toMatchObject({ orcamentoId: 'orc-1' });
  });

  it('409 com pagamento aprovado', async () => {
    repo.orcamentos.push(orcamentoAprovado());
    const paga = cobrancaComOrder();
    paga.aplicar({ tipo: 'APROVADA' }, new Date(), 'cb');
    repo.cobrancas.push(paga);
    await expect(useCase().execute(entrada)).rejects.toThrow(OrcamentoConflitoError);
  });
});

describe('ConsultasOrcamentoUseCase', () => {
  const useCase = () => new ConsultasOrcamentoUseCase(repo);

  it('buscar: 404, posse e visao com cobranca', async () => {
    await expect(useCase().buscar('OS-1', CLIENTE)).rejects.toThrow(OrcamentoNaoEncontradoError);
    repo.orcamentos.push(orcamentoAprovado());
    repo.cobrancas.push(cobrancaComOrder());
    await expect(useCase().buscar('OS-1', OUTRO_CLIENTE)).rejects.toThrow(NotOwnedByUserError);
    const visao = await useCase().buscar('OS-1', CLIENTE);
    expect(visao.cobranca).toEqual({
      orderId: 'ORD1',
      status: StatusCobranca.PENDENTE,
      linkPagamento: 'https://mp/ORD1'.replace('mp/', 'mp.test/'),
      valor: '300.00',
    });
    expect(visao.itens[1]).toMatchObject({ servicoId: 's1', precoUnitario: '50.00' });
    expect(visao.itens[0].servicoId).toBeNull();
    expect(visao.decididoEm).not.toBeNull();
  });

  it('atendente enxerga orcamento de qualquer cliente', async () => {
    repo.orcamentos.push(novoOrcamento());
    const visao = await useCase().buscar('OS-1', ATENDENTE);
    expect(visao).toMatchObject({ cobranca: null, decididoEm: null });
  });

  it('listar: cliente ve so o proprio, staff precisa informar', async () => {
    repo.orcamentos.push(novoOrcamento());
    await expect(useCase().listar(undefined, CLIENTE)).resolves.toHaveLength(1);
    await expect(useCase().listar('cli-1', CLIENTE)).resolves.toHaveLength(1);
    await expect(useCase().listar('cli-2', CLIENTE)).rejects.toThrow(NotOwnedByUserError);
    await expect(useCase().listar(undefined, ATENDENTE)).rejects.toThrow(ClienteIdObrigatorioError);
    await expect(useCase().listar('cli-1', ATENDENTE)).resolves.toHaveLength(1);
  });

  it('pagamento: 404 sem orcamento ou sem cobranca, e posse', async () => {
    await expect(useCase().pagamento('OS-1', CLIENTE)).rejects.toThrow(CobrancaNaoEncontradaError);
    repo.orcamentos.push(orcamentoAprovado());
    await expect(useCase().pagamento('OS-1', CLIENTE)).rejects.toThrow(CobrancaNaoEncontradaError);
    repo.cobrancas.push(cobrancaComOrder());
    await expect(useCase().pagamento('OS-1', OUTRO_CLIENTE)).rejects.toThrow(NotOwnedByUserError);
    await expect(useCase().pagamento('OS-1', CLIENTE)).resolves.toMatchObject({ orderId: 'ORD1' });
  });
});

describe('ProcessarOrderUseCase', () => {
  const useCase = () => new ProcessarOrderUseCase(repo, mp, ids, callbacks);
  const pago = { status: 'processed', statusDetail: 'accredited', pagamentos: [] };

  it('order desconhecida e ignorada', async () => {
    await useCase().porOrderId('ORD-X');
    expect(mp.consultarOrder).not.toHaveBeenCalled();
  });

  it('aprovada: consulta a API, grava o ledger e avisa o OS', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValue(pago);
    await useCase().porOrderId('ORD1');
    expect(mp.consultarOrder).toHaveBeenCalledWith('ORD1');
    expect(tipos()).toEqual([TipoLancamento.PAGAMENTO_APROVADO]);
    expect(enviar.mock.calls[0][0].type).toBe('billing.pagamento-aprovado');
    expect(repo.entreguesCobranca).toEqual(['cob-1']);
  });

  it('recusada grava PAGAMENTO_RECUSADO', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValue({ status: 'failed', pagamentos: [] });
    await useCase().porOrderId('ORD1');
    expect(tipos()).toEqual([TipoLancamento.PAGAMENTO_RECUSADO]);
  });

  it('webhook repetido nao duplica efeito', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValue(pago);
    await useCase().porOrderId('ORD1');
    await useCase().porOrderId('ORD1');
    expect(mp.consultarOrder).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('action_required nao bloqueia o processed seguinte', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValueOnce({ status: 'action_required', pagamentos: [] });
    await useCase().porOrderId('ORD1');
    mp.consultarOrder.mockResolvedValueOnce(pago);
    await useCase().porOrderId('ORD1');
    expect(tipos()).toEqual([TipoLancamento.PAGAMENTO_APROVADO]);
  });

  it('ignora cobranca sem order ou cancelada', async () => {
    await useCase().porCobranca(novaCobranca());
    const cancelada = cobrancaComOrder();
    cancelada.cancelar();
    await useCase().porCobranca(cancelada);
    expect(mp.consultarOrder).not.toHaveBeenCalled();
  });

  it('corrida entre webhook e job: quem perde sai sem avisar', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValue(pago);
    repo.falhas.push(new ConcorrenciaError('Cobranca'));
    await useCase().porOrderId('ORD1');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('propaga outros erros de persistencia', async () => {
    repo.cobrancas.push(cobrancaComOrder());
    mp.consultarOrder.mockResolvedValue(pago);
    repo.falhas.push(new Error('banco fora'));
    await expect(useCase().porOrderId('ORD1')).rejects.toThrow('banco fora');
  });
});

describe('ReceberWebhookUseCase', () => {
  let porOrderId: jest.Mock;
  const useCase = () =>
    new ReceberWebhookUseCase(repo, { porOrderId } as unknown as ProcessarOrderUseCase);
  const entrada = {
    orderId: 'ORD1',
    xRequestId: 'r1',
    tipo: 'order',
    action: 'order.processed',
    payload: { a: 1 },
    assinaturaValida: true,
  };

  beforeEach(() => {
    porOrderId = jest.fn().mockResolvedValue(undefined);
  });

  it('registra e dispara o processamento', async () => {
    await useCase().execute(entrada);
    expect(repo.webhooks[0]).toMatchObject({ payload: { a: 1 }, assinaturaValida: true });
    expect(porOrderId).toHaveBeenCalledWith('ORD1');
  });

  it('assinatura invalida: audita sem guardar o corpo nem processar', async () => {
    await useCase().execute({ ...entrada, assinaturaValida: false });
    expect(repo.webhooks[0]).toMatchObject({ payload: {}, assinaturaValida: false });
    expect(porOrderId).not.toHaveBeenCalled();
  });

  it('notificacao de outro tipo nao processa', async () => {
    await useCase().execute({ ...entrada, tipo: 'payment' });
    expect(porOrderId).not.toHaveBeenCalled();
  });

  it('falha no processamento nao derruba a resposta', async () => {
    porOrderId.mockRejectedValue(new Error('MP fora'));
    await expect(useCase().execute(entrada)).resolves.toBeUndefined();
    await aguardar();
  });
});

describe('ReconciliarUseCase', () => {
  const AGORA = new Date('2026-11-09T12:00:00Z');
  let porCobranca: jest.Mock;
  const useCase = () =>
    new ReconciliarUseCase(repo, CONFIG, callbacks, {
      porCobranca,
    } as unknown as ProcessarOrderUseCase);

  beforeEach(() => {
    porCobranca = jest.fn().mockResolvedValue(undefined);
  });

  it('reenvia callbacks com o mesmo id e consulta as pendentes', async () => {
    const aprovado = orcamentoAprovado();
    const paga = cobrancaComOrder(1, 'ORD-PAGA');
    paga.aplicar({ tipo: 'APROVADA' }, AGORA, 'cb-paga');
    const pendente = cobrancaComOrder(2, 'ORD-PEND');
    repo.reservaOrcamentos = [aprovado];
    repo.reservaCobrancasCallback = [paga];
    repo.reservaCobrancasPendentes = [pendente];
    const reservar = jest.spyOn(repo, 'reservarCobrancasPendentes');

    await useCase().execute(AGORA);

    expect(enviar.mock.calls.map((c) => c[0].id)).toEqual(['cb-aprovado', 'cb-paga']);
    expect(porCobranca).toHaveBeenCalledWith(pendente);
    expect(reservar).toHaveBeenCalledWith(new Date(AGORA.getTime() - 200), AGORA, 10);
  });

  it('uma falha nao interrompe o lote', async () => {
    repo.reservaCobrancasPendentes = [cobrancaComOrder(1), cobrancaComOrder(2, 'ORD2')];
    porCobranca.mockRejectedValueOnce(new Error('MP fora'));
    await useCase().execute();
    expect(porCobranca).toHaveBeenCalledTimes(2);
  });
});

describe('EntregaCallbacksService', () => {
  it('sem evento pendente nao envia', async () => {
    await callbacks.entregarOrcamento(novoOrcamento());
    expect(enviar).not.toHaveBeenCalled();
  });

  it('falha no OS mantem pendente e nao rejeita', async () => {
    enviar.mockRejectedValue(new Error('OS fora'));
    await expect(callbacks.entregarOrcamento(orcamentoAprovado())).resolves.toBeUndefined();
    expect(repo.entreguesOrcamento).toEqual([]);
  });
});
