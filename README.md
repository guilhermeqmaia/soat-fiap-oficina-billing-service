# **REPO**

[![CI](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/ci.yml) [![CD AWS](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/cd-aws.yml/badge.svg)](https://github.com/guilhermeqmaia/soat-fiap-oficina-billing-service/actions/workflows/cd-aws.yml)

****DESCRICAO**** — microsserviço do Sistema da Oficina Mecânica (Tech Challenge FIAP, Fase 4). Gerado pelo template do [`@guilhermeqmaia/oficina-kit`](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit).

> Planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas: [hub](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/plano-execucao-fase-4.md).

## Responsabilidades

**Possui:** Orçamento (geração a partir do diagnóstico, aprovação/rejeição pelo cliente), Pagamento (Mercado Pago Checkout Pro + webhook assinado) e **ledger** append-only. Banco próprio **PostgreSQL** `oficina_billing` ([RFC-0004](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/arquitetura/rfcs/RFC-0004-decomposicao-em-microsservicos.md)).

**Não possui:** a OS (OS Service), itens/preços do catálogo (Execução — chegam congelados no comando `billing.gerar-orcamento`), notificação ao cliente (OS Service).

## Eventos e comandos

| Direção                            | Mensagem                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| consome (fila `billing-comandos`)  | `billing.gerar-orcamento`, `billing.cancelar-orcamento`                                                                                                                            |
| publica (tópico `oficina-billing`) | `billing.orcamento-gerado`, `billing.orcamento-aprovado`, `billing.orcamento-rejeitado`, `billing.pagamento-aprovado`, `billing.pagamento-recusado`, `billing.orcamento-cancelado` |

Contratos: [`docs/contratos/asyncapi.yaml`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/asyncapi.yaml).

## Histórias

- [US-F4-04 — Repositórios dos serviços com CI/CD independente](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-04-repos-e-cicd-por-servico.md) _(este scaffold)_
- [US-F4-08 — Orçamento, aprovação e rejeição](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-08-billing-orcamento.md)
- [US-F4-09 — Pagamento com Mercado Pago](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-09-billing-mercado-pago.md)
- [US-F4-11 — Compensações (cancelar orçamento, estorno)](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-11-compensacoes-rollback.md)

## Execução local

```bash
cp .env.example .env
npm ci && npx prisma generate
npm run docker:up                 # Postgres próprio + LocalStack com a topologia da RFC-0006
npx prisma migrate deploy
npm run start:dev                 # http://localhost:3001/api (Swagger)
```

Token para testar: a Lambda de auth (`POST {gateway}/auth`) ou, localmente, `mintToken` do kit (`@guilhermeqmaia/oficina-kit/testing`) com o mesmo `JWT_SECRET`.

## Testes e qualidade

```bash
npm run test:unit:cov        # gate 80% (jest.unit.config.js)
npm run test:integration     # e2e com Postgres via testcontainers
```

<!-- Evidências de cobertura: badge do SonarCloud + print em docs/evidencias/ -->

## Deploy

CD automático (`cd-aws.yml`): `homolog` → homologação, `main` → produção. Build → ECR → EKS (`k8s-aws/`) → migrations → smoke.

| Secret/var do repo                      | Uso                                                        |
| --------------------------------------- | ---------------------------------------------------------- |
| `AWS_ROLE_ARN` (secret)                 | OIDC da role `github-actions-oficina`                      |
| `EKS_CLUSTER_NAME`, `AWS_REGION` (vars) | cluster alvo                                               |
| `DB_SECRET_ID` (var)                    | segredo do banco **próprio** no Secrets Manager (infra-db) |
| `JWT_SECRET_ID` (var)                   | segredo HS256 compartilhado com a Lambda                   |
| `SNS_TOPIC_ARN`, `SQS_QUEUE_URL` (vars) | saídas do stage `messaging/` (infra-k8s)                   |

O Service expõe o **NodePort `30081`**, alvo do target group deste serviço no NLB interno único (ADR-0013).

## Arquitetura do serviço

```mermaid
flowchart LR
  GW[API Gateway] -->|/billing*| S[oficina-billing-service]
  S --> DB[(Postgres oficina_billing)]
  S -->|outbox → SNS| T[(oficina-billing.fifo)]
  Q[(billing-comandos.fifo)] -->|SQS| S
```
