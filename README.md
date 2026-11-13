# oficina-billing-service

[![CI](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/ci.yml) [![CD AWS](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/cd-aws.yml/badge.svg)](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/cd-aws.yml)

Orçamento, aprovação/rejeição e pagamento via Mercado Pago: microsserviço do Sistema da Oficina Mecânica (Tech Challenge FIAP, Fase 4). Gerado pelo template do [`@guilhermeqmaia/oficina-kit`](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit).

> Planejamento, RFCs/ADRs, contratos (HTTP interno e vocabulário AsyncAPI) e diagramas: [hub](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/plano-execucao-fase-4.md).

## Responsabilidades

**Possui:** Orçamento (geração a partir do diagnóstico, aprovação/rejeição pelo cliente), Pagamento (Mercado Pago Checkout Pro + webhook assinado) e **ledger** append-only. Banco próprio **PostgreSQL** `oficina_billing` ([RFC-0004](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/arquitetura/rfcs/RFC-0004-decomposicao-em-microsservicos.md)).

**Não possui:** a OS (OS Service), itens/preços do catálogo (Execução — chegam congelados no `POST /orcamentos`), notificação ao cliente (OS Service).

## Comunicação com os outros serviços

Decisão de **03/11/2026** ([RFC-0008](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/arquitetura/rfcs), contrato completo em [`docs/contratos/http-interno.md`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/http-interno.md)): **sem mensageria** (SNS/SQS/LocalStack saíram). Os nomes e payloads dos comandos/eventos do [`asyncapi.yaml`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/asyncapi.yaml) seguem como vocabulário: cada comando do OS Service vira um endpoint HTTP **deste** serviço e cada evento vira a resposta síncrona desse endpoint ou um **callback** HTTP para o OS Service.

- **Quem chama quem:** o OS Service (orquestrador da saga, RFC-0005) chama este serviço; este serviço só chama o OS Service de volta, em `POST {OS_SERVICE_URL}/ordens-servico/{numero}/eventos` (envelope `{ id, type, version, occurredAt, producer, data }`). Retry 3x com backoff (200 ms, 800 ms, 3 s) só para `5xx`/timeout; `4xx` não repete.
- **Rede:** chamadas entre serviços **não passam pelo API Gateway** — vão pelo DNS interno do cluster (`OS_SERVICE_URL=http://oficina-app:3000`, Service `oficina-app` no namespace `oficina`; em dev, `http://localhost:3000`). O gateway continua sendo a única borda pública e roteia por prefixo ([infra-k8s/gateway](https://github.com/guilhermeqmaia/soat-fiap-oficina-infra-k8s/tree/main/gateway)).
- **Autenticação entre serviços:** JWT com `role: SERVICO` e `sub` = nome do serviço, assinado com o **mesmo `JWT_SECRET`** da Lambda (emitido localmente, `mintServiceToken` do kit). Endpoints internos e callbacks aceitam só `SERVICO`; endpoints de usuário continuam com os roles de hoje.
- **Idempotência:** comandos por `numeroOS` (repetir não duplica efeito). `409 { motivo }` = recusa de negócio (vira o evento de falha na saga); `404` = recurso desconhecido (não repete).
- **Correlação:** `x-correlation-id` (= número da OS) e `traceparent` propagados em toda chamada e callback (kit `logging`).

### Endpoints que o Billing expõe

| Endpoint                                              | Quem chama                                                          | Comando (vocabulário)        | Resposta = evento                                                                                     | Falha de negócio                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /orcamentos` `{ numeroOS, clienteId, itens[] }` | OS Service (`SERVICO`)                                              | `billing.gerar-orcamento`    | `201 { numeroOS, orcamentoId, total, validoAte }` ≙ `billing.orcamento-gerado`                        | `409` se já existe orçamento ativo (devolve o existente com `200`) |
| `POST /orcamentos/{numeroOS}/cobrar`                  | OS Service (`SERVICO`)                                              | `billing.cobrar`             | `201 { numeroOS, orderId, linkPagamento, valor }` ≙ `billing.cobranca-criada` (order no Mercado Pago) | `409 { motivo }` se o orçamento não está aprovado                  |
| `DELETE /orcamentos/{numeroOS}` `{ motivo }`          | OS Service (`SERVICO`)                                              | `billing.cancelar-orcamento` | `200 { numeroOS, orcamentoId, estornado }` ≙ `billing.orcamento-cancelado`                            | — (idempotente)                                                    |
| `POST /orcamentos/{numeroOS}/aprovar`                 | Cliente (`CLIENTE`, via gateway)                                    | —                            | `200` + callback `billing.orcamento-aprovado`                                                         | —                                                                  |
| `POST /orcamentos/{numeroOS}/rejeitar`                | Cliente (`CLIENTE`, via gateway)                                    | —                            | `200` + callback `billing.orcamento-rejeitado`                                                        | —                                                                  |
| `POST /webhooks/mercadopago`                          | Mercado Pago (público; assinatura `x-signature` validada, ADR-0012) | —                            | `200` + callback `billing.pagamento-aprovado` / `billing.pagamento-recusado`                          | —                                                                  |

### Callbacks que o Billing envia ao OS Service

`POST {OS_SERVICE_URL}/ordens-servico/{numeroOS}/eventos`, `producer: "billing-service"`:

| `type`                        | Origem                                                    | `data`                               |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `billing.orcamento-aprovado`  | cliente aprovou (`POST /orcamentos/{numeroOS}/aprovar`)   | `{ numeroOS, orcamentoId }`          |
| `billing.orcamento-rejeitado` | cliente rejeitou (`POST /orcamentos/{numeroOS}/rejeitar`) | `{ numeroOS, orcamentoId, motivo? }` |
| `billing.pagamento-aprovado`  | webhook `order.processed` aprovado                        | `{ numeroOS, orderId, valor }`       |
| `billing.pagamento-recusado`  | webhook recusado / cancelado                              | `{ numeroOS, orderId, motivo }`      |

Cada callback leva um `id` estável. Se o OS não confirmar, o job de reconciliação reenvia o mesmo `id` a cada 2 min, e o OS deduplica.

Também há consultas para `CLIENTE` (só os próprios), `ATENDENTE` e `ADMIN`: `GET /orcamentos/{numeroOS}`, `GET /orcamentos?clienteId=` e `GET /pagamentos/{numeroOS}`. Swagger em `/api` fora de produção; contrato exportado em [`openapi.yaml`](openapi.yaml).

## Histórias

- [US-F4-04 — Repositórios dos serviços com CI/CD independente](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-04-repos-e-cicd-por-servico.md) _(este scaffold)_
- [US-F4-08 — Orçamento, aprovação e rejeição](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-08-billing-orcamento.md)
- [US-F4-09 — Pagamento com Mercado Pago](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-09-billing-mercado-pago.md)
- [US-F4-11 — Compensações (cancelar orçamento, estorno)](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-11-compensacoes-rollback.md)

## Execução local

```bash
cp .env.example .env
npm ci && npx prisma generate
npm run docker:up                 # Postgres próprio (sem broker — RFC-0008)
npx prisma migrate deploy
npm run start:dev                 # http://localhost:3001/api (Swagger)
```

Preencha as variáveis `MP_*` do `.env` para falar com o sandbox ([runbook](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/mercado-pago-sandbox.md)). Para os callbacks ao OS Service, suba o [OS Service](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service) localmente e aponte `OS_SERVICE_URL` (default `http://localhost:3000`).

Token para testar: a Lambda de auth (`POST {gateway}/auth`) ou, localmente, `mintToken` do kit (`@guilhermeqmaia/oficina-kit/testing`) com o mesmo `JWT_SECRET`.

## Testes e qualidade

```bash
npm run test:unit:cov        # gate 80% (jest.unit.config.js)
npm run test:integration     # e2e e contrato com Postgres via testcontainers
npm run test:bdd             # Gherkin + Cucumber (features/), relatório em reports/cucumber.html
npm run openapi:export       # gera o openapi.yaml
```

Cobertura dos testes unitários: acima de 99%, com gate de 80%. O repositório Prisma é medido pelos testes de integração, e o SonarCloud recebe os dois relatórios. Plano de testes e roteiro do sandbox: [`docs/qa-plans/QA_PLAN_FLUXO-2.md`](docs/qa-plans/QA_PLAN_FLUXO-2.md).

### Evidência de cobertura

[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=guilhermeqmaia_soat-fiap-oficina-billing-service&metric=coverage)](https://sonarcloud.io/summary/new_code?id=guilhermeqmaia_soat-fiap-oficina-billing-service) [![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=guilhermeqmaia_soat-fiap-oficina-billing-service&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=guilhermeqmaia_soat-fiap-oficina-billing-service)

| Suíte                                      | Resultado local (09/11/2026)                       |
| ------------------------------------------ | -------------------------------------------------- |
| Unitários (`test:unit:cov`)                | 134 testes, 99,83% de linhas e 99,25% de branches  |
| Integração e contrato (`test:integration`) | 26 testes; repositório Prisma com 98,52% de linhas |
| BDD (`test:bdd`)                           | 16 cenários, 95 passos                             |

### Swagger

Interface em `http://localhost:3001/api` fora de produção; em produção ela é desligada e o gateway não expõe o `/api`. O contrato versionado está em [`openapi.yaml`](openapi.yaml), que o CI compara com o código, e publicado no hub em [`docs/contratos/openapi/billing-service.yaml`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/openapi/billing-service.yaml).

## Deploy

CD automático (`cd-aws.yml`): `homolog` → homologação, `main` → produção. Build → ECR → EKS (`k8s-aws/`) → migrations → smoke.

| Secret/var do repo                      | Uso                                                               |
| --------------------------------------- | ----------------------------------------------------------------- |
| `AWS_ROLE_ARN` (secret)                 | OIDC da role `github-actions-oficina`                             |
| `EKS_CLUSTER_NAME`, `AWS_REGION` (vars) | cluster alvo                                                      |
| `DB_SECRET_ID` (var)                    | segredo do banco **próprio** no Secrets Manager (infra-db)        |
| `JWT_SECRET_ID` (var)                   | segredo HS256 compartilhado com a Lambda                          |
| `MP_SECRET_ID` (var)                    | JSON com `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PAYER_EMAIL` |

O Service expõe o **NodePort `30081`**, alvo do target group deste serviço no NLB interno único (ADR-0013). `OS_SERVICE_URL` é fixo no [`k8s/configmap.yaml`](k8s/configmap.yaml) (`http://oficina-app:3000`, DNS interno do cluster).

## Arquitetura do serviço

```mermaid
flowchart LR
  GW[API Gateway] -->|/orcamentos, /pagamentos, /webhooks| S[oficina-billing-service]
  OS[OS Service] -->|HTTP: POST /orcamentos, /cobrar, DELETE| S
  S -->|callback: POST /ordens-servico/n/eventos| OS
  S --> DB[(Postgres oficina_billing)]
  MP[Mercado Pago] -->|webhook via gateway| S
```
