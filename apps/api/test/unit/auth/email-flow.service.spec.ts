import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import { AuthConfigService } from '@config/auth.config';
import { Role } from '@generated/prisma/client';
import { EmailFlowService } from '@modules/auth/email-flow.service';
import { JwtTokenService } from '@modules/auth/jwt.service';

const SECRET = 'test-email-flow-secret-with-more-than-thirty-two-characters';
const config = new AuthConfigService(new ConfigService({ JWT_ACCESS_SECRET: SECRET }));
const flows = new EmailFlowService(config);
const tokens = new JwtTokenService(config);

describe('signed email flow', () => {
  it('uses credentials distinct from access authentication in both directions', () => {
    const signed = flows.create('original@example.com', 'verification');
    expect(tokens.verifyAccessToken(signed.cookie)).toBeNull();
    const access = tokens.signAccessToken('user-id', 'session-id', Role.STUDENT);
    expect(() => flows.read(access, 'verification')).toThrow('Email request has expired');
  });

  it.each([
    {
      algorithm: 'HS384' as const,
      issuer: config.issuer,
      audience: `${config.audience}:email-flow`,
      type: 'email-flow',
      expiresIn: 3600,
    },
    {
      algorithm: 'HS256' as const,
      issuer: 'another-api',
      audience: `${config.audience}:email-flow`,
      type: 'email-flow',
      expiresIn: 3600,
    },
    {
      algorithm: 'HS256' as const,
      issuer: config.issuer,
      audience: 'another-client',
      type: 'email-flow',
      expiresIn: 3600,
    },
    {
      algorithm: 'HS256' as const,
      issuer: config.issuer,
      audience: `${config.audience}:email-flow`,
      type: 'access',
      expiresIn: 3600,
    },
    {
      algorithm: 'HS256' as const,
      issuer: config.issuer,
      audience: `${config.audience}:email-flow`,
      type: 'email-flow',
      expiresIn: -1,
    },
  ])('rejects invalid signed claim variant %#', (options) => {
    const key = createHmac('sha256', SECRET).update('hktutor-email-flow').digest('hex');
    const cookie = jwt.sign(
      {
        email: 'original@example.com',
        purpose: 'verification',
        resendAt: Date.now(),
        type: options.type,
      },
      key,
      {
        subject: 'flow-id',
        algorithm: options.algorithm,
        issuer: options.issuer,
        audience: options.audience,
        expiresIn: options.expiresIn,
      },
    );
    expect(() => flows.read(cookie, 'verification')).toThrow('Email request has expired');
  });
});
