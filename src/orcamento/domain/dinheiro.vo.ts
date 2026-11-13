import { ValorMonetarioInvalidoError } from './errors';

const FORMATO = /^\d+\.\d{2}$/;

/** Valor monetario em centavos inteiros; na borda e sempre string com 2 casas (asyncapi `Dinheiro`). */
export class Dinheiro {
  private constructor(readonly centavos: number) {}

  static de(valor: string): Dinheiro {
    if (!FORMATO.test(valor)) throw new ValorMonetarioInvalidoError(valor);
    const [reais, centavos] = valor.split('.');
    return new Dinheiro(Number(reais) * 100 + Number(centavos));
  }

  static zero(): Dinheiro {
    return new Dinheiro(0);
  }

  somar(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos);
  }

  multiplicar(quantidade: number): Dinheiro {
    return new Dinheiro(this.centavos * quantidade);
  }

  toString(): string {
    const resto = this.centavos % 100;
    return `${Math.floor(this.centavos / 100)}.${String(resto).padStart(2, '0')}`;
  }
}
