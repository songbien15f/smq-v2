/**
 * The mail transport boundary.
 *
 * One interface, so the job queue can be tested without a mail server and the
 * production sender can be swapped without touching the queue. A transport's only
 * job is to hand a message to SMTP and report the server's answer.
 */

/** A message the queue has already decided to send. */
export interface OutboundMail {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  text: string;
  /**
   * The rendered PDF for the exact revision, as an attachment.
   *
   * Optional because not every message carries a document: an enquiry from the
   * contact form is plain text, and a required field would force it to send an
   * empty file that a mail client shows as a broken attachment.
   */
  attachment?: { filename: string; content: Buffer };
  /** Stable per send attempt, so a duplicate is diagnosable. */
  messageId: string;
}

/** What the server said. */
export interface SendResult {
  messageId: string;
}

export interface MailTransport {
  send(message: OutboundMail): Promise<SendResult>;
}
