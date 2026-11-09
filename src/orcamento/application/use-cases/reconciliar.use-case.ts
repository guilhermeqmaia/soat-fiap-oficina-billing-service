import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { EntregaCallbacksService } from '../entrega-callbacks.service';
import { BILLING_CONFIG, BillingConfig } from '../ports/billing.config';
import { ProcessarOrderUseCase } from './processar-order.use-case';

/** Recuperacao para frente: reenvia callbacks nao confirmados e consulta orders pendentes. */
@Injectable()
export class ReconciliarUseCase {
  private readonly logger = new Logger(ReconciliarUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(BILLING_CONFIG) private readonly config: BillingConfig,
    private readonly callbacks: EntregaCallbacksService,
    private readonly processarOrder: ProcessarOrderUseCase,
  ) {}

  async execute(agora: Date = new Date()): Promise<void> {
    const { reentregaCallbackMs, reconciliacaoMs, loteReconciliacao: lote } = this.config;
    const limiteCallback = new Date(agora.getTime() - reentregaCallbackMs);

    const orcamentos = await this.repositorio.reservarOrcamentosComCallback(
      limiteCallback,
      agora,
      lote,
    );
    for (const orcamento of orcamentos) await this.callbacks.entregarOrcamento(orcamento);

    const cobrancas = await this.repositorio.reservarCobrancasComCallback(
      limiteCallback,
      agora,
      lote,
    );
    for (const cobranca of cobrancas) await this.callbacks.entregarCobranca(cobranca);

    const pendentes = await this.repositorio.reservarCobrancasPendentes(
      new Date(agora.getTime() - reconciliacaoMs),
      agora,
      lote,
    );
    for (const cobranca of pendentes) {
      try {
        await this.processarOrder.porCobranca(cobranca);
      } catch (e) {
        this.logger.warn({
          msg: 'falha ao reconciliar cobranca',
          numeroOS: cobranca.dados.numeroOS,
          erro: (e as Error).message,
        });
      }
    }
  }
}
