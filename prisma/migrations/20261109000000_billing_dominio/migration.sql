-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusOrcamento" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "StatusCobranca" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('SERVICO', 'PRODUTO');

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('ORCAMENTO_GERADO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_REJEITADO', 'ORCAMENTO_EXPIRADO', 'ORCAMENTO_CANCELADO', 'COBRANCA_CRIADA', 'COBRANCA_CANCELADA', 'PAGAMENTO_APROVADO', 'PAGAMENTO_RECUSADO');

-- CreateTable
CREATE TABLE "orcamento" (
    "id" UUID NOT NULL,
    "numero_os" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "valido_ate" TIMESTAMPTZ(3) NOT NULL,
    "status" "StatusOrcamento" NOT NULL,
    "decidido_em" TIMESTAMPTZ(3),
    "motivo_rejeicao" TEXT,
    "motivo_cancelamento" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "callback_id" UUID,
    "callback_ultima_tentativa_em" TIMESTAMPTZ(3),
    "callback_entregue_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "posicao" INTEGER NOT NULL,
    "tipo" "TipoItem" NOT NULL,
    "referencia_id" TEXT NOT NULL,
    "servico_id" TEXT,
    "nome" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "orcamento_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobranca" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "numero_os" TEXT NOT NULL,
    "tentativa" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "order_id" TEXT,
    "checkout_url" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "StatusCobranca" NOT NULL,
    "pago_em" TIMESTAMPTZ(3),
    "recusada_em" TIMESTAMPTZ(3),
    "motivo_recusa" TEXT,
    "ultima_consulta_em" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "callback_id" UUID,
    "callback_ultima_tentativa_em" TIMESTAMPTZ(3),
    "callback_entregue_em" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger" (
    "id" UUID NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "numero_os" TEXT NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "order_id" TEXT,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_mercado_pago" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "x_request_id" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB NOT NULL,
    "assinatura_valida" BOOLEAN NOT NULL,
    "recebido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_mercado_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamento_numero_os_idx" ON "orcamento"("numero_os");

-- CreateIndex
CREATE INDEX "orcamento_cliente_id_idx" ON "orcamento"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_orcamento_id_posicao_key" ON "orcamento_item"("orcamento_id", "posicao");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_idempotency_key_key" ON "cobranca"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_order_id_key" ON "cobranca"("order_id");

-- CreateIndex
CREATE INDEX "cobranca_numero_os_idx" ON "cobranca"("numero_os");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_orcamento_id_tentativa_key" ON "cobranca"("orcamento_id", "tentativa");

-- CreateIndex
CREATE INDEX "ledger_numero_os_idx" ON "ledger"("numero_os");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_mercado_pago_order_id_x_request_id_key" ON "webhook_mercado_pago"("order_id", "x_request_id");

-- AddForeignKey
ALTER TABLE "orcamento_item" ADD CONSTRAINT "orcamento_item_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Idempotencia dos comandos: no maximo um orcamento ativo e uma cobranca PENDENTE por OS.
CREATE UNIQUE INDEX "orcamento_ativo_por_os_key" ON "orcamento"("numero_os") WHERE "status" IN ('PENDENTE', 'APROVADO');
CREATE UNIQUE INDEX "cobranca_pendente_por_os_key" ON "cobranca"("numero_os") WHERE "status" = 'PENDENTE';

-- Ledger append-only: nenhum lancamento e editado ou removido.
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger e append-only: % nao permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_sem_alteracao BEFORE UPDATE OR DELETE ON "ledger"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
