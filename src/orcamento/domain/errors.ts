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

/**
 * Conflito transitorio, nao recusa de negocio: outra requisicao mexeu no mesmo
 * agregado no mesmo instante. A API responde `503` (o OS repete 5xx e a
 * repeticao e idempotente), nunca `409 { motivo }`, que a saga do OS trataria
 * como "nao entregue" em `billing.cobrar` e deixaria parada no passo.
 */
export class ConflitoTransitorioError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

/** Outra requisicao alterou o agregado primeiro (versao otimista). */
export class ConcorrenciaError extends ConflitoTransitorioError {
  constructor(recurso: string) {
    super(`${recurso} alterado por outra requisicao; repita a operacao`);
  }
}

/** Corrida na criacao: o indice unico ja tem o registro; quem chamou rele o existente. */
export class RegistroDuplicadoError extends ConflitoTransitorioError {
  constructor() {
    super('Registro ja existente');
  }
}

/**
 * A order anterior foi processada no Mercado Pago, mas o pagamento ainda nao
 * aparece como aprovado. Emitir outra order poderia cobrar duas vezes.
 */
export class OrderAnteriorEmProcessamentoError extends ConflitoTransitorioError {
  constructor(orderId: string) {
    super(`Order ${orderId} processada sem confirmacao do pagamento; repita a operacao`);
  }
}
