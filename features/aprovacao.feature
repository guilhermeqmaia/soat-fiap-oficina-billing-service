# language: pt
Funcionalidade: Aprovacao e rejeicao do orcamento pelo cliente
  Como cliente
  Quero decidir sobre o orcamento da minha OS
  Para liberar a execucao ou encerrar o atendimento

  Contexto:
    Dado que o orcamento ja foi gerado

  Cenario: Cliente aprova e o OS Service e avisado
    Quando o cliente aprova o orcamento
    Entao a resposta tem status 200
    E o OS Service recebe o callback "billing.orcamento-aprovado"
    E o ledger registra "ORCAMENTO_APROVADO"

  Cenario: Cliente rejeita e o motivo chega ao OS Service
    Quando o cliente rejeita o orcamento com o motivo "muito caro"
    Entao a resposta tem status 200
    E o OS Service recebe o callback "billing.orcamento-rejeitado"
    E o callback traz o motivo "muito caro"

  Cenario: Outro cliente nao pode decidir
    Quando outro cliente tenta aprovar o orcamento
    Entao a resposta tem status 403

  Cenario: Orcamento aprovado e imutavel
    Dado que o cliente ja aprovou o orcamento
    Quando o cliente rejeita o orcamento com o motivo "desisti"
    Entao a resposta tem status 409
