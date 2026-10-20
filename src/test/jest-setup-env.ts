// Roda ANTES de qualquer import (jest setupFiles): o validateEnv do ConfigModule
// executa no import do AppModule e o CI nao tem .env.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-ci-0123456789abcdef-strong';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/oficina_billing_test?schema=public';
