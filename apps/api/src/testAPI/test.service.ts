import { Injectable, Inject } from '@nestjs/common';
import type { ClerkClient, TestingToken } from '@clerk/backend';

@Injectable()
export class TestService {
    constructor(@Inject('CLERK_CLIENT') private readonly clerkClient: ClerkClient) {}

    async getTestToken(): Promise<string> {
        const sessions = await this.clerkClient.sessions.createSession({userId: "user_3Io8Nz2zdL3A6rE9WP3G2NQtCBB"});
        const token = await this.clerkClient.sessions.getToken(sessions.id);
        return token.jwt;
    }
}