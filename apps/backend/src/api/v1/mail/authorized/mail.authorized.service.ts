import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailAuthorizedService {
  constructor(private readonly mailerService: MailerService) {}

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Reset your password',
      html: `
        <p>You requested a password reset.</p>
        <p>Click the link below to reset your password. This link expires in 15 minutes.</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  }
}
