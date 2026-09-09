import type { Role } from '@/generated/prisma/client';

export interface JwtPayload {
  sub: string;
  sid: string;
  role: Role;
  type: 'access' | 'refresh';
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: PublicUser;
}
