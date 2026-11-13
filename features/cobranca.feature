# language: pt
Funcionalidade: Cobranca apos a execucao do servico
  Como orquestrador da OS
  Quero criar a cobranca no Mercado Pago
  Para enviar o link de pagamento ao cliente

  Contexto:
    Dado que o orcamento ja foi gerado

  Cenario: Cobranca criada para orcamento aprovado
    Dado que o cliente ja aprovou o orcamento
    Quando o OS Service solicita a cobranca
    Entao a resposta tem status 201
    E a resposta traz o link de pagamento e o valor "300.00"
    E o ledger registra "COBRANCA_CRIADA"

  Cenario: Repetir a cobranca nao cria outra order
    Dado que o cliente ja aprovou o orcamento
    E que a cobranca ja foi criada
    Quando o OS Service solicita a cobranca novamente
    Entao a resposta tem status 201
    E existe uma unica cobranca para a OS

  Cenario: Orcamento sem aprovacao nao pode ser cobrado
    Quando o OS Service solicita a cobranca sem order prevista
    Entao a resposta tem status 409
    E a resposta informa o motivo
