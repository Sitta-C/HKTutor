import { Injectable, Inject } from '@nestjs/common';

import type { ClerkClient } from '@clerk/backend';

@Injectable()
export class TestService {
  constructor(@Inject('CLERK_CLIENT') private readonly clerkClient: ClerkClient) {}

  async getTestToken(): Promise<string> {
    if (!process.env['TEST_CLERK_USER_ID']) {
      return '';
    }
    const sessions = await this.clerkClient.sessions.createSession({
      userId: process.env['TEST_CLERK_USER_ID'],
    });
    const token = await this.clerkClient.sessions.getToken(sessions.id);
    return token.jwt;
  }
}
