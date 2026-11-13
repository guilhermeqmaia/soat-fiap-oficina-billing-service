import { AuthenticatedUser, Role } from '@guilhermeqmaia/oficina-kit/auth';
import {
  Alteracoes,
  BillingRepository,
  OrcamentoComCobranca,
  RegistroWebhook,
} from '../orcamento/domain/billing.repository';
import { Cobranca } from '../orcamento/domain/cobranca.entity';
import { Dinheiro } from '../orcamento/domain/dinheiro.vo';
import { CriarOrcamentoInput, Orcamento } from '../orcamento/domain/orcamento.entity';
import { Lancamento, TipoItem } from '../orcamento/domain/tipos';

const DIA_MS = 24 * 60 * 60 * 1000;

export const ITENS = [
  {
    tipo: TipoItem.SERVICO,
    referenciaId: 's1',
    nome: 'Troca de pastilha',
    quantidade: 1,
    precoUnitario: Dinheiro.de('200.00'),
  },
  {
    tipo: TipoItem.PRODUTO,
    referenciaId: 'p1',
    servicoId: 's1',
    nome: 'Pastilha dianteira',
    quantidade: 2,
    precoUnitario: Dinheiro.de('50.00'),
  },
];

export const CLIENTE = new AuthenticatedUser('cli-1', 'Cliente', '12345678909', Role.CLIENTE);
export const OUTRO_CLIENTE = new AuthenticatedUser('cli-2', 'Outro', '98765432100', Role.CLIENTE);
export const ATENDENTE = new AuthenticatedUser('at-1', 'Atendente', null, Role.ATENDENTE);

export function novoOrcamento(sobrescrever: Partial<CriarOrcamentoInput> = {}): Orcamento {
  return Orcamento.criar({
    id: 'orc-1',
    numeroOS: 'OS-1',
    clienteId: 'cli-1',
    itens: ITENS,
    validoAte: new Date(Date.now() + DIA_MS),
    ...sobrescrever,
  });
}

export function orcamentoAprovado(): Orcamento {
  const orcamento = novoOrcamento();
  orcamento.aprovar(new Date(), 'cb-aprovado');
  return orcamento;
}

export function novaCobranca(tentativa = 1): Cobranca {
  return Cobranca.criar({
    id: `cob-${tentativa}`,
    orcamentoId: 'orc-1',
    numeroOS: 'OS-1',
    tentativa,
    valor: Dinheiro.de('300.00'),
  });
}

export function cobrancaComOrder(tentativa = 1, orderId = 'ORD1'): Cobranca {
  const cobranca = novaCobranca(tentativa);
  cobranca.vincularOrder(orderId, `https://mp.test/${orderId}`);
  return cobranca;
}

/** Repositorio em memoria com os mesmos efeitos observaveis do Prisma. */
export class FakeBillingRepository implements BillingRepository {
  orcamentos: Orcamento[] = [];
  cobrancas: Cobranca[] = [];
  lancamentos: Lancamento[] = [];
  webhooks: RegistroWebhook[] = [];
  entreguesOrcamento: string[] = [];
  entreguesCobranca: string[] = [];
  /** Erros a lancar nas proximas chamadas de `persistir`. */
  falhas: Error[] = [];
  /** Executado antes de lancar a falha (simula o concorrente que venceu a corrida). */
  aoFalhar?: () => void;
  reservaOrcamentos: Orcamento[] = [];
  reservaCobrancasCallback: Cobranca[] = [];
  reservaCobrancasPendentes: Cobranca[] = [];

  persistir = jest.fn(async ({ orcamento, cobranca, lancamentos = [] }: Alteracoes) => {
    const falha = this.falhas.shift();
    if (falha) {
      this.aoFalhar?.();
      throw falha;
    }
    if (orcamento && !this.orcamentos.includes(orcamento)) this.orcamentos.push(orcamento);
    if (cobranca && !this.cobrancas.includes(cobranca)) this.cobrancas.push(cobranca);
    this.lancamentos.push(...lancamentos);
    orcamento?.confirmarPersistencia();
    cobranca?.confirmarPersistencia();
  });

  async buscarAtivo(numeroOS: string) {
    return this.orcamentos.find((o) => o.dados.numeroOS === numeroOS && o.ativo) ?? null;
  }

  async buscarUltimo(numeroOS: string) {
    return this.orcamentos.filter((o) => o.dados.numeroOS === numeroOS).pop() ?? null;
  }

  async listarPorCliente(clienteId: string): Promise<OrcamentoComCobranca[]> {
    return this.orcamentos
      .filter((o) => o.dados.clienteId === clienteId)
      .map((orcamento) => ({
        orcamento,
        cobranca: this.cobrancas.find((c) => c.dados.orcamentoId === orcamento.dados.id) ?? null,
      }));
  }

  async buscarUltimaCobranca(numeroOS: string) {
    return this.cobrancas.filter((c) => c.dados.numeroOS === numeroOS).pop() ?? null;
  }

  async buscarCobrancaPorOrderId(orderId: string) {
    return this.cobrancas.find((c) => c.dados.orderId === orderId) ?? null;
  }

  async registrarWebhook(registro: RegistroWebhook) {
    this.webhooks.push(registro);
    return true;
  }

  async marcarCallbackOrcamentoEntregue(id: string) {
    this.entreguesOrcamento.push(id);
  }

  async marcarCallbackCobrancaEntregue(id: string) {
    this.entreguesCobranca.push(id);
  }

  async reservarOrcamentosComCallback() {
    return this.reservaOrcamentos;
  }

  async reservarCobrancasComCallback() {
    return this.reservaCobrancasCallback;
  }

  async reservarCobrancasPendentes() {
    return this.reservaCobrancasPendentes;
  }
}
