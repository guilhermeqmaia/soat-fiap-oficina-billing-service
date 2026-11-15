import '../../src/test/jest-setup-env';
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, World } from '@cucumber/cucumber';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import {
  AppDeTeste,
  CallbackRecebido,
  callbacksRecebidos,
  pararApp,
  subirApp,
} from '../../src/test/app-harness';
import { startTestDatabase, stopTestDatabase } from '../../src/test/database.container';
import { MercadoPagoFake } from '../../src/test/mercado-pago-fake';
import { ServidorHttpFake } from '../../src/test/servidor-http-fake';

setDefaultTimeout(120_000);

let teste: AppDeTeste;
export let app: INestApplication;
export let os: ServidorHttpFake;
export let mp: MercadoPagoFake;

export class BillingWorld extends World {
  numero = '';
  orderId = '';
  resposta!: Response;

  /** Callbacks que o OS fake recebeu neste cenario. */
  get callbacks(): CallbackRecebido[] {
    return callbacksRecebidos(os);
  }
}

let sequencia = 0;

BeforeAll(async () => {
  process.env.DATABASE_URL = await startTestDatabase();
  teste = await subirApp();
  ({ app, os, mp } = teste);
});

AfterAll(async () => {
  await pararApp(teste);
  await stopTestDatabase();
});

Before(function (this: BillingWorld) {
  os.limpar();
  mp.limpar();
  sequencia += 1;
  this.numero = `OS-BDD-${sequencia}`;
  this.orderId = `ORDBDD${sequencia}`;
});

After(function () {
  os.limpar();
  mp.limpar();
});
