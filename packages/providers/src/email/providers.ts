import nodemailer, { type Transporter } from 'nodemailer';
import { healthy, unhealthy, type EmailMessage, type EmailProvider, type HealthResult } from '../types.js';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Development transport: writes the message to stdout, never sends anything. */
export class LogEmailProvider implements EmailProvider {
  readonly key = 'log';

  async send(message: EmailMessage): Promise<void> {
    process.stdout.write(
      [
        '--- email (log driver) ---',
        `to: ${message.to}`,
        `subject: ${message.subject}`,
        message.text,
        '--------------------------',
        '',
      ].join('\n'),
    );
  }

  async healthCheck(): Promise<HealthResult> {
    return healthy('Log driver - emails are printed, not sent.');
  }
}

/** SMTP transport. Points at Mailpit locally and a real relay in production. */
export class SmtpEmailProvider implements EmailProvider {
  readonly key = 'smtp';
  private readonly settings: SmtpSettings;
  private transporter: Transporter | null = null;

  constructor(settings: SmtpSettings) {
    this.settings = settings;
  }

  private transport(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.settings.host,
      port: this.settings.port,
      secure: this.settings.secure,
      ...(this.settings.user
        ? { auth: { user: this.settings.user, pass: this.settings.password ?? '' } }
        : {}),
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport().sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await this.transport().verify();
      return healthy(`SMTP ${this.settings.host}:${this.settings.port} reachable.`);
    } catch (error) {
      return unhealthy(`SMTP unreachable: ${(error as Error).message}`);
    }
  }
}
