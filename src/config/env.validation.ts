/**
 * Fail-fast no boot (`ConfigModule.forRoot({ validate })`): sem JWT_SECRET o
 * servico nao valida os tokens da Lambda; sem DATABASE_URL nao ha banco proprio.
 */
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRETS = new Set([
  'change-me-to-a-strong-random-secret',
  'changeme',
  'change-me',
  'secret',
]);

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const secret = config.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0)
    throw new Error('JWT_SECRET e obrigatorio.');
  if (PLACEHOLDER_SECRETS.has(secret))
    throw new Error('JWT_SECRET nao pode ser um placeholder (gere com `openssl rand -base64 48`).');
  if (config.NODE_ENV === 'production' && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET deve ter ao menos ${MIN_SECRET_LENGTH} caracteres em producao.`);
  }
  if (typeof config.DATABASE_URL !== 'string' || !config.DATABASE_URL.startsWith('postgres')) {
    throw new Error('DATABASE_URL e obrigatoria (banco proprio deste servico).');
  }
  return config;
}
