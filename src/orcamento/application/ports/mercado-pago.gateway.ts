import { SituacaoOrder } from '../../domain/resultado-order';

export const MERCADO_PAGO_GATEWAY = Symbol('MERCADO_PAGO_GATEWAY');

export interface ItemOrder {
  readonly titulo: string;
  readonly quantidade: number;
  readonly precoUnitario: string;
}

export interface CriarOrderInput {
  readonly numeroOS: string;
  readonly valor: string;
  readonly itens: readonly ItemOrder[];
  readonly idempotencyKey: string;
}

export interface OrderCriada {
  readonly orderId: string;
  readonly linkPagamento: string;
}

export interface MercadoPagoGateway {
  criarOrder(input: CriarOrderInput): Promise<OrderCriada>;
  consultarOrder(orderId: string): Promise<SituacaoOrder>;
  cancelarOrder(orderId: string): Promise<void>;
}
