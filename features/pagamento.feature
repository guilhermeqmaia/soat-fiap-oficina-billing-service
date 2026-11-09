# language: pt
Funcionalidade: Confirmacao do pagamento pelo Mercado Pago
  Como cliente
  Quero que meu pagamento seja reconhecido automaticamente
  Para retirar o veiculo sem conferencia manual

  Contexto:
    Dado que o orcamento ja foi gerado
    E que o cliente ja aprovou o orcamento
    E que a cobranca ja foi criada

  Cenario: Pagamento aprovado
    Dado que o Mercado Pago informa a order como "processed" com detalhe "accredited"
    Quando o webhook assinado chega
    Entao o webhook e aceito
    E o OS Service recebe o callback "billing.pagamento-aprovado"
    E a cobranca fica "APROVADA"

  Cenario: Pagamento recusado
    Dado que o Mercado Pago informa a order como "failed" com detalhe "cc_rejected"
    Quando o webhook assinado chega
    Entao o webhook e aceito
    E o OS Service recebe o callback "billing.pagamento-recusado"
    E a cobranca fica "RECUSADA"

  Cenario: Pagamento pendente mantem a cobranca aberta
    Dado que o Mercado Pago informa a order como "action_required" com detalhe "waiting_payment"
    Quando o webhook assinado chega
    Entao o webhook e aceito
    E nenhum callback de pagamento e enviado
    E a cobranca fica "PENDENTE"

  Cenario: Webhook com assinatura invalida e ignorado
    Quando um webhook com assinatura invalida chega
    Entao a resposta tem status 401
    E nenhum callback de pagamento e enviado
    E a cobranca fica "PENDENTE"

  Cenario: Webhook perdido e recuperado pela reconciliacao
    Dado que o Mercado Pago informa a order como "processed" com detalhe "accredited"
    Quando a reconciliacao e executada
    Entao o OS Service recebe o callback "billing.pagamento-aprovado"
    E a cobranca fica "APROVADA"
