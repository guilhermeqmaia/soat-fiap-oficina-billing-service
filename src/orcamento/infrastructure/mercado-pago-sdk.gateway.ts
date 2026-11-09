import { Inject, Injectable } from '@nestjs/common';
import { SituacaoOrder } from '../domain/resultado-order';
import {
  CriarOrderInput,
  MercadoPagoGateway,
  OrderCriada,
} from '../application/ports/mercado-pago.gateway';

export const MP_ORDER_CLIENT = Symbol('MP_ORDER_CLIENT');
export const MP_OPCOES = Symbol('MP_OPCOES');

export interface MercadoPagoOpcoes {
  readonly payerEmail: string;
  readonly retornoBaseUrl: string;
  readonly expiracaoOrder: string;
}

interface OrderResposta {
  id?: string;
  status?: string;
  status_detail?: string;
  checkout_url?: string;
  transactions?: { payments?: Array<{ status?: string; status_detail?: string }> };
}

/** Superficie usada da classe `Order` do SDK `mercadopago`. */
export interface OrderClient {
  create(args: { body: unknown; requestOptions?: unknown }): Promise<OrderResposta>;
  get(args: { id: string }): Promise<OrderResposta>;
  cancel(args: { id: string; requestOptions?: unknown }): Promise<OrderResposta>;
}

/** Nao registra respostas nem corpo: e neles que vem os dados do pagador. */
@Injectable()
export class MercadoPagoSdkGateway implements MercadoPagoGateway {
  constructor(
    @Inject(MP_ORDER_CLIENT) private readonly orders: OrderClient,
    @Inject(MP_OPCOES) private readonly opcoes: MercadoPagoOpcoes,
  ) {}

  async criarOrder(input: CriarOrderInput): Promise<OrderCriada> {
    const base = this.opcoes.retornoBaseUrl.replace(/\/$/, '');
    const resposta = await this.orders.create({
      body: {
        type: 'online',
        processing_mode: 'manual',
        external_reference: input.numeroOS,
        total_amount: input.valor,
        expiration_time: this.opcoes.expiracaoOrder,
        payer: { email: this.opcoes.payerEmail },
        items: input.itens.map((item) => ({
          title: item.titulo,
          quantity: item.quantidade,
          unit_price: item.precoUnitario,
        })),
        config: {
          online: {
            success_url: `${base}/sucesso`,
            failure_url: `${base}/falha`,
            pending_url: `${base}/pendente`,
            auto_return: 'approved',
          },
        },
      },
      requestOptions: { idempotencyKey: input.idempotencyKey },
    });
    if (!resposta.id || !resposta.checkout_url) {
      throw new Error('Mercado Pago nao devolveu id/checkout_url da order');
    }
    return { orderId: resposta.id, linkPagamento: resposta.checkout_url };
  }

  async consultarOrder(orderId: string): Promise<SituacaoOrder> {
    const order = await this.orders.get({ id: orderId });
    return {
      status: order.status,
      statusDetail: order.status_detail,
      pagamentos: (order.transactions?.payments ?? []).map((p) => ({
        status: p.status,
        statusDetail: p.status_detail,
      })),
    };
  }

  async cancelarOrder(orderId: string): Promise<void> {
    await this.orders.cancel({
      id: orderId,
      requestOptions: { idempotencyKey: `cancelar:${orderId}` },
    });
  }
}
