import { validateEnv } from './env.validation';

const ok = { JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://u:p@h:5432/db' };

describe('validateEnv', () => {
  it('aceita configuracao valida', () => expect(validateEnv(ok)).toBe(ok));
  it('exige JWT_SECRET', () =>
    expect(() => validateEnv({ ...ok, JWT_SECRET: '' })).toThrow(/JWT_SECRET/));
  it('rejeita placeholder', () =>
    expect(() => validateEnv({ ...ok, JWT_SECRET: 'changeme' })).toThrow(/placeholder/));
  it('exige segredo forte em producao', () =>
    expect(() => validateEnv({ ...ok, NODE_ENV: 'production', JWT_SECRET: 'curto' })).toThrow(
      /32/,
    ));
  it('tolera segredo curto fora de producao', () =>
    expect(() => validateEnv({ ...ok, JWT_SECRET: 'curto' })).not.toThrow());
  it('exige DATABASE_URL postgres', () =>
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/));
  it('em producao exige as variaveis do Billing', () => {
    const producao = {
      ...ok,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      OS_SERVICE_URL: 'http://os',
      MP_ACCESS_TOKEN: 't',
      MP_WEBHOOK_SECRET: 's',
      MP_PAYER_EMAIL: 'e@e.com',
    };
    expect(validateEnv(producao)).toBe(producao);
    for (const nome of [
      'OS_SERVICE_URL',
      'MP_ACCESS_TOKEN',
      'MP_WEBHOOK_SECRET',
      'MP_PAYER_EMAIL',
    ]) {
      expect(() => validateEnv({ ...producao, [nome]: '' })).toThrow(nome);
    }
  });
});
