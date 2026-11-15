-- Ledger: expiracao da cobranca deixa de ser registrada como PAGAMENTO_RECUSADO.
-- So acrescenta um valor ao enum; o trigger append-only (UPDATE/DELETE) nao muda
-- e nenhum lancamento existente e reescrito.
ALTER TYPE "TipoLancamento" ADD VALUE 'COBRANCA_EXPIRADA';

-- Teto de reentrega do callback quando o OS recusa de forma permanente (4xx).
ALTER TABLE "orcamento" ADD COLUMN "callback_falhas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cobranca" ADD COLUMN "callback_falhas" INTEGER NOT NULL DEFAULT 0;
