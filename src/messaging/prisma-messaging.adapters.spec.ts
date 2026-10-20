import { PrismaOutbox, PrismaProcessed } from './prisma-messaging.adapters';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  outbox: {
    create: jest.fn(async () => ({})),
    findMany: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
  },
  processedMessage: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})) },
} as unknown as PrismaService;

describe('adapters Prisma da mensageria', () => {
  it('PrismaOutbox usa a tabela outbox do servico', async () => {
    const repo = new PrismaOutbox(prisma);
    await expect(repo.pendentes(5)).resolves.toEqual([]);
    expect(
      (prisma as unknown as { outbox: { findMany: jest.Mock } }).outbox.findMany,
    ).toHaveBeenCalled();
  });
  it('PrismaProcessed usa a tabela processed_messages', async () => {
    const store = new PrismaProcessed(prisma);
    await expect(store.jaProcessada('x')).resolves.toBe(false);
    await store.marcar('x', 'a.b');
    expect(
      (prisma as unknown as { processedMessage: { create: jest.Mock } }).processedMessage.create,
    ).toHaveBeenCalled();
  });
});
