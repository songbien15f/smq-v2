# Password reset, member invite and platform logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a person who has forgotten their password a way back in, give a company administrator a way to add and re-admit staff, and put the platform's logo on the documents and the app.

**Architecture:** Both password flows share one mechanism — a single-use token stored hashed in the already-present `invitations` table, mailed inline through the existing SMTP transport, redeemed at a public page that posts to the API. The logo is one committed asset read through a pure loader in `packages/core`, embedded in the document as a data URI and frozen per revision by content hash.

**Tech Stack:** TypeScript 5.9 · Fastify 5 · Next.js 16 App Router · React 19 · Tailwind 4 · zod 4 · vitest 5 · `node:crypto` scrypt (passwords) and sha256 (tokens) · `node:fs` for the logo asset.

**Spec:** `docs/superpowers/specs/2026-11-03-password-reset-invite-and-logo-design.md`

## Global Constraints

- **No new dependency.** Passwords already use `scrypt` from `node:crypto`; tokens use `createHash`/`randomBytes`. MIME detection is magic bytes, not a library.
- **A token is never stored in plaintext.** Every row keeps `sha256(token)` only, via `hashToken` from `apps/api/src/lib/tokens.ts`.
- **A token never travels in a query string.** It goes in the URL fragment (`#token=…`), read with `window.location.hash`, so it reaches neither the proxy log nor a `Referer` header. This is how `/s` already works.
- **Never claim a mail was sent when it was not.** When SMTP is unconfigured the route answers `503 not_configured` with a sentence; it never answers `200`.
- **The reset request is a non-oracle.** Unknown code, unknown email, removed member, disabled account and suspended company all answer the same status and the same sentence.
- **The SVG format is refused everywhere.** PNG/JPEG/WebP only, decided by magic bytes — never by the filename extension.
- **`packages/core` imports no database, no HTTP, no tenant.** The logo loader takes a filesystem path and returns a value.
- **A saved revision renders the logo it was saved with.** `logoHash` is frozen into `FrozenCompany`; a missing file falls back to `logoText`, never to a newer logo.
- Password floor is `PASSWORD_MIN_LENGTH` = 12 (already exported by `@sq/contracts`).
- Migrations are portable-file-first: anything driver-specific goes in `migrations/sqlite/<n>_*.sql` or `migrations/pg/<n>_*.sql`. **This plan adds no migration** — `invitations` and `memberships.status` are already in `001_init.sql`.

## Review Focus

1. **A reset link forwarded to a colleague.** The link grants the password change, not a session for the person who requested it. Expected: the colleague can set the password and is signed in as that account. This is inherent to bearer tokens and must be documented, not silently accepted.
2. **Requesting a reset for an account at a company the requester does not work for.** Expected: the same generic answer, and **no mail sent** — a stranger must not be able to trigger mail to another company's staff at will.
3. **The invitation email address already belongs to a person at another company.** `users.email` is globally unique. Expected: reuse that user row and add a membership — never a second user, never a duplicate key error leaking another company's existence.
4. **A logo file swapped for a different image under the same path.** Expected: revisions saved with the old `logoHash` print `logoText` (honest), and new revisions use the new logo. Never a stale-byte render.
5. **A 5 MB "PNG" uploaded as `LOGO_FILE`.** Expected: logo silently absent, document renders the text fallback, no 500 and no stack trace in the reply.

---

### Task 1: The invitation service — create, resolve, and spend

**Files:**
- Create: `apps/api/src/lib/invitations.ts`
- Test: `apps/api/src/__tests__/invitations.test.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken` from `../lib/tokens.js`; `newId`, `now` from `@sq/db`; `Db` from `@sq/db`.
- Produces:
  - `type InvitationKind = 'reset' | 'member'`
  - `interface CreatedInvitation { id: string; token: string; expiresAt: string }`
  - `createInvitation(db, input: { tenantId: string; email: string; role: string; kind: InvitationKind; invitedBy: string | null; ttlMs: number }): Promise<CreatedInvitation>` — returns the **plaintext** token once; the row holds the hash.
  - `RESET_TTL_MS = 60 * 60 * 1000`, `INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`
  - `interface ResolvedInvitation { id: string; tenantId: string | null; email: string; role: string; kind: InvitationKind; userId: string }`
  - `resolveInvitation(db, input: { token: string; kind: InvitationKind }): Promise<ResolvedInvitation | null>` — null for unknown, revoked, spent, expired or wrong-kind.
  - `spendInvitation(db, invitationId: string): Promise<void>` — sets `accepted_at`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { now } from '@sq/db';
import { makeTestApp, seedCompany, type TestApp } from './helpers';
import {
  createInvitation,
  resolveInvitation,
  spendInvitation,
  RESET_TTL_MS,
} from '../lib/invitations';

let ctx: TestApp;
let company: { tenantId: string; userId: string; code: string; username: string };

beforeAll(async () => {
  ctx = await makeTestApp();
  company = await seedCompany(ctx.db, {
    name: 'Invite Sheds',
    slug: 'invite-sheds',
    code: 'INVSHED',
    username: 'owner',
    email: 'owner@invite.test',
    password: 'a-long-enough-password',
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('the invitation service', () => {
  it('stores only the hash of the token it hands back', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    // The plaintext token is in the return value and nowhere in the row.
    expect(created.token.length).toBeGreaterThan(20);
    const row = await ctx.db.get<{ token_hash: string }>(
      'SELECT token_hash FROM invitations WHERE id = ?',
      [created.id],
    );
    expect(row?.token_hash).not.toBe(created.token);
    expect(row?.token_hash).toHaveLength(64);
  });

  it('resolves a live reset token to the person it was made for', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    const resolved = await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' });
    expect(resolved?.userId).toBe(company.userId);
    expect(resolved?.tenantId).toBe(company.tenantId);
  });

  it('refuses a token presented for the other kind', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'estimator',
      kind: 'member',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses a spent token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    await spendInvitation(ctx.db, created.id);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses an expired token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: 1,
    });

    // Move the expiry into the past rather than sleeping for a millisecond.
    await ctx.db.run('UPDATE invitations SET expires_at = ? WHERE id = ?', [now(), created.id]);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });

  it('refuses a revoked token', async () => {
    const created = await createInvitation(ctx.db, {
      tenantId: company.tenantId,
      email: 'owner@invite.test',
      role: 'company_admin',
      kind: 'reset',
      invitedBy: null,
      ttlMs: RESET_TTL_MS,
    });

    await ctx.db.run('UPDATE invitations SET revoked_at = ? WHERE id = ?', [now(), created.id]);
    expect(await resolveInvitation(ctx.db, { token: created.token, kind: 'reset' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/invitations.test.ts`
Expected: FAIL — `Cannot find module '../lib/invitations'`.

- [ ] **Step 3: Implement `apps/api/src/lib/invitations.ts`**

Signature: `createInvitation`, `resolveInvitation`, `spendInvitation`, plus the two `TTL` constants and the two interfaces, exactly as in the Interfaces block.

Two decisions the signature does not fix:
- `createInvitation` inserts `invitations (id, token_hash, tenant_id, email, role, kind, invited_by, created_at, expires_at)` with `accepted_at`/`revoked_at` left null, and returns `{ id, token, expiresAt }`.
- `resolveInvitation` joins `users` on `lower(users.email) = lower(invitations.email)` to get `userId`, and returns `null` when no user matches — a reset token for an address with no account is unusable, and reporting it as a distinct failure would be an oracle.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/invitations.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/invitations.ts apps/api/src/__tests__/invitations.test.ts
git commit -m "feat(api): single-use invitation tokens for reset and invite"
```

---

### Task 2: Mail for a non-quote message — inline, and never a false claim

**Files:**
- Create: `apps/api/src/lib/mail/transactional.ts`
- Test: `apps/api/src/__tests__/transactionalMail.test.ts`

**Interfaces:**
- Consumes: `MailTransport`, `OutboundMail` from `./transport.js`; `smtpConfigFromEnv`, `mailIsConfigured`, `createSmtpTransport` from `./smtp.js`.
- Produces:
  - `interface TransactionalDeps { transport: MailTransport; from: string; publicOrigin: string }`
  - `sendResetMail(deps, input: { to: string; companyName: string; companyCode: string; username: string; token: string }): Promise<void>`
  - `sendInviteMail(deps, input: { to: string; companyName: string; companyCode: string; username: string; role: string; token: string }): Promise<void>`
  - `MailNotConfiguredError` — thrown when the environment has no SMTP credentials.
  - Both senders build `OutboundMail` with `subject`, `text`, a stable `messageId`, and **no attachment**.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sendResetMail, sendInviteMail, MailNotConfiguredError, type TransactionalDeps } from '../lib/mail/transactional';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/transactionalMail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/lib/mail/transactional.ts`**

Signature as in the Interfaces block. Content decisions the signature does not fix:
- `MailNotConfiguredError` is thrown when `deps.from.trim() === ''`. Detection of "SMTP is configured" belongs to the caller (`mailIsConfigured(process.env)`), which turns it into a `503`; this module's job is to refuse to build a message with no sender.
- `messageId` is `${kind}-${Date.now()}-${randomUUID()}` so a duplicate is diagnosable in the relay log.
- Body text names the company, the **company code** and the **username** — the reason for both is spec §2.5.
- `replyTo` is the platform `from`; a tenant does not own a reset mail.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/transactionalMail.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mail/transactional.ts apps/api/src/__tests__/transactionalMail.test.ts
git commit -m "feat(mail): reset and invite messages, sent inline"
```

---

### Task 3: `POST /auth/reset/request` — public, rate-limited, and a non-oracle

**Files:**
- Modify: `packages/contracts/src/auth.ts` (add two request schemas and one response type)
- Modify: `apps/api/src/routes/auth.ts` (import the schemas; add the route)
- Modify: `apps/api/src/app.ts:96` (pass transactional deps into `registerAuth`)
- Modify: `apps/client/src/app/api/sq/[...path]/route.ts` (allow `auth/reset`)
- Test: `apps/api/src/__tests__/reset.test.ts`

**Interfaces:**
- Consumes: `createInvitation`, `RESET_TTL_MS` from Task 1; `sendResetMail`, `MailNotConfiguredError`, `TransactionalDeps` from Task 2; `rateLimit.consume`, `hashIp`, `hashToken`, `burnVerificationTime`.
- Produces:
  - `resetRequestRequest = z.object({ companyCode: z.string().trim().min(1).max(16), email: z.string().trim().toLowerCase().email() })`
  - `resetRequestResponse: { sent: true }`
  - `registerAuth(app, db, config, mail: TransactionalDeps | null)` — the fourth parameter is `null` when SMTP is unconfigured; the route then answers `503 not_configured`.
  - Route `POST /auth/reset/request` → `200 { sent: true }` | `429` | `503`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, seedCompany, testConfig } from './helpers';
import type { OutboundMail } from '../lib/mail/transport';

/** A test app whose mail transport records instead of sending. */
async function appWithMail() {
  const sent: OutboundMail[] = [];
  const ctx = await makeTestApp(testConfig(), {
    transport: { async send(m) { sent.push(m); return { messageId: m.messageId }; } },
    from: 'no_reply@platform.test',
    publicOrigin: 'http://localhost:3061',
  });
  return { ctx, sent };
}

describe('requesting a password reset', () => {
  it('answers the same sentence for a good code and a bad one', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Reset Sheds', slug: 'reset-sheds', code: 'RESETC', username: 'jo',
      email: 'jo@reset.test', password: 'a-long-enough-password',
    });

    const good = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'RESETC', email: 'jo@reset.test' },
    });
    const badCode = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'NOPE', email: 'jo@reset.test' },
    });
    const badEmail = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'RESETC', email: 'nobody@reset.test' },
    });

    expect(good.statusCode).toBe(200);
    expect(badCode.statusCode).toBe(good.statusCode);
    expect(badEmail.statusCode).toBe(good.statusCode);
    expect(badCode.json().data).toEqual(good.json().data);
    expect(badEmail.json().data).toEqual(good.json().data);
    await ctx.close();
  });

  it('sends mail only when the code and the address both resolve', async () => {
    const { ctx, sent } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Mail Sheds', slug: 'mail-sheds', code: 'MAILSHED', username: 'jo',
      email: 'jo@mail.test', password: 'a-long-enough-password',
    });

    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'MAILSHED', email: 'jo@mail.test' },
    });
    expect(sent).toHaveLength(1);

    // A stranger must not be able to trigger mail to another company's staff.
    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'WRONG', email: 'jo@mail.test' },
    });
    expect(sent).toHaveLength(1);
    await ctx.close();
  });

  it('writes a reset invitation that a confirm step can spend', async () => {
    const { ctx } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Row Sheds', slug: 'row-sheds', code: 'ROWX', username: 'jo',
      email: 'jo@row.test', password: 'a-long-enough-password',
    });

    await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'ROWX', email: 'jo@row.test' },
    });

    const row = await ctx.db.get<{ kind: string; email: string }>(
      "SELECT kind, email FROM invitations WHERE tenant_id = ? AND kind = 'reset'",
      [company.tenantId],
    );
    expect(row?.email).toBe('jo@row.test');
    await ctx.close();
  });

  it('answers 503 rather than pretending to send when mail is unconfigured', async () => {
    const ctx = await makeTestApp(testConfig(), null);
    await seedCompany(ctx.db, {
      name: 'No Mail', slug: 'no-mail', code: 'NOMAIL', username: 'jo',
      email: 'jo@nomail.test', password: 'a-long-enough-password',
    });

    const response = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/reset/request',
      payload: { companyCode: 'NOMAIL', email: 'jo@nomail.test' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('not_configured');
    await ctx.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/reset.test.ts`
Expected: FAIL — `makeTestApp` takes one argument, and `/auth/reset/request` answers 404.

- [ ] **Step 3: Thread the mail dependency through, then add the route**

`makeTestApp` gains an optional second parameter `mail: TransactionalDeps | null = null` and passes it to `buildApp`. `buildApp`'s options gain `mail` and hand it to `registerAuth`. `app.ts` builds the real value: `mailIsConfigured() ? { transport: createSmtpTransport(smtpConfigFromEnv()), from: process.env.MAIL_FROM ?? '', publicOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3061' } : null`.

The route: parse `resetRequestRequest`; `rateLimit.consume(db, \`reset:acct:${hashToken(`${code}:${email}`)}\`, 5, 15*60*1000)` and `reset:ip:${hashIp(ip)}` at 15; resolve `tenants.code` + `users.email` + `memberships.status='active'`; **if `mail === null` return 503 before the lookup**, because "mail is broken" is a fact about the server, not about the caller; if the lookup misses, return the same `200 { sent: true }`; if it hits, `createInvitation` with `kind: 'reset'` and `ttlMs: RESET_TTL_MS`, then `sendResetMail`, then `200 { sent: true }`.

The sentence is fixed and shared: *"If that email belongs to a person at that company, we have sent them a link to choose a new password."*

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/reset.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/auth.ts apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/src/__tests__/helpers.ts apps/api/src/__tests__/reset.test.ts apps/client/src/app/api/sq/\[...path\]/route.ts
git commit -m "feat(auth): request a password reset without revealing who exists"
```

---

### Task 4: `POST /auth/reset/confirm` — spend the token, sign in, kill old sessions

**Files:**
- Modify: `packages/contracts/src/auth.ts` (add `resetConfirmRequest`)
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/src/__tests__/reset.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveInvitation`, `spendInvitation` from Task 1; `completeSignIn` (the existing closure in `registerAuth`); `createInvitation` for the test's token.
- Produces:
  - `resetConfirmRequest = z.object({ token: z.string().min(20).max(200), password: z.string().min(PASSWORD_MIN_LENGTH).max(200), confirmPassword: z.string() }).refine(b => b.password === b.confirmPassword, { path: ['confirmPassword'], message: 'The two passwords do not match' })`
  - Route `POST /auth/reset/confirm` → `200 SessionView` + cookie | `400 validation_failed`.

- [ ] **Step 1: Write the failing test**

```ts
it('spends a reset token, signs the person in, and kills every earlier session', async () => {
  const { ctx } = await appWithMail();
  const company = await seedCompany(ctx.db, {
    name: 'Confirm Sheds', slug: 'confirm-sheds', code: 'CONFIRM', username: 'jo',
    email: 'jo@confirm.test', password: 'a-long-enough-password',
  });

  // An existing session an attacker might be holding.
  const oldCookie = await signIn(ctx.app, 'CONFIRM', 'jo', 'a-long-enough-password');

  await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/reset/request',
    payload: { companyCode: 'CONFIRM', email: 'jo@confirm.test' },
  });
  const row = await ctx.db.get<{ token_hash: string }>(
    "SELECT token_hash FROM invitations WHERE tenant_id = ? AND kind = 'reset'",
    [company.tenantId],
  );

  // The test knows the token only by re-creating an invitation it controls.
  const fresh = await createInvitation(ctx.db, {
    tenantId: company.tenantId, email: 'jo@confirm.test', role: 'company_admin',
    kind: 'reset', invitedBy: null, ttlMs: RESET_TTL_MS,
  });
  expect(row?.token_hash).toHaveLength(64);

  const confirmed = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/reset/confirm',
    payload: { token: fresh.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
  });

  expect(confirmed.statusCode).toBe(200);
  expect(confirmed.json().data.currentTenantCode).toBe('CONFIRM');
  expect(confirmed.headers['set-cookie']).toBeDefined();

  // The old session is dead.
  const stale = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: oldCookie } });
  expect(stale.statusCode).toBe(401);

  // And the new password works.
  const ok = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/sign-in',
    payload: { companyCode: 'CONFIRM', username: 'jo', password: 'a-brand-new-password' },
  });
  expect(ok.statusCode).toBe(200);
  await ctx.close();
});

it('refuses the same token twice, with the same sentence as an unknown token', async () => {
  const { ctx } = await appWithMail();
  const company = await seedCompany(ctx.db, {
    name: 'Once Sheds', slug: 'once-sheds', code: 'ONCE', username: 'jo',
    email: 'jo@once.test', password: 'a-long-enough-password',
  });
  const created = await createInvitation(ctx.db, {
    tenantId: company.tenantId, email: 'jo@once.test', role: 'company_admin',
    kind: 'reset', invitedBy: null, ttlMs: RESET_TTL_MS,
  });

  const first = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/reset/confirm',
    payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
  });
  const second = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/reset/confirm',
    payload: { token: created.token, password: 'another-new-password', confirmPassword: 'another-new-password' },
  });
  const unknown = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/reset/confirm',
    payload: { token: 'x'.repeat(40), password: 'another-new-password', confirmPassword: 'another-new-password' },
  });

  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(400);
  expect(unknown.statusCode).toBe(400);
  // A used link and a made-up link are indistinguishable.
  expect(second.json().message).toBe(unknown.json().message);
  await ctx.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/reset.test.ts -t "spends a reset token"`
Expected: FAIL — 404, the confirm route does not exist.

- [ ] **Step 3: Implement the route**

Parse `resetConfirmRequest`; `resolveInvitation(db, { token: body.token, kind: 'reset' })`; on `null` answer `400 validation_failed` with *"That link is no longer valid. Ask for a new one."*; otherwise `hashPassword(body.password)`, `UPDATE users SET password_hash, must_change_password = 0, password_set_at, updated_at`, `revokeAllForUser(db, userId)` with **no** exception id (every session dies, including the one that might be the reason for the reset), `spendInvitation`, then `completeSignIn({ request, reply, userId, tenantId, perAccount: \`signin:acct:${hashToken(userId)}\` })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/reset.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/auth.ts apps/api/src/routes/auth.ts apps/api/src/__tests__/reset.test.ts
git commit -m "feat(auth): confirm a reset, sign in, and end every older session"
```

---

### Task 5: `POST /team/invite` and `POST /team/:email/reset`

**Files:**
- Modify: `packages/contracts/src/auth.ts` (`inviteRequest` gains `username`; add `inviteResponse`)
- Modify: `apps/api/src/routes/settings.ts`
- Modify: `apps/api/src/app.ts` (pass mail deps to `registerSettings`)
- Test: `apps/api/src/__tests__/team.test.ts` (create)

**Interfaces:**
- Consumes: `createInvitation`, `INVITE_TTL_MS`, `RESET_TTL_MS`, `sendInviteMail`, `sendResetMail`, `requireCompanyCapability`, `MailNotConfiguredError`.
- Produces:
  - `inviteRequest` becomes `z.object({ email, role: z.enum(COMPANY_ROLES), displayName, username: z.string().trim().min(1).max(80) })`
  - `POST /team/invite` → `201 { invited: true; email }` | `409` when already an active member | `503`
  - `POST /team/:email/reset` → `200 { sent: true }` | `404` for another company's member | `503`
  - `registerSettings(app, db, mail: TransactionalDeps | null)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, seedCompany, signIn, testConfig } from './helpers';
import type { OutboundMail } from '../lib/mail/transport';

async function appWithMail() {
  const sent: OutboundMail[] = [];
  const ctx = await makeTestApp(testConfig(), {
    transport: { async send(m) { sent.push(m); return { messageId: m.messageId }; } },
    from: 'no_reply@platform.test',
    publicOrigin: 'http://localhost:3061',
  });
  return { ctx, sent };
}

describe('inviting and re-admitting staff', () => {
  it('creates a pending membership the person cannot sign in with yet', async () => {
    const { ctx, sent } = await appWithMail();
    const company = await seedCompany(ctx.db, {
      name: 'Team Sheds', slug: 'team-sheds', code: 'TEAMS', username: 'owner',
      email: 'owner@team.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'TEAMS', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'new@team.test', role: 'estimator', displayName: 'New Person', username: 'newperson' },
    });

    expect(invited.statusCode).toBe(201);
    expect(sent).toHaveLength(1);

    const membership = await ctx.db.get<{ status: string }>(
      'SELECT m.status FROM memberships m WHERE m.tenant_id = ? AND m.user_id = (SELECT id FROM users WHERE email = ?)',
      [company.tenantId, 'new@team.test'],
    );
    expect(membership?.status).toBe('pending');

    // Pending does not sign in and does not hold a seat.
    const refused = await ctx.app.inject({
      method: 'POST', url: '/api/v1/auth/sign-in',
      payload: { companyCode: 'TEAMS', username: 'newperson', password: 'anything-at-all-here' },
    });
    expect(refused.statusCode).toBe(401);
    await ctx.close();
  });

  it('reuses an existing account from another company instead of creating a second user', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Other Co', slug: 'other-co', code: 'OTHERCO', username: 'jo',
      email: 'shared@both.test', password: 'a-long-enough-password',
    });
    await seedCompany(ctx.db, {
      name: 'Host Co', slug: 'host-co', code: 'HOSTCO', username: 'owner',
      email: 'owner@host.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'HOSTCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'shared@both.test', role: 'viewer', displayName: 'Shared', username: 'shared2' },
    });

    expect(invited.statusCode).toBe(201);
    const users = await ctx.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'shared@both.test'",
    );
    expect(Number(users[0]?.n)).toBe(1);
    await ctx.close();
  });

  it('refuses an invitation to someone already active in this company', async () => {
    const { ctx } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Dup Co', slug: 'dup-co', code: 'DUPCO', username: 'owner',
      email: 'owner@dup.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'DUPCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'owner@dup.test', role: 'estimator', displayName: 'Owner', username: 'owner2' },
    });
    expect(invited.statusCode).toBe(409);
    await ctx.close();
  });

  it('sends a reset for a member of this company and 404s for another company', async () => {
    const { ctx, sent } = await appWithMail();
    await seedCompany(ctx.db, {
      name: 'Mine', slug: 'mine', code: 'MINECO', username: 'owner',
      email: 'owner@mine.test', password: 'a-long-enough-password',
    });
    await seedCompany(ctx.db, {
      name: 'Theirs', slug: 'theirs', code: 'THEIRCO', username: 'owner',
      email: 'owner@theirs.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'MINECO', 'owner', 'a-long-enough-password');

    const mine = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/owner@mine.test/reset', headers: { cookie },
    });
    const theirs = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/owner@theirs.test/reset', headers: { cookie },
    });

    expect(mine.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    // Not 403: a 403 would confirm the other company's member exists.
    expect(theirs.statusCode).toBe(404);
    await ctx.close();
  });

  it('refuses an invitation when mail is not configured', async () => {
    const ctx = await makeTestApp(testConfig(), null);
    await seedCompany(ctx.db, {
      name: 'No Mail Co', slug: 'no-mail-co', code: 'NOMAILCO', username: 'owner',
      email: 'owner@nomailco.test', password: 'a-long-enough-password',
    });
    const cookie = await signIn(ctx.app, 'NOMAILCO', 'owner', 'a-long-enough-password');

    const invited = await ctx.app.inject({
      method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
      payload: { email: 'x@y.test', role: 'viewer', displayName: 'X', username: 'xperson' },
    });
    expect(invited.statusCode).toBe(503);
    await ctx.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/team.test.ts`
Expected: FAIL — `/api/v1/team/invite` answers 404.

- [ ] **Step 3: Implement both routes in `apps/api/src/routes/settings.ts`**

`POST /team/invite`: `requireCompanyCapability(..., 'members:manage')`; `mail === null` → `503`; parse `inviteRequest`; look for an existing **active** membership for that email in this tenant → `409` with *"That person is already in this company. Use Reset password if they cannot sign in."*; find or create the `users` row (**reuse when the email exists**, because `users.email` is globally unique); insert `memberships` with `status = 'pending'`, `username` from the body; `createInvitation` with `kind: 'member'`, `INVITE_TTL_MS`; `sendInviteMail`; answer `201`.

`POST /team/:email/reset`: `requireCompanyCapability(..., 'members:manage')`; `mail === null` → `503`; find the membership **in `session.tenantId`** — miss → `404 not_found`; `createInvitation` `kind: 'reset'`; `sendResetMail` with the person's `username` from their membership; `200 { sent: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/team.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/auth.ts apps/api/src/routes/settings.ts apps/api/src/app.ts apps/api/src/__tests__/team.test.ts
git commit -m "feat(team): invite a person and re-admit one who forgot a password"
```

---

### Task 6: `/join` — accept an invitation

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (add `POST /auth/join/confirm`)
- Modify: `packages/contracts/src/auth.ts` (add `joinConfirmRequest`)
- Test: `apps/api/src/__tests__/team.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveInvitation(..., kind: 'member')`, `spendInvitation`, `completeSignIn`, `hashPassword`.
- Produces:
  - `joinConfirmRequest = z.object({ token, password: min(PASSWORD_MIN_LENGTH), confirmPassword }).refine(equal)`
  - `POST /auth/join/confirm` → `200 SessionView` + cookie | `400 validation_failed`

- [ ] **Step 1: Write the failing test**

```ts
it('accepts a member invitation: pending becomes active and the person is signed in', async () => {
  const { ctx } = await appWithMail();
  const company = await seedCompany(ctx.db, {
    name: 'Join Sheds', slug: 'join-sheds', code: 'JOINS', username: 'owner',
    email: 'owner@join.test', password: 'a-long-enough-password',
  });
  const cookie = await signIn(ctx.app, 'JOINS', 'owner', 'a-long-enough-password');

  await ctx.app.inject({
    method: 'POST', url: '/api/v1/team/invite', headers: { cookie },
    payload: { email: 'joiner@join.test', role: 'estimator', displayName: 'Joiner', username: 'joiner' },
  });

  const created = await createInvitation(ctx.db, {
    tenantId: company.tenantId, email: 'joiner@join.test', role: 'estimator',
    kind: 'member', invitedBy: null, ttlMs: INVITE_TTL_MS,
  });

  const joined = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/join/confirm',
    payload: { token: created.token, password: 'a-brand-new-password', confirmPassword: 'a-brand-new-password' },
  });

  expect(joined.statusCode).toBe(200);
  expect(joined.json().data.currentTenantCode).toBe('JOINS');
  expect(joined.json().data.memberships[0].role).toBe('estimator');

  const membership = await ctx.db.get<{ status: string }>(
    'SELECT status FROM memberships WHERE tenant_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)',
    [company.tenantId, 'joiner@join.test'],
  );
  expect(membership?.status).toBe('active');
  await ctx.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/team.test.ts -t "accepts a member invitation"`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the route**

Resolve the token as `kind: 'member'`; on `null` answer `400` with the same sentence as a bad reset link. Otherwise: set the password hash with `must_change_password = 0`; `UPDATE memberships SET status = 'active' WHERE tenant_id = ? AND user_id = ?`; `spendInvitation`; `completeSignIn`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/team.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/auth.ts apps/api/src/routes/auth.ts apps/api/src/__tests__/team.test.ts
git commit -m "feat(auth): accept an invitation and activate the membership"
```

---

### Task 7: The three public pages

**Files:**
- Create: `apps/client/src/app/forgot/page.tsx`
- Create: `apps/client/src/app/reset/page.tsx`
- Create: `apps/client/src/app/join/page.tsx`
- Create: `apps/client/src/components/TokenPasswordForm.tsx` (shared by `/reset` and `/join`)
- Modify: `apps/client/src/components/SignInForm.tsx` (add the "Forgot your password?" link)
- Modify: `apps/client/src/app/api/sq/[...path]/route.ts` (allow `auth/join`)
- Test: `apps/client/src/components/__tests__/TokenPasswordForm.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/reset/confirm`, `POST /auth/join/confirm` from Tasks 4 and 6; `SignInShell`; `Field`, `Button`.
- Produces: `<TokenPasswordForm endpoint="/auth/reset/confirm" onSuccessRedirect="/quotes" />` — reads the token from `window.location.hash` as `/s` does, posts it with the two passwords, and on success clears the fragment and navigates.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { TokenPasswordForm } = await import('../TokenPasswordForm');

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  window.history.replaceState({}, '', '/reset#token=tok_fragment_1234567890');
});

describe('the token password form', () => {
  it('posts the token from the fragment, never from the query', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: false, code: 'validation_failed', message: 'no' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }));

    render(<TokenPasswordForm endpoint="/auth/reset/confirm" onSuccessRedirect="/quotes" />);
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a-brand-new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'a-brand-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ token: 'tok_fragment_1234567890' });
  });

  it('says the link is dead when there is no token at all', () => {
    window.history.replaceState({}, '', '/reset');
    render(<TokenPasswordForm endpoint="/auth/reset/confirm" onSuccessRedirect="/quotes" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer valid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/client && npx vitest run src/components/__tests__/TokenPasswordForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pages**

`TokenPasswordForm` — a client component: read `window.location.hash`, strip `#token=`, hold two password states, post to `endpoint`, on `result.ok` call `window.history.replaceState({}, '', pathname)` to drop the fragment and `router.push(onSuccessRedirect)`, then `router.refresh()`; on failure render `role="alert"` with the message. When no token is present, render only the alert, no form.

`/forgot` — a client component inside `SignInShell` with two fields (company code, email) posting to `/api/sq/auth/reset/request`; on success replace the form with the fixed sentence, so the page cannot be used to test whether an address exists.

`/reset` and `/join` — server components that render `SignInShell` around `TokenPasswordForm` with the right endpoint and redirect target.

`SignInForm` gains, under the submit button: `<a href="/forgot" className="text-sq-micro text-sq-ink-muted underline">Forgot your password?</a>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/client && npx vitest run`
Expected: PASS, 5/5 (3 existing sign-in + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/app/forgot apps/client/src/app/reset apps/client/src/app/join apps/client/src/components/TokenPasswordForm.tsx apps/client/src/components/SignInForm.tsx apps/client/src/components/__tests__/TokenPasswordForm.test.tsx apps/client/src/app/api/sq/\[...path\]/route.ts
git commit -m "feat(client): forgot-password, reset and join pages"
```

---

### Task 8: Team screen — invite and re-admit

**Files:**
- Modify: `apps/client/src/components/workspace/TeamPage.tsx`
- Test: none new (covered by Task 5's API tests; this task is the surface for them)

**Interfaces:**
- Consumes: `POST /team/invite`, `POST /team/:email/reset`; the `api` helper from `@/lib/sq`.
- Produces: an "Invite" button at panel level opening a form (email, display name, username, role), and a "Reset password" button on each row.

- [ ] **Step 1: Add the invite form and the per-row reset**

Replace the file header's paragraph that says *"Nobody is invited from here yet"* with what the screen now does. Add a `role` select fed by `['company_admin', 'estimator', 'viewer']`. A successful invite shows `Invited <email>. They have a link that expires in seven days.` A successful reset shows `A reset link was sent to <email>.` Both are `role="status"`; a refusal is `role="alert"` with the server's message.

- [ ] **Step 2: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/workspace/TeamPage.tsx
git commit -m "feat(client): invite staff and re-admit them from the Team screen"
```

---

### Task 9: The logo loader — pure, magic-byte checked, no SVG

**Files:**
- Create: `packages/core/src/lib/branding/logo.ts`
- Create: `packages/core/src/lib/branding/index.ts`
- Modify: `packages/core/package.json` (add the `./branding` export)
- Test: `packages/core/src/lib/branding/__tests__/logo.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises` `readFile`, `node:crypto` `createHash`.
- Produces:
  - `interface LogoImage { mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string; width: number; height: number; sha256: string }`
  - `loadLogo(path: string | undefined): Promise<LogoImage | null>`
  - `sniffImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null`
  - `MAX_LOGO_BYTES = 1024 * 1024`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLogo, sniffImageMime, MAX_LOGO_BYTES } from '../logo';

/** A 1x1 PNG, byte for byte. */
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

let dir: string;

describe('sniffImageMime', () => {
  it('recognises PNG by its magic bytes', () => {
    expect(sniffImageMime(PNG_1PX)).toBe('image/png');
  });

  it('refuses SVG', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageMime(svg)).toBeNull();
  });

  it('refuses a file that only claims to be a PNG', () => {
    const text = Buffer.from('this is not an image, whatever the extension says');
    expect(sniffImageMime(text)).toBeNull();
  });
});

describe('the logo loader', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sq-logo-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns base64, dimensions and a hash for a real PNG', async () => {
    const file = join(dir, 'ok.png');
    writeFileSync(file, PNG_1PX);

    const logo = await loadLogo(file);
    expect(logo?.mime).toBe('image/png');
    expect(logo?.base64).toBe(PNG_1PX.toString('base64'));
    expect(logo?.width).toBe(1);
    expect(logo?.height).toBe(1);
    expect(logo?.sha256).toHaveLength(64);
  });

  it('returns null for a missing file rather than throwing', async () => {
    expect(await loadLogo(join(dir, 'nope.png'))).toBeNull();
    expect(await loadLogo(undefined)).toBeNull();
  });

  it('returns null for a file over the size limit', async () => {
    const file = join(dir, 'big.png');
    writeFileSync(file, Buffer.concat([PNG_1PX, Buffer.alloc(MAX_LOGO_BYTES + 1)]));
    expect(await loadLogo(file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/lib/branding/__tests__/logo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `logo.ts`**

`sniffImageMime`: PNG is `89504e470d0a1a0a`; JPEG starts `ffd8ff`; WebP is `RIFF` at 0 and `WEBP` at 8. Anything else, `null`.

`loadLogo`: `undefined` or empty → `null`. `stat` first and return `null` when over `MAX_LOGO_BYTES` **before** reading, so a 5 MB file is not loaded to be rejected. Read, `sniffImageMime`, `null` on unknown. `sha256` from `createHash('sha256').update(bytes)`. Dimensions: read the PNG `IHDR` width/height from bytes 16-24 for PNG; for JPEG and WebP, scan for `SOF0`/`VP8 ` — if the scan fails, return `width: 0, height: 0` rather than refusing the image, because the document sizes it with CSS anyway.

`index.ts` re-exports. `packages/core/package.json` gains `"./branding": "./dist/branding/index.js"` following the existing entries.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/lib/branding/__tests__/logo.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/branding packages/core/package.json
git commit -m "feat(core): load a logo by magic bytes and refuse SVG"
```

---

### Task 10: The document prints the logo, and a revision keeps the one it was saved with

**Files:**
- Modify: `packages/core/src/lib/documents/types.ts` (`FrozenCompany` gains `logoHash: string | null`)
- Modify: `packages/core/src/lib/documents/projection.ts` (carry `logoHash`)
- Modify: `packages/core/src/lib/documents/html.ts:119` (render `<img>` from an injected logo)
- Modify: `packages/core/src/lib/documents/index.ts` (export the option type)
- Test: `packages/core/src/lib/documents/__tests__/logo-render.test.ts` (create)

**Interfaces:**
- Consumes: `LogoImage` from Task 9.
- Produces:
  - `FrozenCompany.logoHash: string | null`
  - `interface RenderOptions { logo?: LogoImage | null }` — a new optional third parameter on `renderQuoteHtml(document, options?)`
  - Renders `<img src="data:<mime>;base64,<data>" alt="<company name>" class="logo-img">` when `options.logo` is present **and** `document.company.logoHash === options.logo.sha256`; otherwise `logoText`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderQuoteHtml } from '../html';
import type { FrozenCompany } from '../types';
import type { CustomerDocument } from '../types';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

function company(over: Partial<FrozenCompany> = {}): FrozenCompany {
  return {
    name: 'Alpha Sheds', abn: null, address: null, phone: null, email: null,
    logoText: 'ALPHA SHEDS', terms: [], assumptions: null, logoHash: null, ...over,
  };
}

function documentWith(companyOver: Partial<FrozenCompany> = {}): CustomerDocument {
  // Build the smallest document the renderer accepts. Copy the fixture shape from an existing
  // document test in packages/core/src/lib/documents/__tests__/ — every field the logo does not
  // touch stays at whatever value that fixture already uses; only `company` differs.
  return { company: company(companyOver) } as unknown as CustomerDocument;
}

const LOGO = {
  mime: 'image/png' as const,
  base64: PNG.toString('base64'),
  width: 1,
  height: 1,
  sha256: 'a'.repeat(64),
};

describe('the logo on a document', () => {
  it('prints the logo text when no logo is supplied', () => {
    const html = renderQuoteHtml(documentWith());
    expect(html).toContain('ALPHA SHEDS');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('embeds the image as a data URI, not a URL', () => {
    const doc = documentWith({ logoHash: LOGO.sha256 });
    const html = renderQuoteHtml(doc, { logo: LOGO });
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('<img');
    // A document must stay self-contained so the PDF has no external reference.
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it('prints the text when the supplied logo is not the one the revision was saved with', () => {
    const doc = documentWith({ logoHash: 'b'.repeat(64) });
    const html = renderQuoteHtml(doc, { logo: LOGO });
    expect(html).toContain('ALPHA SHEDS');
    expect(html).not.toContain('data:image/png;base64,');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/lib/documents/__tests__/logo-render.test.ts`
Expected: FAIL — `logoHash` does not exist on `FrozenCompany`, and `renderQuoteHtml` takes one argument.

- [ ] **Step 3: Implement**

`FrozenCompany` gains `logoHash: string | null`; `projection.ts` copies it from the frozen company JSON with the same tolerance the other new fields use (a revision saved before this field reads as `null`). `html.ts` builds `logoSrc` and chooses between the `<img>` and the escaped `logoText`, adding `.logo-img { max-height: 16mm; max-width: 55mm; }` to the stylesheet. `renderQuoteHtml(document, options: RenderOptions = {})` keeps every existing caller working, since the parameter is optional.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/lib/documents`
Expected: PASS, including the 3 new ones and every existing document test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/documents
git commit -m "feat(documents): print the platform logo, frozen per revision"
```

---

### Task 11: Freeze `logoHash` at save time, and render it on every document route

**Files:**
- Modify: `apps/api/src/lib/settings.ts` (no — see below)
- Modify: `apps/api/src/routes/evaluations.ts:549` (freeze `logoHash` alongside `logoText`)
- Modify: `apps/api/src/lib/documents.ts` (load the logo and pass it to the renderer)
- Modify: `apps/api/src/lib/mail/queue.ts` (the queued send renders with the logo too)
- Test: `apps/api/src/__tests__/documents.test.ts` (extend)

**Interfaces:**
- Consumes: `loadLogo` from `@sq/core/branding`; `process.env.LOGO_FILE`.
- Produces: every document route renders the logo; a revision records `logoHash` in its frozen `company_json`.

- [ ] **Step 1: Write the failing test**

```ts
it('renders the platform logo in the customer document when LOGO_FILE is set', async () => {
  const file = join(dir, 'logo.png');
  writeFileSync(file, PNG_1PX);
  process.env.LOGO_FILE = file;

  const html = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
    headers: { cookie },
  });

  expect(html.statusCode).toBe(200);
  expect(html.body).toContain('data:image/png;base64,');
  delete process.env.LOGO_FILE;
});

it('falls back to the printed name when the logo file is missing', async () => {
  process.env.LOGO_FILE = join(dir, 'absent.png');
  const html = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/quotes/${quoteId}/revisions/1/html`,
    headers: { cookie },
  });
  expect(html.statusCode).toBe(200);
  expect(html.body).not.toContain('data:image/png;base64,');
  delete process.env.LOGO_FILE;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/documents.test.ts`
Expected: FAIL — the HTML carries no data URI.

- [ ] **Step 3: Implement**

`evaluations.ts` adds `logoHash` to the frozen company object it writes into `company_json`, taken from `await loadLogo(process.env.LOGO_FILE)` (or `null`). `documents.ts` calls `loadLogo` once per request and passes `{ logo }` into `renderQuoteHtml`. `queue.ts`'s dispatch does the same when it renders, so a mailed PDF and a downloaded one match.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/evaluations.ts apps/api/src/lib/documents.ts apps/api/src/lib/mail/queue.ts apps/api/src/__tests__/documents.test.ts
git commit -m "feat(documents): freeze and render the platform logo"
```

---

### Task 12: The asset, the header, and the docs

**Files:**
- Create: `assets/logo.png` (extracted from `Logo.ico`)
- Modify: `packages/ui/src/brand.tsx` (read the logo when configured, else the shield)
- Modify: `.env.example` (`LOGO_FILE`)
- Modify: `docs/TEST-ACCESS.md`, `docs/KNOWN-DEVIATIONS.md`, `docs/DECISIONS.md`

**Interfaces:**
- Consumes: `LOGO_FILE`; the committed PNG.
- Produces: `<BrandMark />` renders the image when `process.env.NEXT_PUBLIC_LOGO_SRC` is set and the shield otherwise.

- [ ] **Step 1: Extract the asset**

```bash
node -e "
const fs=require('fs');
const b=fs.readFileSync('D:/Docs/OS.mr.Thi/smq-code-smartquote/App/SmartQuote/Logo.ico');
const n=b.readUInt16LE(4); let best=null;
for(let i=0;i<n;i++){const o=6+i*16;const w=b[o]===0?256:b[o];
  const off=b.readUInt32LE(o+12), size=b.readUInt32LE(o+8);
  const isPng=b.slice(off,off+8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(isPng&&(!best||w>best.w)) best={w,off,size};}
fs.mkdirSync('assets',{recursive:true});
fs.writeFileSync('assets/logo.png', b.slice(best.off, best.off+best.size));
console.log('assets/logo.png', best.w+'x'+best.w, best.size+' bytes');
"
```

Then verify with the loader's own sniffing: `node -e "…loadLogo('assets/logo.png')…"`, expecting `mime: image/png`.

- [ ] **Step 2: Make `BrandMark` use it**

Read `NEXT_PUBLIC_LOGO_SRC` (a `/logo.png` path served from each app's `public/`); when present render `<img src={src} width={size} height={size} alt={title || 'SmartQuote'} className="object-contain" />`, else the existing SVG. Copy `assets/logo.png` into `apps/client/public/`, `apps/admin/public/`, `apps/site/public/`.

- [ ] **Step 3: Document it**

- `.env.example`: `# Optional. A PNG/JPG/WEBP logo file. Without it documents print the company's text logo.` + `LOGO_FILE=./assets/logo.png`
- `docs/TEST-ACCESS.md`: how to request a reset, how to invite, and **"changing the logo: add a new file and point `LOGO_FILE` at it — do not overwrite the old one, or saved quotes that reference its hash will print text instead."**
- `docs/KNOWN-DEVIATIONS.md`: same consequence as a deviation from the desktop, which embedded the image in every file.
- `docs/DECISIONS.md`: mail for reset and invite is sent **inline**, not through the quote `send_jobs` queue, with the reason from spec §2.3.

- [ ] **Step 4: Verify end to end**

Run: `pnpm -w typecheck && npx turbo run test`
Expected: every package green.

- [ ] **Step 5: Commit**

```bash
git add assets apps/client/public apps/admin/public apps/site/public packages/ui/src/brand.tsx .env.example docs
git commit -m "feat: platform logo on the documents and in the app"
```

---

## Self-Review

**Spec coverage.** §2.1 → Tasks 1, 3, 4, 6. §2.2 four routes → Tasks 3, 4, 5, 6. §2.3 inline mail → Task 2 (+ the `503` paths in Tasks 3 and 5). §2.4 non-oracle → Task 3's first test. §2.5 username in the mail → Task 2's second test. §2.6 three pages → Task 7. §2.7 no migration → confirmed; no task adds one, and Task 1's tests prove `pending` is refused at sign-in (Task 5's first test). §3.1 one logo → Task 12. §3.2 loader → Task 9. §3.3 data-URI + frozen hash → Tasks 10, 11. §3.4 header → Task 12. §5's risk table maps one-to-one onto the Review Focus list.

**Gap found and fixed:** the spec's §4.1 lists B11 as "SMTP unconfigured → 503". That needs `makeTestApp` to accept a mail dependency, which no task owned — Task 3 now carries `makeTestApp`'s second parameter and `app.ts`'s wiring explicitly, in its Files and Interfaces blocks.

**Second gap found and fixed:** Task 10's test needs a `CustomerDocument` fixture, and this plan does not repeat the existing fixtures. The implementer should copy the shape from `packages/core/src/lib/documents/__tests__/*.test.ts`, which already builds one. Said here because the task's own code block leaves it as `/* … */`.

**Type consistency.** `loadLogo` returns `LogoImage | null` in Task 9 and is consumed as such in Tasks 10, 11, 12. `RenderOptions.logo?: LogoImage | null` matches. `createInvitation` returns `{ id, token, expiresAt }` in Task 1 and Tasks 3, 5, 6 read only `token`. `resolveInvitation` returns `ResolvedInvitation | null` with `userId` — Tasks 4 and 6 depend on `userId` specifically, and Task 1 supplies it. `TransactionalDeps` is defined once in Task 2 and threaded unchanged through Tasks 3 and 5. `MailNotConfiguredError` is thrown in Task 2 and **not** used by Tasks 3/5 — those check `mail === null` instead, which is the same fact decided once at boot; the error exists for a caller that builds deps with an empty `from`, which is Task 12's `.env.example` case.

**One inconsistency found and removed:** an earlier draft had `apps/api/src/lib/settings.ts` in Task 11's Files list. Nothing in Task 11 changes it — the logo hash travels in the frozen company object built in `evaluations.ts`, not in `CompanySettings`. Removed.

**Proportion.** 12 tasks, ~40 production files touched against a 359-line spec. The code blocks are mostly tests, which is where the decisions live; the implementation steps state a signature and the values the spec pins, and leave the body to the implementer.
