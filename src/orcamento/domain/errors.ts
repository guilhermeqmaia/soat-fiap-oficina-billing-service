import {
  DomainError,
  DomainErrorKind,
  EntityNotFoundError,
} from '@guilhermeqmaia/oficina-kit/core';

export class ValorMonetarioInvalidoError extends DomainError {
  readonly kind = DomainErrorKind.INVALID_INPUT;

  constructor(valor: string) {
    super(`Valor monetario invalido: '${valor}' (esperado decimal com 2 casas)`);
  }
}

export class ClienteIdObrigatorioError extends DomainError {
  readonly kind = DomainErrorKind.INVALID_INPUT;

  constructor() {
    super('Informe o clienteId para listar os orcamentos');
  }
}

export class OrcamentoNaoEncontradoError extends EntityNotFoundError {
  constructor(numeroOS: string) {
    super('Orcamento', numeroOS);
  }
}

export class CobrancaNaoEncontradaError extends EntityNotFoundError {
  constructor(numeroOS: string) {
    super('Cobranca', numeroOS);
  }
}

/** Recusa de negocio: a API responde `409 { motivo }` (docs/contratos/http-interno.md). */
export class OrcamentoConflitoError extends DomainError {
  readonly kind = DomainErrorKind.CONFLICT;

  constructor(readonly motivo: string) {
    super(motivo);
  }
}

/** Outra requisicao alterou o agregado primeiro (versao otimista). */
export class ConcorrenciaError extends OrcamentoConflitoError {
  constructor(recurso: string) {
    super(`${recurso} alterado por outra requisicao; repita a operacao`);
  }
}

/** Corrida na criacao: o indice unico ja tem o registro; quem chamou rele o existente. */
export class RegistroDuplicadoError extends OrcamentoConflitoError {
  constructor() {
    super('Registro ja existente');
  }
}
