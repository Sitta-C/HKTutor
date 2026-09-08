import { ConfigService } from '@nestjs/config';

import { JwtTokenService } from '@/auth/jwt.service';
import { AuthConfigService } from '@/config/auth.config';
import { Role } from '@/generated/prisma/client';

describe('JwtTokenService', () => {
  const config = new AuthConfigService(
    new ConfigService({
      JWT_ACCESS_SECRET: 'access-secret-with-more-than-thirty-two-characters',
      JWT_REFRESH_SECRET: 'refresh-secret-with-more-than-thirty-two-characters',
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
});
