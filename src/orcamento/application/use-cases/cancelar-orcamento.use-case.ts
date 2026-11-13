import { Inject, Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { OrcamentoConflitoError } from '../../domain/errors';
import { Lancamento, StatusCobranca, TipoLancamento } from '../../domain/tipos';
import { MERCADO_PAGO_GATEWAY, MercadoPagoGateway } from '../ports/mercado-pago.gateway';

export interface CancelarOrcamentoInput {
  numeroOS: string;
  motivo: string;
}

export interface CancelarOrcamentoOutput {
  numeroOS: string;
  orcamentoId: string | null;
  estornado: boolean;
}

/**
 * Compensacao da saga, idempotente: `200` mesmo sem orcamento, porque a OS pode
 * ser cancelada antes de ele existir. Sem estorno (ADR-0012): nada e pago antes
 * da execucao, e a saga nao compensa depois dela.
 */
@Injectable()
export class CancelarOrcamentoUseCase implements UseCase<
  CancelarOrcamentoInput,
  CancelarOrcamentoOutput
> {
  private readonly logger = new Logger(CancelarOrcamentoUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(MERCADO_PAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  async execute({ numeroOS, motivo }: CancelarOrcamentoInput): Promise<CancelarOrcamentoOutput> {
    const orcamento = await this.repositorio.buscarUltimo(numeroOS);
    if (!orcamento) return { numeroOS, orcamentoId: null, estornado: false };
    const saida = { numeroOS, orcamentoId: orcamento.dados.id, estornado: false };

    const cobranca = await this.repositorio.buscarUltimaCobranca(numeroOS);
    if (cobranca?.dados.status === StatusCobranca.APROVADA) {
      throw new OrcamentoConflitoError('Orcamento com pagamento aprovado nao pode ser cancelado');
    }
    if (!orcamento.cancelar(motivo)) return saida;

    const agora = new Date();
    const lancamentos: Lancamento[] = [
      orcamento.lancamento(TipoLancamento.ORCAMENTO_CANCELADO, agora),
    ];
    const cobrancaCancelada = cobranca?.cancelar() ? cobranca : undefined;
    if (cobrancaCancelada) {
      lancamentos.push(cobrancaCancelada.lancamento(TipoLancamento.COBRANCA_CANCELADA, agora));
    }
    await this.repositorio.persistir({ orcamento, cobranca: cobrancaCancelada, lancamentos });

    const orderId = cobrancaCancelada?.dados.orderId;
    if (orderId) await this.cancelarOrder(orderId, numeroOS);
    return saida;
  }

  private async cancelarOrder(orderId: string, numeroOS: string): Promise<void> {
    try {
      await this.mercadoPago.cancelarOrder(orderId);
    } catch (e) {
      this.logger.warn({
        msg: 'order nao cancelada no Mercado Pago',
        numeroOS,
        orderId,
        erro: (e as Error).message,
      });
    }
  }
}
