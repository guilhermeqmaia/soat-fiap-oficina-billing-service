import { messagingModule } from './messaging.config';

describe('messagingModule', () => {
  it('sem SNS_TOPIC_ARN nao registra o broker', () => expect(messagingModule({})).toEqual([]));
  it('com topico registra o MessagingModule; consumer so com fila', () => {
    const [m] = messagingModule({ SNS_TOPIC_ARN: 'arn', AWS_ENDPOINT: 'http://localhost:4566' });
    expect(m.module.name).toBe('MessagingModule');
    const [c] = messagingModule({ SNS_TOPIC_ARN: 'arn', SQS_QUEUE_URL: 'http://q' });
    expect(c.providers?.length).toBeGreaterThan(m.providers?.length ?? 0);
  });
});
