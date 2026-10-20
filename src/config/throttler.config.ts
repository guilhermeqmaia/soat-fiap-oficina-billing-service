import type { ExecutionContext } from '@nestjs/common';

export const THROTTLER_TTL_MS = 60_000;
export const THROTTLER_LIMIT = 100;
const ROTAS_DE_INFRA = ['/health', '/metrics'];

/** `/health` e `/metrics` vem do kit (sem @SkipThrottle); probes/scrape nunca recebem 429. */
export function isRotaDeInfra(context?: ExecutionContext): boolean {
  if (!context || context.getType() !== 'http') return false;
  const path: string | undefined = context.switchToHttp().getRequest()?.path;
  return !!path && ROTAS_DE_INFRA.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Desligado sob jest, sob THROTTLER_DISABLED=true (atras do gateway o limite e da borda) e nas rotas de infra. */
export function shouldSkipThrottling(
  env: NodeJS.ProcessEnv = process.env,
  context?: ExecutionContext,
): boolean {
  return (
    env.THROTTLER_DISABLED === 'true' ||
    env.NODE_ENV === 'test' ||
    !!env.JEST_WORKER_ID ||
    isRotaDeInfra(context)
  );
}
