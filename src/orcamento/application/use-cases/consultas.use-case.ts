import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@guilhermeqmaia/oficina-kit/auth';
import { NotOwnedByUserError } from '@guilhermeqmaia/oficina-kit/core';
import { BILLING_REPOSITORY, BillingRepository } from '../../domain/billing.repository';
import {
  ClienteIdObrigatorioError,
  CobrancaNaoEncontradaError,
  OrcamentoNaoEncontradoError,
} from '../../domain/errors';
import {
  CobrancaView,
  cobrancaView,
  garantirPosse,
  orcamentoView,
  OrcamentoView,
} from '../orcamento.view';

@Injectable()
export class ConsultasOrcamentoUseCase {
  constructor(@Inject(BILLING_REPOSITORY) private readonly repositorio: BillingRepository) {}

  async buscar(numeroOS: string, usuario: AuthenticatedUser): Promise<OrcamentoView> {
    const orcamento = await this.repositorio.buscarUltimo(numeroOS);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(numeroOS);
    garantirPosse(usuario, orcamento.dados.clienteId, numeroOS);
    return orcamentoView(orcamento, await this.repositorio.buscarUltimaCobranca(numeroOS));
  }

  async listar(
    clienteId: string | undefined,
    usuario: AuthenticatedUser,
  ): Promise<OrcamentoView[]> {
    const alvo = usuario.role === Role.CLIENTE ? (clienteId ?? usuario.id) : clienteId;
    if (!alvo) throw new ClienteIdObrigatorioError();
    if (usuario.role === Role.CLIENTE && alvo !== usuario.id) {
      throw new NotOwnedByUserError('orcamento', alvo);
    }
    const resultados = await this.repositorio.listarPorCliente(alvo);
    return resultados.map(({ orcamento, cobranca }) => orcamentoView(orcamento, cobranca));
  }

  async pagamento(numeroOS: string, usuario: AuthenticatedUser): Promise<CobrancaView> {
    const orcamento = await this.repositorio.buscarUltimo(numeroOS);
    if (!orcamento) throw new CobrancaNaoEncontradaError(numeroOS);
    garantirPosse(usuario, orcamento.dados.clienteId, numeroOS);
    const cobranca = await this.repositorio.buscarUltimaCobranca(numeroOS);
    if (!cobranca) throw new CobrancaNaoEncontradaError(numeroOS);
    return cobrancaView(cobranca);
  }
}
