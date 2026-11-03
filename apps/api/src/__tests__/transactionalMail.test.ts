import { describe, it, expect } from 'vitest';
import {
  sendResetMail,
  sendInviteMail,
  MailNotConfiguredError,
  type TransactionalDeps,
} from '../lib/mail/transactional';
import type { OutboundMail } from '../lib/mail/transport';

function recorder(): { deps: TransactionalDeps; sent: OutboundMail[] } {
  const sent: OutboundMail[] = [];
  const deps: TransactionalDeps = {
    transport: {
      async send(message) {
        sent.push(message);
        return { messageId: message.messageId };
      },
    },
    from: 'no_reply@platform.test',
    publicOrigin: 'http://localhost:3061',
  };
  return { deps, sent };
}

describe('transactional mail', () => {
  it('puts the reset link in the fragment, never the query', async () => {
    const { deps, sent } = recorder();
    await sendResetMail(deps, {
      to: 'jo@alfa.test',
      companyName: 'Alpha Sheds',
      companyCode: 'ALFA',
      username: 'jo',
      token: 'tok_abc123',
    });

    expect(sent).toHaveLength(1);
    const mail = sent[0] as OutboundMail;
    expect(mail.to).toBe('jo@alfa.test');
    expect(mail.text).toContain('http://localhost:3061/reset#token=tok_abc123');
    expect(mail.text).not.toContain('?token=');
  });

  it('tells a person their company code and username, so a forgotten login is recoverable', async () => {
    const { deps, sent } = recorder();
    await sendResetMail(deps, {
      to: 'jo@alfa.test',
      companyName: 'Alpha Sheds',
      companyCode: 'ALFA',
      username: 'jo',
      token: 'tok_abc123',
    });

    const text = (sent[0] as OutboundMail).text;
    expect(text).toContain('ALFA');
    expect(text).toContain('jo');
  });

  it('invites with the role named and a different path', async () => {
    const { deps, sent } = recorder();
    await sendInviteMail(deps, {
      to: 'new@alfa.test',
      companyName: 'Alpha Sheds',
      companyCode: 'ALFA',
      username: 'newperson',
      role: 'estimator',
      token: 'tok_join1',
    });

    const mail = sent[0] as OutboundMail;
    expect(mail.text).toContain('http://localhost:3061/join#token=tok_join1');
    expect(mail.text).toContain('estimator');
  });

  it('refuses to build a message when mail is not configured', async () => {
    const { deps } = recorder();
    await expect(
      sendResetMail({ ...deps, from: '' }, {
        to: 'jo@alfa.test',
        companyName: 'Alpha Sheds',
        companyCode: 'ALFA',
        username: 'jo',
        token: 'tok_abc123',
      }),
    ).rejects.toBeInstanceOf(MailNotConfiguredError);
  });
});
