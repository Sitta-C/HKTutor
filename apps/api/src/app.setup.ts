import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { CLERK_BEARER_AUTH } from '@/auth/auth.swagger';

import type { INestApplication } from '@nestjs/common';

export function configureApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HKTutor API')
    .setDescription('REST API for the HKTutor platform')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        bearerFormat: 'JWT',
        description: 'Clerk session token supplied as Authorization: Bearer <token>',
        scheme: 'bearer',
        type: 'http',
      },
      CLERK_BEARER_AUTH,
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, documentFactory, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
