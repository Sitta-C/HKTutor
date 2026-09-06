import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/app.module';
import { configureApplication } from '@/app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // only if you're using cookies; not needed for Bearer-token auth
  });

  configureApplication(app);
  await app.listen(process.env['PORT'] ?? 3001);
}
void bootstrap();
