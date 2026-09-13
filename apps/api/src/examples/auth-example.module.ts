import { Module } from '@nestjs/common';

import { AuthExampleController } from '@/examples/auth-example.controller';

/**
 * Module สำหรับ endpoint ตัวอย่างเท่านั้น
 *
 * AuthModule ถูกโหลดจาก AppModule แบบ global จึงไม่ต้อง import ซ้ำที่นี่
 * และทำให้ JwtAuthGuard สามารถ inject JwtTokenService/PrismaService ได้ตามปกติ
 */
@Module({
  controllers: [AuthExampleController],
})
export class AuthExampleModule {}
