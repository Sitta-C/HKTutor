import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { validateDatabaseEnvironment } from '@/config/database.config';
import { DatabaseModule } from '@/database/database.module';
import { HealthModule } from '@/health/health.module';
import { TutorsModule } from '@/tutors/tutors.module';
import { UsersModule } from '@/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateDatabaseEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    TutorsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
