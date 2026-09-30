# soat-fiap-oficina-billing-service

**Billing Service** do Sistema da Oficina Mecânica — Fase 4 do Tech Challenge FIAP (SOAT).

Responsável por **orçamento** (geração a partir do diagnóstico, aprovação/rejeição pelo cliente), **pagamento** via **Mercado Pago** (Checkout Pro + webhook assinado) e **ledger** append-only. Banco próprio: **PostgreSQL** (`oficina_billing`).

> Repositório 5 de 7. O planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas ficam no hub: [https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/plano-execucao-fase-4.md](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/plano-execucao-fase-4.md).

## Histórias

- [US-F4-08 — Orçamento, aprovação e rejeição](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-08-billing-orcamento.md)
- [US-F4-09 — Pagamento com Mercado Pago](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-09-billing-mercado-pago.md)
- [US-F4-11 — Compensações (cancelar orçamento, estorno)](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-11-compensacoes-rollback.md)

## Estado

Bootstrap — implementação começa na Onda 2 (após o kit `@soat-fiap/oficina-kit` e a mensageria).
