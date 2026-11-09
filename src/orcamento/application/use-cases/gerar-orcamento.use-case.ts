import { Inject, Injectable } from '@nestjs/common';
import { UseCase } from '@guilhermeqmaia/oficina-kit/core';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import { Dinheiro } from '../../domain/dinheiro.vo';
import { RegistroDuplicadoError } from '../../domain/errors';
import { Orcamento } from '../../domain/orcamento.entity';
import { TipoItem, TipoLancamento } from '../../domain/tipos';
import { BILLING_CONFIG, BillingConfig, GERADOR_ID, GeradorId } from '../ports/billing.config';

export interface GerarOrcamentoInput {
  numeroOS: string;
  clienteId: string;
  itens: Array<{
    tipo: TipoItem;
    referenciaId: string;
    servicoId?: string;
    nome: string;
    quantidade: number;
    precoUnitario: string;
  }>;
}

export interface GerarOrcamentoOutput {
  criado: boolean;
  numeroOS: string;
  orcamentoId: string;
  total: string;
  validoAte: string;
}

@Injectable()
export class GerarOrcamentoUseCase implements UseCase<GerarOrcamentoInput, GerarOrcamentoOutput> {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository,
    @Inject(BILLING_CONFIG) private readonly config: BillingConfig,
    @Inject(GERADOR_ID) private readonly ids: GeradorId,
  ) {}

  async execute(input: GerarOrcamentoInput): Promise<GerarOrcamentoOutput> {
    const agora = new Date();
    const existente = await this.repositorio.buscarAtivo(input.numeroOS);
    if (existente && !existente.venceu(agora)) return this.saida(existente, false);
    if (existente) {
      existente.expirar();
      await this.repositorio.persistir({
        orcamento: existente,
        lancamentos: [existente.lancamento(TipoLancamento.ORCAMENTO_EXPIRADO, agora)],
      });
    }

    const orcamento = Orcamento.criar({
      id: this.ids.novo(),
      numeroOS: input.numeroOS,
      clienteId: input.clienteId,
      itens: input.itens.map((item) => ({
        ...item,
        precoUnitario: Dinheiro.de(item.precoUnitario),
      })),
      validoAte: new Date(agora.getTime() + this.config.validadeOrcamentoMs),
    });
    try {
      await this.repositorio.persistir({
        orcamento,
        lancamentos: [orcamento.lancamento(TipoLancamento.ORCAMENTO_GERADO, agora)],
      });
    } catch (e) {
      const concorrente =
        e instanceof RegistroDuplicadoError
          ? await this.repositorio.buscarAtivo(input.numeroOS)
          : null;
      if (concorrente) return this.saida(concorrente, false);
      throw e;
    }
    return this.saida(orcamento, true);
  }

  private saida(orcamento: Orcamento, criado: boolean): GerarOrcamentoOutput {
    const { numeroOS, id, total, validoAte } = orcamento.dados;
    return {
      criado,
      numeroOS,
      orcamentoId: id,
      total: total.toString(),
      validoAte: validoAte.toISOString(),
    };
  }
}
