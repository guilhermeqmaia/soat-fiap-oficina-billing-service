import { createHmac, timingSafeEqual } from 'crypto';

export interface DadosAssinatura {
  readonly assinatura?: string;
  readonly xRequestId?: string;
  readonly dataId: string;
}

/**
 * Valida o `x-signature` (`ts=...,v1=...`). Manifest do Mercado Pago:
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, com o id em minusculas
 * quando alfanumerico (docs/mercado-pago-sandbox.md).
 */
export function assinaturaValida(segredo: string, dados: DadosAssinatura): boolean {
  if (!segredo || !dados.assinatura || !dados.xRequestId) return false;
  const partes = new Map(
    dados.assinatura.split(',').map((parte) => {
      const [chave, ...valor] = parte.trim().split('=');
      return [chave, valor.join('=')] as const;
    }),
  );
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return false;

  const id = /^[a-z0-9]+$/i.test(dados.dataId) ? dados.dataId.toLowerCase() : dados.dataId;
  const esperado = createHmac('sha256', segredo)
    .update(`id:${id};request-id:${dados.xRequestId};ts:${ts};`)
    .digest();
  const recebido = Buffer.from(v1, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
