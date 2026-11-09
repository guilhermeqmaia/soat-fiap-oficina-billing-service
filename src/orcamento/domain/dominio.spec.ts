import {
  cobrancaComOrder,
  novaCobranca,
  novoOrcamento,
  orcamentoAprovado,
} from '../../test/builders';
import { Cobranca } from './cobranca.entity';
import { Dinheiro } from './dinheiro.vo';
import { Orcamento } from './orcamento.entity';
import { OrcamentoConflitoError, ValorMonetarioInvalidoError } from './errors';
import { interpretarOrder } from './resultado-order';
import { StatusCobranca, StatusOrcamento, TipoLancamento } from './tipos';

const AGORA = new Date('2026-11-09T12:00:00Z');

describe('Dinheiro', () => {
  it('opera em centavos e formata com 2 casas', () => {
    expect(Dinheiro.de('0.10').somar(Dinheiro.de('0.20')).toString()).toBe('0.30');
    expect(Dinheiro.de('19.99').multiplicar(3).toString()).toBe('59.97');
    expect(Dinheiro.zero().toString()).toBe('0.00');
  });

  it.each(['10', '10.5', '-1.00', 'abc'])('rejeita %s', (valor) => {
    expect(() => Dinheiro.de(valor)).toThrow(ValorMonetarioInvalidoError);
  });
});

describe('Orcamento', () => {
  it('nasce PENDENTE com total calculado dos itens congelados', () => {
    const { status, subtotal, total, version } = novoOrcamento().dados;
    expect(status).toBe(StatusOrcamento.PENDENTE);
    expect(subtotal.toString()).toBe('300.00');
    expect(total.toString()).toBe('300.00');
    expect(version).toBe(0);
  });

  it('aprovar e idempotente e gera um evento sem motivo', () => {
    const orcamento = novoOrcamento();
    expect(orcamento.aprovar(AGORA, 'cb-1')).toBe(true);
    expect(orcamento.aprovar(AGORA, 'cb-2')).toBe(false);
    expect(orcamento.eventoPendente()).toEqual({
      id: 'cb-1',
      type: 'billing.orcamento-aprovado',
      numeroOS: 'OS-1',
      occurredAt: AGORA,
      data: { numeroOS: 'OS-1', orcamentoId: 'orc-1' },
    });
  });

  it('rejeitar leva o motivo ao evento, e so quando informado', () => {
    const comMotivo = novoOrcamento();
    expect(comMotivo.rejeitar(AGORA, 'cb-1', 'caro')).toBe(true);
    expect(comMotivo.rejeitar(AGORA, 'cb-2')).toBe(false);
    expect(comMotivo.eventoPendente()?.data).toEqual({
      numeroOS: 'OS-1',
      orcamentoId: 'orc-1',
      motivo: 'caro',
    });

    const semMotivo = novoOrcamento();
    semMotivo.rejeitar(AGORA, 'cb-1');
    expect(semMotivo.eventoPendente()?.data).not.toHaveProperty('motivo');
  });

  it('imutavel apos a decisao: nao aprova rejeitado nem rejeita aprovado', () => {
    const rejeitado = novoOrcamento();
    rejeitado.rejeitar(AGORA, 'cb');
    expect(() => rejeitado.aprovar(AGORA, 'x')).toThrow(OrcamentoConflitoError);
    expect(() => orcamentoAprovado().rejeitar(AGORA, 'x')).toThrow(OrcamentoConflitoError);
  });

  it('so vence enquanto PENDENTE', () => {
    const validoAte = new Date(AGORA.getTime() - 1);
    expect(novoOrcamento({ validoAte }).venceu(AGORA)).toBe(true);
    expect(novoOrcamento({ validoAte: AGORA }).venceu(AGORA)).toBe(false);
    const aprovado = novoOrcamento({ validoAte });
    aprovado.aprovar(AGORA, 'cb');
    expect(aprovado.venceu(AGORA)).toBe(false);
  });

  it('expirar exige PENDENTE', () => {
    const orcamento = novoOrcamento();
    orcamento.expirar();
    expect(orcamento.dados.status).toBe(StatusOrcamento.EXPIRADO);
    expect(() => orcamento.expirar()).toThrow(OrcamentoConflitoError);
  });

  it('cancelar so atua em orcamento ativo', () => {
    const orcamento = novoOrcamento();
    expect(orcamento.cancelar('m')).toBe(true);
    expect(orcamento.dados.motivoCancelamento).toBe('m');
    expect(orcamento.cancelar('m')).toBe(false);
  });

  it('nao ha evento sem decisao, depois de entregue ou apos cancelar', () => {
    expect(novoOrcamento().eventoPendente()).toBeNull();

    const cancelado = orcamentoAprovado();
    cancelado.cancelar('m');
    expect(cancelado.eventoPendente()).toBeNull();

    const props = { ...orcamentoAprovado().dados };
    props.callback = { id: 'cb', ultimaTentativaEm: AGORA, entregueEm: AGORA };
    const entregue = Orcamento.reconstituir(props);
    expect(entregue.eventoPendente()).toBeNull();
  });

  it('gera lancamento com o total', () => {
    expect(novoOrcamento().lancamento(TipoLancamento.ORCAMENTO_GERADO, AGORA)).toMatchObject({
      tipo: TipoLancamento.ORCAMENTO_GERADO,
      orcamentoId: 'orc-1',
      numeroOS: 'OS-1',
      ocorridoEm: AGORA,
    });
  });
});

describe('Cobranca', () => {
  const recusada = { tipo: 'RECUSADA', motivo: 'cc_rejected' } as const;

  it('deriva a chave de idempotencia da tentativa', () => {
    expect(novaCobranca(2).dados.idempotencyKey).toBe('cobranca:OS-1:2');
  });

  it('aprovada gera billing.pagamento-aprovado com o valor', () => {
    const cobranca = cobrancaComOrder();
    expect(cobranca.aplicar({ tipo: 'APROVADA' }, AGORA, 'cb-1')).toBe(true);
    expect(cobranca.dados.pagoEm).toBe(AGORA);
    expect(cobranca.eventoPendente()).toEqual({
      id: 'cb-1',
      type: 'billing.pagamento-aprovado',
      numeroOS: 'OS-1',
      occurredAt: AGORA,
      data: { numeroOS: 'OS-1', orderId: 'ORD1', valor: '300.00' },
    });
  });

  it('recusada gera billing.pagamento-recusado com o motivo', () => {
    const cobranca = cobrancaComOrder();
    expect(cobranca.aplicar(recusada, AGORA, 'cb-1')).toBe(true);
    expect(cobranca.dados.status).toBe(StatusCobranca.RECUSADA);
    expect(cobranca.eventoPendente()).toMatchObject({
      type: 'billing.pagamento-recusado',
      data: { numeroOS: 'OS-1', orderId: 'ORD1', motivo: 'cc_rejected' },
    });
  });

  it('expirada tambem avisa o OS como recusa', () => {
    const cobranca = cobrancaComOrder();
    cobranca.aplicar({ tipo: 'EXPIRADA', motivo: 'cobranca expirada' }, AGORA, 'cb-1');
    expect(cobranca.dados.status).toBe(StatusCobranca.EXPIRADA);
    expect(cobranca.eventoPendente()?.type).toBe('billing.pagamento-recusado');
  });

  it('PENDENTE no Mercado Pago nao muda nada', () => {
    const cobranca = cobrancaComOrder();
    expect(cobranca.aplicar({ tipo: 'PENDENTE' }, AGORA, 'cb')).toBe(false);
    expect(cobranca.eventoPendente()).toBeNull();
  });

  it('recusada ainda pode ser paga no mesmo checkout, com novo callback', () => {
    const cobranca = cobrancaComOrder();
    cobranca.aplicar(recusada, AGORA, 'cb-1');
    expect(cobranca.aplicar(recusada, AGORA, 'cb-2')).toBe(false);
    expect(cobranca.aplicar({ tipo: 'APROVADA' }, AGORA, 'cb-3')).toBe(true);
    expect(cobranca.dados.motivoRecusa).toBeNull();
    expect(cobranca.eventoPendente()).toMatchObject({
      id: 'cb-3',
      type: 'billing.pagamento-aprovado',
    });
  });

  it('estados finais nao mudam', () => {
    const aprovada = cobrancaComOrder();
    aprovada.aplicar({ tipo: 'APROVADA' }, AGORA, 'cb');
    expect(aprovada.aplicar(recusada, AGORA, 'cb-2')).toBe(false);
    expect(aprovada.cancelar()).toBe(false);
  });

  it('reaproveitavel apenas se pendente ou paga', () => {
    const cobranca = cobrancaComOrder();
    expect(cobranca.reaproveitavel).toBe(true);
    cobranca.aplicar(recusada, AGORA, 'cb');
    expect(cobranca.reaproveitavel).toBe(false);
  });

  it('cancelar so atua em PENDENTE e nao gera callback', () => {
    const cobranca = cobrancaComOrder();
    expect(cobranca.cancelar()).toBe(true);
    expect(cobranca.dados.status).toBe(StatusCobranca.CANCELADA);
    expect(cobranca.eventoPendente()).toBeNull();
  });

  it('sem data de decisao ou ja entregue nao ha evento', () => {
    const paga = cobrancaComOrder();
    paga.aplicar({ tipo: 'APROVADA' }, AGORA, 'cb');
    const entregue = Cobranca.reconstituir({
      ...paga.dados,
      callback: { id: 'cb', ultimaTentativaEm: AGORA, entregueEm: AGORA },
    });
    expect(entregue.eventoPendente()).toBeNull();
    const semData = Cobranca.reconstituir({ ...paga.dados, pagoEm: null });
    expect(semData.eventoPendente()).toBeNull();
  });

  it('recusa sem motivo gravado usa o texto padrao', () => {
    const recusa = cobrancaComOrder();
    recusa.aplicar(recusada, AGORA, 'cb');
    const semMotivo = Cobranca.reconstituir({ ...recusa.dados, motivoRecusa: null });
    expect(semMotivo.eventoPendente()?.data.motivo).toBe('pagamento recusado');
  });

  it('lancamento leva o orderId', () => {
    expect(cobrancaComOrder().lancamento(TipoLancamento.COBRANCA_CRIADA, AGORA)).toMatchObject({
      orderId: 'ORD1',
      orcamentoId: 'orc-1',
    });
  });
});

describe('interpretarOrder', () => {
  const pagamentos: Array<{ status?: string; statusDetail?: string }> = [];

  it.each([
    [{ status: 'processed', statusDetail: 'accredited', pagamentos }, { tipo: 'APROVADA' }],
    [
      { status: 'processed', pagamentos: [{ status: 'processed', statusDetail: 'accredited' }] },
      { tipo: 'APROVADA' },
    ],
    [{ status: 'processed', statusDetail: 'partially_refunded', pagamentos }, { tipo: 'PENDENTE' }],
    [
      { status: 'expired', pagamentos },
      { tipo: 'EXPIRADA', motivo: 'cobranca expirada' },
    ],
    [
      { status: 'failed', statusDetail: 'cc_rejected', pagamentos },
      { tipo: 'RECUSADA', motivo: 'cc_rejected' },
    ],
    [
      { status: 'canceled', pagamentos },
      { tipo: 'RECUSADA', motivo: 'canceled' },
    ],
    [
      { status: 'action_required', statusDetail: 'failed', pagamentos },
      { tipo: 'RECUSADA', motivo: 'failed' },
    ],
    [
      { status: 'action_required', pagamentos: [{ status: 'failed', statusDetail: 'bad_cvv' }] },
      { tipo: 'RECUSADA', motivo: 'bad_cvv' },
    ],
    [
      { status: 'action_required', pagamentos: [{ status: 'failed' }] },
      { tipo: 'RECUSADA', motivo: 'failed' },
    ],
    [{ status: 'action_required', pagamentos: [{ status: 'processing' }] }, { tipo: 'PENDENTE' }],
    [{ status: 'action_required', pagamentos }, { tipo: 'PENDENTE' }],
    [{ status: 'created', pagamentos }, { tipo: 'PENDENTE' }],
    [{ pagamentos }, { tipo: 'PENDENTE' }],
  ])('%j -> %j', (situacao, esperado) => {
    expect(interpretarOrder(situacao)).toEqual(esperado);
  });
});
