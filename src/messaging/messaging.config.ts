import { DynamicModule } from '@nestjs/common';
import { MessagingModule } from '@guilhermeqmaia/oficina-kit/messaging';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaOutbox, PrismaProcessed } from './prisma-messaging.adapters';

/**
 * Mensageria do servico (RFC-0006). Sem SNS_TOPIC_ARN o servico sobe sem
 * broker (testes unitarios, dev sem LocalStack). Registre os handlers de
 * comandos/eventos em `handlers` conforme o AsyncAPI do hub.
 */
export function messagingModule(env: NodeJS.ProcessEnv = process.env): DynamicModule[] {
  if (!env.SNS_TOPIC_ARN) return [];
  return [
    MessagingModule.forRoot({
      aws: {
        region: env.AWS_REGION,
        endpoint: env.AWS_ENDPOINT || undefined,
        credentials: env.AWS_ENDPOINT
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID ?? 'test',
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? 'test',
            }
          : undefined,
      },
      topicArn: env.SNS_TOPIC_ARN,
      outboxRepository: PrismaOutbox,
      imports: [PrismaModule],
      consumer: env.SQS_QUEUE_URL
        ? { queueUrl: env.SQS_QUEUE_URL, processedMessageStore: PrismaProcessed, handlers: [] }
        : undefined,
    }),
  ];
}
