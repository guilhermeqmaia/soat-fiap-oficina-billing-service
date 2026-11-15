import { createHmac, timingSafeEqual } from 'crypto';

export interface DadosAssinatura {
  readonly assinatura?: string;
  readonly xRequestId?: string;
  readonly dataId: string;
}

/** Janela aceita entre o `ts` assinado e o relogio local: limita o replay de uma notificacao. */
export const TOLERANCIA_TS_MS = 10 * 60 * 1000;

/** `ts` em segundos ou milissegundos (a documentacao do Mercado Pago mostra os dois). */
function tsEmMs(ts: string): number | null {
  if (!/^\d{1,16}$/.test(ts)) return null;
  const valor = Number(ts);
  return valor < 1e12 ? valor * 1000 : valor;
}

/**
 * Valida o `x-signature` (`ts=...,v1=...`). Manifest do Mercado Pago:
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, com o id em minusculas
 * quando alfanumerico (docs/mercado-pago-sandbox.md). O `ts` precisa estar a
 * ate `TOLERANCIA_TS_MS` de `agora`.
 */
export function assinaturaValida(
  segredo: string,
  dados: DadosAssinatura,
  agora: Date = new Date(),
): boolean {
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
  const assinadoEm = tsEmMs(ts);
  if (assinadoEm === null || Math.abs(agora.getTime() - assinadoEm) > TOLERANCIA_TS_MS) {
    return false;
  }

  const id = /^[a-z0-9]+$/i.test(dados.dataId) ? dados.dataId.toLowerCase() : dados.dataId;
  const esperado = createHmac('sha256', segredo)
    .update(`id:${id};request-id:${dados.xRequestId};ts:${ts};`)
    .digest();
  const recebido = Buffer.from(v1, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
