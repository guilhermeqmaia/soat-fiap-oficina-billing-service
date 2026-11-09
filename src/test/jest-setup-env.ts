// Roda ANTES de qualquer import (jest setupFiles): o validateEnv do ConfigModule
// executa no import do AppModule e o CI nao tem .env.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-ci-0123456789abcdef-strong';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/oficina_billing_test?schema=public';
process.env.MP_ACCESS_TOKEN ??= 'TEST-token-de-teste';
process.env.MP_WEBHOOK_SECRET ??= 'segredo-webhook-de-teste';
process.env.MP_PAYER_EMAIL ??= 'comprador@testuser.com';
process.env.OS_SERVICE_URL ??= 'http://os-service.test';
process.env.RECONCILIACAO_DESABILITADA ??= 'true';
