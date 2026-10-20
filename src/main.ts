// Tracing precisa ser inicializado antes de qualquer outro import (US-F3-10).
import { iniciarTracing } from '@guilhermeqmaia/oficina-kit/metrics';
import { SERVICE_NAME } from './config/service-name';
iniciarTracing({ service: SERVICE_NAME });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('oficina-billing-service')
      .setDescription(
        'Orçamento, aprovação/rejeição e pagamento via Mercado Pago (Billing Service)',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
