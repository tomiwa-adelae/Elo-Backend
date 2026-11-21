import { Injectable, Logger } from '@nestjs/common';
import Mailjet from 'node-mailjet';
import {
  forgotPasswordEmail,
  passwordChangedEmail,
  verifyEmail,
  welcomeEmail,
} from './templates';

export interface SendMailArgs {
  to: string;
  subject: string;
  html: string;
  toName?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: Mailjet | null;

  constructor() {
    const publicKey = process.env.MAILJET_API_PUBLIC_KEY;
    const privateKey = process.env.MAILJET_API_PRIVATE_KEY;

    // Missing keys are a config problem, not a crash. In development we log
    // the mail instead of sending it so signup flows stay testable offline.
    if (!publicKey || !privateKey) {
      this.logger.warn(
        'MAILJET keys are not configured — emails will be logged, not sent.',
      );
      this.client = null;
      return;
    }

    this.client = new Mailjet({ apiKey: publicKey, apiSecret: privateKey });
  }

  async send({ to, subject, html, toName }: SendMailArgs): Promise<void> {
    if (!this.client) {
      this.logger.log(`[mail suppressed] to=${to} subject="${subject}"`);
      return;
    }

    try {
      await this.client.post('send', { version: 'v3.1' }).request({
        Messages: [
          {
            From: {
              Email: process.env.SENDER_EMAIL_ADDRESS,
              Name: process.env.STORE_NAME ?? 'The Store',
            },
            To: [{ Email: to, Name: toName ?? to }],
            Subject: subject,
            HTMLPart: html,
          },
        ],
      });
    } catch (error) {
      // A failed welcome email must never fail the registration that triggered
      // it. Log and move on — the user can request a resend.
      this.logger.error(
        `Failed to send "${subject}" to ${to}: ${(error as Error).message}`,
      );
    }
  }

  async sendWelcome(to: string, firstName?: string | null) {
    const { subject, html } = welcomeEmail(firstName);
    await this.send({ to, subject, html, toName: firstName ?? undefined });
  }

  async sendVerificationCode(to: string, code: string) {
    const { subject, html } = verifyEmail(code);
    await this.send({ to, subject, html });
  }

  async sendPasswordResetCode(to: string, code: string) {
    const { subject, html } = forgotPasswordEmail(code);
    await this.send({ to, subject, html });
  }

  async sendPasswordChanged(to: string) {
    const { subject, html } = passwordChangedEmail();
    await this.send({ to, subject, html });
  }
}
