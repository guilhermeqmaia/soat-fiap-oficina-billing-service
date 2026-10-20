import { PrismaHealthIndicator } from './prisma-health.indicator';
import { PrismaService } from '../prisma/prisma.service';

const prisma = (impl: () => Promise<unknown>) =>
  ({ $queryRaw: jest.fn(impl) }) as unknown as PrismaService;

describe('PrismaHealthIndicator', () => {
  it('passa quando o banco responde', async () => {
    await expect(
      new PrismaHealthIndicator(prisma(async () => [{ ok: 1 }])).check(),
    ).resolves.toBeUndefined();
  });
  it('propaga a falha (vira 503 no /health/ready)', async () => {
    await expect(
      new PrismaHealthIndicator(
        prisma(async () => {
          throw new Error('down');
        }),
      ).check(),
    ).rejects.toThrow('down');
  });
});
