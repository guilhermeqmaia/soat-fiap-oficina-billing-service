import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ReconciliarUseCase } from '../application/use-cases/reconciliar.use-case';

export const RECONCILIACAO_ATIVA = Symbol('RECONCILIACAO_ATIVA');

const INTERVALO_MS = 60_000;

@Injectable()
export class ReconciliacaoJob {
  private readonly logger = new Logger(ReconciliacaoJob.name);
  private emExecucao = false;

  constructor(
    private readonly reconciliar: ReconciliarUseCase,
    @Inject(RECONCILIACAO_ATIVA) private readonly ativa: boolean,
  ) {}

  @Interval(INTERVALO_MS)
  async executar(): Promise<void> {
    if (!this.ativa || this.emExecucao) return;
    this.emExecucao = true;
    try {
      await this.reconciliar.execute();
    } catch (e) {
      this.logger.error({ msg: 'falha na reconciliacao', erro: (e as Error).message });
    } finally {
      this.emExecucao = false;
    }
  }
}
