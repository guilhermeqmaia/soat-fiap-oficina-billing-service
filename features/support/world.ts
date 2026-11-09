import '../../src/test/jest-setup-env';
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, World } from '@cucumber/cucumber';
import { INestApplication } from '@nestjs/common';
import nock from 'nock';
import type { Response } from 'supertest';
import { subirApp, CallbackRecebido } from '../../src/test/app-harness';
import { startTestDatabase, stopTestDatabase } from '../../src/test/database.container';

setDefaultTimeout(120_000);

export let app: INestApplication;

export class BillingWorld extends World {
  numero = '';
  orderId = '';
  resposta!: Response;
  callbacks: CallbackRecebido[] = [];
}

let sequencia = 0;

BeforeAll(async () => {
  process.env.DATABASE_URL = await startTestDatabase();
  app = await subirApp();
});

AfterAll(async () => {
  nock.restore();
  await app.close();
  await stopTestDatabase();
});

Before(function (this: BillingWorld) {
  nock.cleanAll();
  sequencia += 1;
  this.numero = `OS-BDD-${sequencia}`;
  this.orderId = `ORDBDD${sequencia}`;
});

After(function () {
  nock.cleanAll();
});
