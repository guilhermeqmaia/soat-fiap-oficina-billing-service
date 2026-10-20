import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mintToken } from '@guilhermeqmaia/oficina-kit/testing';
import { Role } from '@guilhermeqmaia/oficina-kit/auth';
import { AppModule } from './app.module';
import { startTestDatabase, stopTestDatabase } from './test/database.container';

jest.setTimeout(120000);

/** Rota protegida de teste: no template nao ha dominio ainda; os guards do kit sao globais. */
@Controller('t')
class ProtegidoController {
  @Get('privado')
  privado() {
    return { ok: true };
  }
}

/** Contrato minimo de todo servico: health, readiness no banco proprio, metrics, JWT da Lambda. */
describe('oficina-billing-service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = await startTestDatabase();
    const ref = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtegidoController],
    }).compile();
    app = ref.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await stopTestDatabase();
  });

  it('GET /health e /health/ready (banco proprio) sao publicos', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body.checks.database.status).toBe('ok');
  });

  it('GET /metrics expoe o label service', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('service="oficina-billing-service"');
  });

  it('rotas sao protegidas pelo JWT da Lambda por padrao (401 sem token, 200 com token valido)', async () => {
    await request(app.getHttpServer()).get('/t/privado').expect(401);
    const token = mintToken({ sub: 'u1', role: Role.ADMIN });
    await request(app.getHttpServer())
      .get('/t/privado')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });
});
