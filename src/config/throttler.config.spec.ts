import type { ExecutionContext } from '@nestjs/common';
import { isRotaDeInfra, shouldSkipThrottling } from './throttler.config';

const http = (path: string, type = 'http') =>
  ({
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
  }) as unknown as ExecutionContext;

describe('throttler.config', () => {
  it('pula /health e /metrics', () => {
    for (const p of ['/health', '/health/ready', '/metrics'])
      expect(isRotaDeInfra(http(p))).toBe(true);
  });
  it('nao pula rotas de negocio, contexto nao-http ou sem contexto', () => {
    expect(isRotaDeInfra(http('/orcamentos'))).toBe(false);
    expect(isRotaDeInfra(http('/health', 'rpc'))).toBe(false);
    expect(isRotaDeInfra()).toBe(false);
  });
  it('shouldSkipThrottling respeita env e rota', () => {
    expect(shouldSkipThrottling({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldSkipThrottling({ NODE_ENV: 'production', THROTTLER_DISABLED: 'true' })).toBe(true);
    expect(shouldSkipThrottling({ NODE_ENV: 'test' })).toBe(true);
    expect(shouldSkipThrottling({ NODE_ENV: 'production', JEST_WORKER_ID: '1' })).toBe(true);
    expect(shouldSkipThrottling({ NODE_ENV: 'production' }, http('/metrics'))).toBe(true);
  });
});
