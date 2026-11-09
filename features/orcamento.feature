# language: pt
Funcionalidade: Geracao do orcamento
  Como orquestrador da OS
  Quero gerar o orcamento a partir do diagnostico
  Para que o cliente receba os valores com precos congelados

  Cenario: Orcamento gerado a partir dos itens do diagnostico
    Quando o OS Service solicita o orcamento
    Entao a resposta tem status 201
    E o total do orcamento e "300.00"
    E o orcamento vale por 7 dias
    E o ledger registra "ORCAMENTO_GERADO"

  Cenario: Solicitacao duplicada devolve o orcamento existente
    Dado que o orcamento ja foi gerado
    Quando o OS Service solicita o orcamento
    Entao a resposta tem status 200
    E existe um unico orcamento para a OS

  Cenario: Compensacao cancela o orcamento de forma idempotente
    Dado que o orcamento ja foi gerado
    Quando o OS Service cancela o orcamento
    E o OS Service cancela o orcamento
    Entao a resposta tem status 200
    E nada foi estornado
    E o ledger registra "ORCAMENTO_CANCELADO" uma unica vez
