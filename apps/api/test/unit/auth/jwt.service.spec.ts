import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import { JwtTokenService } from '@/auth/jwt.service';
import { AuthConfigService } from '@/config/auth.config';
import { Role } from '@/generated/prisma/client';

describe('JwtTokenService', () => {
  const accessSecret = 'access-secret-with-more-than-thirty-two-characters';
  const refreshSecret = 'refresh-secret-with-more-than-thirty-two-characters';
  const config = new AuthConfigService(
    new ConfigService({
      JWT_ACCESS_SECRET: accessSecret,
      JWT_REFRESH_SECRET: refreshSecret,
      JWT_ACCESS_TTL_SECONDS: '900',
      JWT_REFRESH_TTL_SECONDS: '604800',
    }),
  );
  const tokens = new JwtTokenService(config);

  it('verifies access and refresh tokens only with their intended secret and type', () => {
    const access = tokens.signAccessToken('user-id', 'session-id', Role.STUDENT);
    const refresh = tokens.signRefreshToken('user-id', 'session-id', Role.STUDENT);

    expect(tokens.verifyAccessToken(access)).toMatchObject({
      sub: 'user-id',
      sid: 'session-id',
      role: Role.STUDENT,
      type: 'access',
    });
    expect(tokens.verifyRefreshToken(refresh)).toMatchObject({ type: 'refresh' });
    expect(tokens.verifyAccessToken(refresh)).toBeNull();
    expect(tokens.verifyRefreshToken(access)).toBeNull();
  });

  it.each([
    ['an invalid signature', () => signedAccessToken({ secret: 'different-secret' })],
    ['an unexpected issuer', () => signedAccessToken({ issuer: 'another-api' })],
    ['an unexpected audience', () => signedAccessToken({ audience: 'another-client' })],
    ['an expired token', () => signedAccessToken({ expiresIn: -1 })],
    ['an unexpected algorithm', () => signedAccessToken({ algorithm: 'HS384' })],
  ])('rejects an access token with %s', (_description, createToken) => {
    expect(tokens.verifyAccessToken(createToken())).toBeNull();
  });

  it('rejects a correctly signed access token without an expiry', () => {
    const token = jwt.sign(
      { jti: 'token-id', role: Role.STUDENT, sid: 'session-id', type: 'access' },
      accessSecret,
      {
        audience: config.audience,
        issuer: config.issuer,
        subject: 'user-id',
      },
    );

    expect(tokens.verifyAccessToken(token)).toBeNull();
  });

  function signedAccessToken(options: {
    algorithm?: jwt.Algorithm;
    audience?: string;
    expiresIn?: number;
    issuer?: string;
    secret?: string;
  }): string {
    return jwt.sign(
      { jti: 'token-id', role: Role.STUDENT, sid: 'session-id', type: 'access' },
      options.secret ?? accessSecret,
      {
        algorithm: options.algorithm ?? 'HS256',
        audience: options.audience ?? config.audience,
        expiresIn: options.expiresIn ?? 900,
        issuer: options.issuer ?? config.issuer,
        subject: 'user-id',
      },
    );
  }
});
