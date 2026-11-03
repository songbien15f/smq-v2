/**
 * Sending mail through SMTP2GO, over plain SMTP.
 *
 * SMTP2GO is reached as an ordinary authenticated SMTP server rather than through
 * a provider SDK: fewer dependencies, and the same code works with any other
 * relay. Credentials come from the environment and are never stored in a settings
 * file, which is copied between machines and hand-edited.
 *
 * The From address is **platform-controlled**. A tenant supplies a Reply-To, not a
 * From: sending as an address the platform has not verified is how a mail domain
 * gets blacklisted, and it lets one tenant impersonate another.
 *
 * TLS is required in production. Port 587 uses STARTTLS; port 465 uses implicit
 * TLS. A configuration that would send a quote in clear text is refused rather
 * than warned about.
 */

import type { MailTransport, OutboundMail, SendResult } from './transport';

/**
 * Read a setting, accepting this project's name and the upstream project's legacy name.
 *
 * The upstream mail layer called every key `SMTP2GO_*`. Both are read so an existing deployment's
 * environment keeps working unchanged, and this project's plain name wins when both are set — a
 * deployment that has moved on should not be silently overridden by a leftover variable.
 */
function setting(
  env: NodeJS.ProcessEnv,
  plain: string,
  legacy: string,
  fallback?: string,
): string | undefined {
  const value = env[plain] ?? env[legacy];
  return value === undefined || value.trim() === '' ? fallback : value;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  requireTls: boolean;
}

/** Read the configuration, or explain what is missing. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = setting(env, 'SMTP_HOST', 'SMTP2GO_HOST', 'mail.smtp2go.com') as string;
  const rawPort = setting(env, 'SMTP_PORT', 'SMTP2GO_PORT', '587');
  const port = Number(rawPort);
  const user = setting(env, 'SMTP_USER', 'SMTP2GO_USER');
  const pass = setting(env, 'SMTP_PASS', 'SMTP2GO_PASS');

  if (user === undefined || pass === undefined) {
    throw new Error('Mail is not configured: set SMTP_USER and SMTP_PASS in the environment');
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT is not a port: ${rawPort}`);
  }

  const production = (env.NODE_ENV ?? 'development') === 'production';
  if (production && port === 25) {
    throw new Error('Port 25 sends mail in clear text; use 587 with STARTTLS or 465');
  }

  return {
    host,
    port,
    user,
    pass,
    // Implicit TLS on 465; STARTTLS required everywhere else in production.
    secure: port === 465,
    requireTls: port !== 465,
  };
}

/**
 * True when mail can be sent at all, so the UI can disable a button honestly.
 *
 * Credentials are not enough. A server with `SMTP_USER`/`SMTP_PASS` and no `MAIL_FROM` can open a
 * connection and has no address to send **from**, so every message is refused — and a reset form
 * that believed otherwise told the person "we have sent them a link" while nothing was sent.
 */
export function mailIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const from = env.MAIL_FROM;
  if (from === undefined || from.trim() === '') return false;
  try {
    smtpConfigFromEnv(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * How long to wait at each SMTP stage.
 *
 * Nodemailer's defaults are **no timeout at all**: a relay that accepts the
 * connection and then stops talking leaves `sendMail` pending forever. This send
 * runs inline in an HTTP request — deliberately, so the operator gets a real
 * answer — so "forever" means the reverse proxy gives up first and the operator
 * sees a 502 from the proxy instead of the mail server's refusal. That is the
 * failure these numbers bound.
 *
 * They are chosen against a proxy's typical 30–60 s ceiling: a handshake plus a
 * 3 MB attachment fits comfortably inside it, while a relay that has gone quiet
 * is abandoned well before the proxy loses patience.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 20_000;

/** A transport backed by a real SMTP connection. */
export function createSmtpTransport(config: SmtpConfig): MailTransport {
  return {
    async send(message: OutboundMail): Promise<SendResult> {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTls,
        auth: { user: config.user, pass: config.pass },
        // Without these, a stalled relay hangs the request until the proxy cuts
        // it, and the operator never learns what the mail server said.
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      });

      try {
        const info = await transport.sendMail({
          from: message.from,
          replyTo: message.replyTo,
          to: message.to,
          subject: message.subject,
          text: message.text,
          messageId: message.messageId,
          // No attachment is a message without one, not an empty one: a mail
          // client shows a zero-byte attachment as a broken file.
          attachments:
            message.attachment === undefined
              ? []
              : [
                  {
                    filename: message.attachment.filename,
                    content: message.attachment.content,
                    contentType: 'application/pdf',
                  },
                ],
        });
        return { messageId: info.messageId ?? message.messageId };
      } finally {
        transport.close();
      }
    },
  };
}
