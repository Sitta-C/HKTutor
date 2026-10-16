import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';

import { AuthConfigService } from '@config/auth.config';

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
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = new URL('/reset-password', this.config.appUrl);
    resetUrl.searchParams.set('token', token);
    const url = resetUrl.toString();
    const minutes = this.config.passwordResetTtlMinutes;
    const { error } = await this.resend.emails.send({
      from: this.config.emailFrom,
      to: email,
      subject: 'Reset your HKTutor password / ตั้งรหัสผ่าน HKTutor ใหม่',
      text: `Reset your HKTutor password: ${url}\n\nThis link expires in ${minutes} minutes and can only be used once. If you did not request this, ignore this email.\n\nตั้งรหัสผ่าน HKTutor ใหม่ผ่านลิงก์ด้านบน ลิงก์มีอายุ ${minutes} นาทีและใช้ได้ครั้งเดียว หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้`,
      html: `
        <main style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#171714">
          <h1>Reset your HKTutor password</h1>
          <p>ตั้งรหัสผ่าน HKTutor ใหม่</p>
          <p><a href="${url}">Reset password / ตั้งรหัสผ่านใหม่</a></p>
          <p>This link expires in ${minutes} minutes and can only be used once.</p>
          <p>ลิงก์มีอายุ ${minutes} นาทีและใช้ได้ครั้งเดียว</p>
          <p>If you did not request this, ignore this email. Your password has not changed.</p>
          <p>หากคุณไม่ได้ร้องขอ สามารถละเว้นอีเมลนี้ได้ รหัสผ่านของคุณยังไม่เปลี่ยนแปลง</p>
        </main>
      `,
    });
    if (error) {
      throw new ServiceUnavailableException('Password reset email could not be sent');
    }
  }
}
