import { duracaoIsoMs } from './duracao-iso';

describe('duracaoIsoMs', () => {
  it.each([
    ['P1D', 24 * 3600 * 1000],
    ['PT30M', 30 * 60 * 1000],
    ['P1DT12H', 36 * 3600 * 1000],
    ['P1W', 7 * 24 * 3600 * 1000],
    ['PT90S', 90 * 1000],
  ])('%s', (texto, ms) => {
    expect(duracaoIsoMs(texto)).toBe(ms);
  });

  it.each(['', 'P', 'PT', 'P1DT', '1D', 'P0D', 'P1.5D', 'dia'])('invalida: "%s"', (texto) => {
    expect(duracaoIsoMs(texto)).toBeNull();
  });
});
