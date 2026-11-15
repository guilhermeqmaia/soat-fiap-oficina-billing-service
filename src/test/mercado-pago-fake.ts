import { OrderClient } from '../orcamento/infrastructure/mercado-pago-sdk.gateway';

export type OperacaoMp = 'create' | 'get' | 'cancel';

export interface ChamadaMp {
  readonly operacao: OperacaoMp;
  readonly id?: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

type RespostaOrder = Awaited<ReturnType<OrderClient['get']>>;

interface Passo {
  readonly operacao: OperacaoMp;
  readonly id?: string;
  readonly resposta?: Record<string, unknown>;
  readonly falha?: { status: number; message: string };
}

/**
 * Fake da classe `Order` do SDK (provider `MP_ORDER_CLIENT`): o
 * `MercadoPagoSdkGateway` continua no caminho, so a chamada de rede sai. Cada
 * resposta e roteirizada e consumida uma vez; chamada sem roteiro falha como
 * uma rede indisponivel, igual ao `disableNetConnect` de antes.
 */
export class MercadoPagoFake implements OrderClient {
  readonly chamadas: ChamadaMp[] = [];
  private roteiro: Passo[] = [];

  criando(orderId: string): void {
    this.roteiro.push({
      operacao: 'create',
      resposta: { id: orderId, status: 'created', checkout_url: `https://mp.test/${orderId}` },
    });
  }

  consultando(orderId: string, order: Record<string, unknown>): void {
    this.roteiro.push({ operacao: 'get', id: orderId, resposta: { id: orderId, ...order } });
  }

  cancelando(orderId: string): void {
    this.roteiro.push({
      operacao: 'cancel',
      id: orderId,
      resposta: { id: orderId, status: 'canceled' },
    });
  }

  falhando(operacao: OperacaoMp, status: number, message: string, id?: string): void {
    this.roteiro.push({ operacao, id, falha: { status, message } });
  }

  /** Respostas roteirizadas que ninguem consumiu. */
  pendentes(): string[] {
    return this.roteiro.map((p) => `${p.operacao}${p.id ? ` ${p.id}` : ''}`);
  }

  limpar(): void {
    this.chamadas.length = 0;
    this.roteiro = [];
  }

  async create(args: { body: unknown; requestOptions?: unknown }) {
    const idempotencyKey = (args.requestOptions as { idempotencyKey?: string } | undefined)
      ?.idempotencyKey;
    this.chamadas.push({ operacao: 'create', body: args.body, idempotencyKey });
    return this.executar('create');
  }

  async get(args: { id: string }) {
    this.chamadas.push({ operacao: 'get', id: args.id });
    return this.executar('get', args.id);
  }

  async cancel(args: { id: string; requestOptions?: unknown }) {
    this.chamadas.push({ operacao: 'cancel', id: args.id });
    return this.executar('cancel', args.id);
  }

  private executar(operacao: OperacaoMp, id?: string): RespostaOrder {
    const indice = this.roteiro.findIndex(
      (p) => p.operacao === operacao && (p.id === undefined || p.id === id),
    );
    if (indice < 0) throw new Error(`MercadoPagoFake: ${operacao} ${id ?? ''} sem roteiro`);
    const [passo] = this.roteiro.splice(indice, 1);
    if (passo.falha) {
      // Mesmo formato do erro do SDK: corpo da resposta com `status`.
      throw Object.assign(new Error(passo.falha.message), { status: passo.falha.status });
    }
    return passo.resposta as RespostaOrder;
  }
}
