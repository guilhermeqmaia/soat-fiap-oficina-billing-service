# QA Plan: FLUXO 2 (Billing Service ponta a ponta)

Cobre US-F4-08 (orçamento, aprovação e rejeição), US-F4-09 (Mercado Pago via Orders)
e a parte deste repositório das US-F4-13, 14, 15 e 18.

## Pré-requisitos

| Item                         | Como obter                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node 20 e Docker em execução | Os testes de integração e BDD sobem Postgres por testcontainers                                                    |
| Dependências                 | `npm ci && npx prisma generate`                                                                                    |
| Sandbox (só na seção manual) | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `MP_PAYER_EMAIL` no `.env`; runbook `docs/mercado-pago-sandbox.md` no hub |

## Testes automatizados

| Comando                    | O que valida                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run test:unit:cov`    | Domínio, casos de uso e adapters, com gate de 80%                         |
| `npm run test:integration` | Fluxos HTTP com Postgres real; OS e Mercado Pago interceptados por `nock` |
| `npm run test:bdd`         | Cenários Gherkin em `features/`; relatório em `reports/cucumber.html`     |
| `npm run openapi:export`   | Gera o `openapi.yaml` publicado no hub                                    |

Os testes de contrato estão em `src/orcamento/contrato.e2e.spec.ts`: respostas contra o
`openapi.yaml` versionado, e respostas e callbacks contra os schemas de `asyncapi.yaml`.
O CI falha se o `openapi.yaml` divergir do código ou se a cópia do AsyncAPI divergir do hub.

## Cenários manuais no sandbox

Com o Billing e o OS Service rodando e o webhook apontando para o túnel:

| #   | Passo                                                 | Resultado esperado                                                                                     |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| M1  | `POST /orcamentos/{n}/cobrar`                         | `201` com `checkout_url` válido em `linkPagamento`                                                     |
| M2  | Pagar com titular `APRO`                              | Webhook `order.processed`; cobrança `APROVADA`; callback `billing.pagamento-aprovado`; OS `FINALIZADA` |
| M3  | Pagar com titular `OTHE`                              | Cobrança `RECUSADA`; callback `billing.pagamento-recusado`; OS segue `AGUARDANDO_PAGAMENTO`            |
| M4  | Pagar com titular `CONT`                              | Cobrança segue `PENDENTE`, sem callback                                                                |
| M5  | Após M3, `POST /admin/sagas/{n}/reprocessar` no OS    | Nova order; a anterior é cancelada                                                                     |
| M6  | Pagar com a URL do webhook inválida e aguardar 15 min | A reconciliação fecha a cobrança                                                                       |
| M7  | Reenviar uma notificação pelo painel                  | Sem novo callback nem novo lançamento                                                                  |

**Conferir em M2, M3 e M4:** o mapeamento em `src/orcamento/domain/resultado-order.ts`
partiu da documentação do hub. Compare com a resposta real de `GET /v1/orders/{id}`,
principalmente o estado de uma order recusada (`failed` ou `action_required`).

### Execução no sandbox — 09/11/2026 (review do PR #5)

Rodado localmente com o Access Token de **teste** da aplicação espelho (`400480433027788`), Postgres no
compose, OS Service substituído por um stub que aceita `POST /ordens-servico/{n}/eventos`, reconciliação
desligada. Roteiro: `POST /orcamentos` (SERVICO) → `POST /orcamentos/{n}/aprovar` (CLIENTE) →
`POST /orcamentos/{n}/cobrar` (SERVICO) duas vezes → `GET /pagamentos/{n}` (CLIENTE).

| #   | Resultado |
| --- | --------- |
| M1  | **OK.** `201 { orderId: "ORDTST01M7031YBJVTKVK8MB49KVT5NP", linkPagamento: "https://www.mercadopago.com.br/checkout/v1/redirect?order_id=…&pref_id=…", valor: "333.60" }`. A order foi criada de fato no Mercado Pago (prefixo `ORDTST` = ambiente de teste). Repetir o `/cobrar` devolveu a **mesma** order (idempotência pela `X-Idempotency-Key`). `GET /pagamentos/{n}` → `PENDENTE` com o mesmo link. Callback `billing.orcamento-aprovado` chegou ao stub com envelope e `id` estáveis. Nenhum erro no log; nada do pagador foi registrado. |
| M2–M7 | **Pendentes.** Exigem pagar no checkout com o comprador de teste (janela anônima) e o webhook apontando para uma URL pública que alcance o Billing (túnel ou gateway). Hoje o webhook da aplicação aponta para o webhook.site do runbook. |

Observações para quando M2–M4 rodarem: confirmar o mapeamento de `status`/`status_detail` da order
recusada em `resultado-order.ts` contra o `GET /v1/orders/{id}` real.

## Casos de borda

| Caso                                | Onde está coberto                           |
| ----------------------------------- | ------------------------------------------- |
| Itens vazios, preço fora do formato | e2e, validação do DTO                       |
| `POST /orcamentos` simultâneos      | e2e, índice único parcial                   |
| Aprovar após `validoAte`            | unitário (`DecidirOrcamentoUseCase`)        |
| `DELETE` sem orçamento existente    | e2e, responde `200` com `orcamentoId: null` |
| Falha do Mercado Pago ao cobrar     | e2e, repete com a mesma `X-Idempotency-Key` |
| OS fora do ar no callback           | e2e, reentrega com o mesmo `id`             |
| Webhook e reconciliação em corrida  | unitário, versão otimista                   |
| `UPDATE`/`DELETE` no ledger         | e2e, trigger no banco                       |

## Rastreabilidade

| Critério                                         | Cenários                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Orçamento com itens congelados, total e validade | `orcamento.feature`                                             |
| `POST /orcamentos` idempotente                   | `orcamento.feature`, e2e                                        |
| Consultas com posse                              | e2e, `consultas` nos unitários                                  |
| Aprovar e rejeitar com callback                  | `aprovacao.feature`                                             |
| Imutável após aprovado                           | `aprovacao.feature`                                             |
| `DELETE` idempotente                             | `orcamento.feature`, e2e                                        |
| Ledger append-only                               | e2e                                                             |
| Cobrança via `POST /v1/orders`                   | `cobranca.feature`, unitário do gateway, M1                     |
| Webhook com `x-signature`                        | `pagamento.feature`, unitário de assinatura                     |
| Consulta a order antes de agir                   | `pagamento.feature`, unitário `ProcessarOrderUseCase`           |
| Aprovado, recusado e pendente                    | `pagamento.feature`, M2 a M4                                    |
| Nova cobrança após recusa                        | `pagamento.feature`, e2e, M5                                    |
| Reconciliação                                    | `pagamento.feature`, e2e, M6                                    |
| Idempotência por OS e por envelope               | e2e, M7                                                         |
| Logs sem dados do pagador                        | e2e captura a saída real, e unitário do `MercadoPagoSdkGateway` |
| Contrato HTTP                                    | `contrato.e2e.spec.ts`                                          |

## Checklist de validação

- [ ] `npm run format`, `lint`, `typecheck` e `build`
- [ ] `npm run test:all:cov` e `npm run test:bdd`
- [ ] Quality gate do SonarCloud verde
- [x] M1 executado no sandbox (09/11, order `ORDTST01M7031YBJVTKVK8MB49KVT5NP`)
- [ ] M2 a M7 executados no sandbox (pagamento no checkout + webhook público)
- [ ] Secret `MP_SECRET_ID` criado no Secrets Manager antes do deploy
