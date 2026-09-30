import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Machine-readable template id, useful in tests and logs (never contains secrets). */
  template: string;
}

/**
 * Email adapter. `smtp` sends through a real SMTP server (Mailpit in local dev, provider in prod).
 * `memory` is a development/test-only sink that stores messages in-process and says so — it never
 * reports "sent". Production config validation forbids `memory`.
 */
@Injectable()
export class MailService {
  private transporter: Transporter | null = null;
  readonly sent: MailMessage[] = [];

  private getTransport(): Transporter | null {
    const c = config();
    if (c.MAIL_TRANSPORT !== 'smtp') return null;
    if (!this.transporter) this.transporter = nodemailer.createTransport(c.SMTP_URL!);
    return this.transporter;
  }

  /** Returns true only when the SMTP server accepted the message. */
  async send(msg: MailMessage): Promise<boolean> {
    const t = this.getTransport();
    if (!t) {
      this.sent.push(msg);
      logger.warn({ template: msg.template }, 'email NOT sent: MAIL_TRANSPORT=memory (development only)');
      return false;
    }
    try {
      await t.sendMail({ from: config().MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
      return true;
    } catch (e) {
      logger.error({ template: msg.template, err: (e as Error).message }, 'email send failed');
      return false;
    }
  }

  /** Test helper: last message to an address matching a template. */
  last(to: string, template?: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && (!template || m.template === template));
  }
}
