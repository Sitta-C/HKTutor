import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import {} from '@/users/users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getCleckUserID(userID: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      select: {
        clerkUserId: true,
      },
      where: {
        deletedAt: null,
      },
    });

    if (!user) return null;

    return user.clerkUserId;
  }
}
