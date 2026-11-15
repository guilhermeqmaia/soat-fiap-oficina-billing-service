const DURACAO_ISO = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const SEGUNDOS = [7 * 24 * 3600, 24 * 3600, 3600, 60, 1];

/**
 * Duracao ISO 8601 (o formato do `expiration_time` do Mercado Pago, ex. `P1D`,
 * `PT30M`) em milissegundos. `null` quando o texto nao e uma duracao valida.
 */
export function duracaoIsoMs(texto: string): number | null {
  const partes = DURACAO_ISO.exec(texto);
  if (!partes || texto === 'P' || texto.endsWith('T')) return null;
  const total = partes
    .slice(1)
    .reduce((soma, valor, i) => soma + Number(valor ?? 0) * SEGUNDOS[i], 0);
  return total > 0 ? total * 1000 : null;
}
