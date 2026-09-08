import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { REFRESH_COOKIE_NAME } from '@/auth/auth.constants';
import { JWT_BEARER_AUTH, REFRESH_COOKIE_AUTH } from '@/auth/auth.swagger';

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
        description: 'HKTutor JWT access token supplied as Authorization: Bearer <token>',
        scheme: 'bearer',
        type: 'http',
      },
      JWT_BEARER_AUTH,
    )
    .addCookieAuth(
      REFRESH_COOKIE_NAME,
      {
        description: 'HttpOnly rotating refresh cookie set by login or email verification',
        in: 'cookie',
        type: 'apiKey',
      },
      REFRESH_COOKIE_AUTH,
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, documentFactory, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
