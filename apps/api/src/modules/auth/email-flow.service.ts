import { createHmac, randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

import { AuthConfigService } from '@config/auth.config';

export const EMAIL_RESEND_WAIT_SECONDS = 60;
export const EMAIL_FLOW_TTL_SECONDS = 86_400;
export type EmailFlowPurpose = 'verification' | 'password-reset';

export interface EmailFlow {
  id: string;
  email: string;
  purpose: EmailFlowPurpose;
  resendAvailableAt: string;
  retryAfterSeconds: number;
}

export interface SignedEmailFlow {
  cookie: string;
  flow: EmailFlow;
}

@Injectable()
export class EmailFlowService {
  constructor(private readonly config: AuthConfigService) {}

  create(email: string, purpose: EmailFlowPurpose, id: string = randomUUID()): SignedEmailFlow {
    const resendAt = Date.now() + EMAIL_RESEND_WAIT_SECONDS * 1000;
    const cookie = jwt.sign({ email, purpose, resendAt, type: 'email-flow' }, this.secret, {
      algorithm: 'HS256',
      audience: `${this.config.audience}:email-flow`,
      issuer: this.config.issuer,
      subject: id,
      expiresIn: EMAIL_FLOW_TTL_SECONDS,
    });
    return { cookie, flow: this.describe(id, email, purpose, resendAt) };
  }

  read(cookie: string | undefined, purpose: EmailFlowPurpose): EmailFlow {
    try {
      if (!cookie) {
        throw new Error('Missing flow');
      }
      const payload = jwt.verify(cookie, this.secret, {
        algorithms: ['HS256'],
        audience: `${this.config.audience}:email-flow`,
        issuer: this.config.issuer,
      });
      if (
        typeof payload === 'string' ||
        payload['type'] !== 'email-flow' ||
        payload['purpose'] !== purpose ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload['email'] !== 'string' ||
        !payload['email'] ||
        typeof payload['resendAt'] !== 'number' ||
        !Number.isSafeInteger(payload['resendAt']) ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid flow');
      }
      return this.describe(payload.sub, payload['email'], purpose, payload['resendAt']);
    } catch {
      throw new BadRequestException('Email request has expired. Start again.');
    }
  }

  private describe(
    id: string,
    email: string,
    purpose: EmailFlowPurpose,
    resendAt: number,
  ): EmailFlow {
    return {
      id,
      email,
      purpose,
      resendAvailableAt: new Date(resendAt).toISOString(),
      retryAfterSeconds: Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)),
    };
  }

  private get secret(): string {
    return createHmac('sha256', this.config.accessSecret)
      .update('hktutor-email-flow')
      .digest('hex');
  }
}

export function emailFlowCookieName(purpose: EmailFlowPurpose): string {
  return purpose === 'verification' ? 'hktutor_verification_flow' : 'hktutor_password_reset_flow';
}
