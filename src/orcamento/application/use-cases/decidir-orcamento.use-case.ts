import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@guilhermeqmaia/oficina-kit/auth';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import {
  ConcorrenciaError,
  OrcamentoConflitoError,
  OrcamentoNaoEncontradoError,
} from '../../domain/errors';
import { Orcamento } from '../../domain/orcamento.entity';
import { TipoLancamento } from '../../domain/tipos';
import { EntregaCallbacksService } from '../entrega-callbacks.service';
import { garantirPosse, orcamentoView, OrcamentoView } from '../orcamento.view';
import { GERADOR_ID, GeradorId } from '../ports/billing.config';

export interface DecidirOrcamentoInput {
  numeroOS: string;
  usuario: AuthenticatedUser;
  decisao: 'APROVAR' | 'REJEITAR';
  motivo?: string;
}

/** Rodadas de releitura quando outra requisicao decide o mesmo orcamento ao mesmo tempo. */
const TENTATIVAS_CONCORRENCIA = 3;

/** Decisao do cliente. O callback ao OS sai depois do commit, sem segurar a resposta. */
@Injectable()
export class DecidirOrcamentoUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(GERADOR_ID) private readonly ids: GeradorId,
    private readonly callbacks: EntregaCallbacksService,
  ) {}

  /**
   * Corrida com outra decisao (clique duplo, repeticao do gateway): rele e decide
   * de novo. A mesma decisao ja gravada e idempotente (`200`); a decisao oposta e
   * recusa de negocio (`409`); conflito que persiste e transitorio (`503`).
   */
  async execute(input: DecidirOrcamentoInput): Promise<OrcamentoView> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await this.decidir(input);
      } catch (e) {
        if (!(e instanceof ConcorrenciaError) || tentativa >= TENTATIVAS_CONCORRENCIA) throw e;
      }
    }
  }

  private async decidir(input: DecidirOrcamentoInput): Promise<OrcamentoView> {
    const orcamento = await this.repositorio.buscarUltimo(input.numeroOS);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(input.numeroOS);
    garantirPosse(input.usuario, orcamento.dados.clienteId, input.numeroOS);

    const agora = new Date();
    if (orcamento.venceu(agora)) await this.expirar(orcamento, agora);

    const callbackId = this.ids.novo();
    const aprovar = input.decisao === 'APROVAR';
    const alterou = aprovar
      ? orcamento.aprovar(agora, callbackId)
      : orcamento.rejeitar(agora, callbackId, input.motivo);

    if (alterou) {
      await this.repositorio.persistir({
        orcamento,
        lancamentos: [
          orcamento.lancamento(
            aprovar ? TipoLancamento.ORCAMENTO_APROVADO : TipoLancamento.ORCAMENTO_REJEITADO,
            agora,
          ),
        ],
      });
      void this.callbacks.entregarOrcamento(orcamento);
    }
    return orcamentoView(orcamento);
  }

  private async expirar(orcamento: Orcamento, agora: Date): Promise<never> {
    orcamento.expirar();
    await this.repositorio.persistir({
      orcamento,
      lancamentos: [orcamento.lancamento(TipoLancamento.ORCAMENTO_EXPIRADO, agora)],
    });
    throw new OrcamentoConflitoError('Orcamento expirado; solicite um novo diagnostico');
  }
}
