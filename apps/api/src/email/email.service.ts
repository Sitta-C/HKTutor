import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

import { AuthConfigService } from '@/config/auth.config';

@Injectable()
export class EmailService {
  private readonly resend: Resend;

  constructor(private readonly config: AuthConfigService) {
    this.resend = new Resend(config.resendApiKey);
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = new URL('/register/verify', this.config.appUrl);
    verificationUrl.searchParams.set('token', token);
    const url = verificationUrl.toString();
    const minutes = this.config.verificationTtlMinutes;

    const { error } = await this.resend.emails.send({
      from: this.config.emailFrom,
      to: email,
      subject: 'Verify your HKTutor email',
      text: `Verify your HKTutor email by opening this link: ${url}\n\nThis link expires in ${minutes} minutes. If you did not create this account, ignore this email.`,
      html: `
        <main style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#171714">
          <h1 style="font-size:24px">Verify your HKTutor email</h1>
          <p>Confirm your email address to finish creating your account.</p>
          <p style="margin:28px 0">
            <a href="${url}" style="background:#ffc57d;color:#171714;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a>
          </p>
          <p>This link expires in ${minutes} minutes.</p>
          <p style="color:#77736b;font-size:13px">If you did not create this account, you can ignore this email.</p>
        </main>
      `,
    });

    if (error) {
      throw new ServiceUnavailableException('Verification email could not be sent');
    }
  }
}
