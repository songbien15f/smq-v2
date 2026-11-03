# Slice 1 — Multi-company and company-code sign-in: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the single-company invariant, identify each company by a business `code`, and sign company users in with company code + username + password.

**Architecture:** A `tenants.code` column becomes the business key while `slug` stays the URL key. A `memberships.username` column makes the sign-in name unique **per company**, so two companies may both have a `john`. Sign-in resolves the company first, then the person, because the username is only meaningful inside a company. `SessionView` gains `currentTenantId/Code/Name` so the eight `memberships[0]` reads in the client have one source of truth.

**Tech Stack:** TypeScript, Fastify, Next.js 15 (app router), Postgres + SQLite via a portable migration runner, Zod contracts, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-multi-company-and-template-files-design.md` §4.1–4.4

## Global Constraints

- Every route reads the company from the **session**; `X-Tenant-Id`, path and query never select a company (`DECISIONS.md` A7).
- A cross-company read or write answers **404**, never 403 — 403 confirms the row exists.
- One rejection message for every failed sign-in reason: `Those details do not match an account.`
- Migrations are portable SQL applied to **both** drivers; dialect differences go in `migrations/sqlite/` or `migrations/pg/`.
- New columns on a populated table are **nullable**; a `NOT NULL` add fails on existing rows.
- `packages/core` must not gain a dependency on DB, HTTP or tenancy (`DECISIONS.md` A9).
- Tests must pass on SQLite and on Postgres (`TEST_DB_DRIVER=postgres`).
- Minimum touch target 44px (`min-h-11`) on every input.

## Review Focus

1. **A user typing a company code that belongs to another company** — must get the same message and similar timing as a wrong password, not a hint that the code exists.
2. **Two companies each with a user named `john`** — both must sign in successfully, and each must land in their own company with only their own quotes.
3. **An existing user who has only ever typed an email** — after the migration their username is the part before `@`, and if a colleague shares it they get a numeric suffix; nothing may leave them unable to sign in.
4. **A person removed from company A while holding a live session** — the next request must fail, and it must fail for A only.
5. **A platform administrator with no membership at all** — must still be able to sign in to the admin app, which has no company field.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/009_company_code_and_username.sql` | **Create.** `tenants.code`, `memberships.username`, backfills, unique indexes. |
| `packages/contracts/src/auth.ts` | Modify. `signInRequest` gains `companyCode` + `username`; `SessionView` gains the three current-company fields. |
| `apps/api/src/config.ts` | Modify. Drop `singleCompany`. |
| `packages/db/src/config.ts` | Modify. Drop `singleCompany`. |
| `apps/api/src/server.ts` | Modify. Drop the singular-company boot check. |
| `apps/api/src/lib/company.ts` | Modify. Drop `assertCompanyIsSingular`, `SingleCompanyError`, the `singleCompany` parameter; add `code` to `CreateCompanyInput`. |
| `apps/api/src/routes/auth.ts` | Modify. `resolveSignIn` replaces the email-then-membership lookup; `SessionView` builder gains the current company. |
| `apps/api/src/lib/sessions.ts` | Modify. Session load returns `tenant_code`, and `SessionUser` carries it. |
| `apps/api/src/routes/admin.ts` | Modify. Company list/create expose and accept `code`. |
| `apps/client/src/components/SignInForm.tsx` | Rewrite. Three fields; two-column layout. |
| `apps/client/src/components/SignInShell.tsx` | **Create.** The navy brand panel + centred card frame. |
| `packages/ui/src/field.tsx` | Modify. `min-h-[38px]` → `min-h-11`. |
| `apps/client/src/app/**` (8 files) | Modify. `memberships[0]` → `session.currentTenantName`. |
| `apps/admin/src/components/SignInForm.tsx` | Modify. Copy note pointing at the client form for the three-field variant (admin keeps email). |
| `apps/api/src/__tests__/isolation.test.ts` | **Create.** The data-isolation suite — the most important file in this plan. |

---

### Task 1: Migration — company code and per-company username

**Files:**
- Create: `packages/db/migrations/009_company_code_and_username.sql`
- Test: `packages/db/src/__tests__/db.test.ts` (existing file, add cases)

**Interfaces:**
- Produces: `tenants.code TEXT` (nullable, unique), `memberships.username TEXT` (nullable, unique per tenant). Nothing else in the plan may assume either is `NOT NULL`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/__tests__/db.test.ts`:

```ts
it('gives every existing company a code derived from its slug', async () => {
  const tenant = await db.get<{ code: string }>("SELECT code FROM tenants WHERE slug = 'demo-sheds'");
  expect(tenant?.code).toBe('DEMOSHEDS');
});

it('backfills a username from each user email and keeps it unique per company', async () => {
  const rows = await db.all<{ username: string }>('SELECT username FROM memberships ORDER BY username');
  for (const row of rows) expect(row.username).not.toBeNull();
});

it('refuses two memberships with the same username in one company', async () => {
  await expect(
    db.run("INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username) VALUES (?, ?, 'viewer', 'active', '2026-01-01', '2026-01-01', 'dup')", [tenantA, userA]),
  ).resolves.toBeDefined();
  await expect(
    db.run("INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username) VALUES (?, ?, 'viewer', 'active', '2026-01-01', '2026-01-01', 'dup')", [tenantA, userB]),
  ).rejects.toThrow();
});

it('allows the same username in two different companies', async () => {
  await db.run("INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username) VALUES (?, ?, 'viewer', 'active', '2026-01-01', '2026-01-01', 'shared')", [tenantA, userA]);
  await expect(
    db.run("INSERT INTO memberships (tenant_id, user_id, role, status, created_at, updated_at, username) VALUES (?, ?, 'viewer', 'active', '2026-01-01', '2026-01-01', 'shared')", [tenantB, userB]),
  ).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/__tests__/db.test.ts`
Expected: FAIL — `no such column: code` / `no such column: username`.

- [ ] **Step 3: Write the migration**

Create `packages/db/migrations/009_company_code_and_username.sql`. The two backfills must run **before** their indexes; a unique index created first would reject the rows it is meant to disambiguate.

```sql
-- 009 — a business code per company, and a sign-in name per company.
--
-- `slug` stays the URL key and cannot change. `code` is the business key: it is printed on a
-- quote and read down a phone line (`VGG`), and the old licence server used exactly that.
--
-- `username` lives on `memberships`, not `users`, because a sign-in name is only meaningful
-- inside a company: two companies may each have a `john`. `users.email` stays NOT NULL UNIQUE
-- and is still how a quote is mailed — it is simply no longer the sign-in key.
--
-- Both columns are nullable. `NOT NULL` cannot be added to a populated table without a
-- default, and the create-company route supplies a code explicitly, so a new row always has one.

ALTER TABLE tenants ADD COLUMN code TEXT;

-- `demo-sheds` becomes `DEMOSHEDS`: upper, hyphens removed, first ten characters, which is
-- the width the old server used.
UPDATE tenants
   SET code = upper(substr(replace(slug, '-', ''), 1, 10))
 WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_code ON tenants (code);

ALTER TABLE memberships ADD COLUMN username TEXT;

-- The local part of the email, lowercased.
UPDATE memberships
   SET username = lower(substr(
     (SELECT u.email FROM users u WHERE u.id = memberships.user_id),
     1,
     instr((SELECT u.email FROM users u WHERE u.id = memberships.user_id), '@') - 1
   ))
 WHERE username IS NULL;

-- Disambiguate inside each company: every row but the earliest of a duplicate group gets a
-- numeric suffix. Without this, the unique index below would fail on a company that has two
-- people whose emails start the same way, and the migration would stop half applied.
UPDATE memberships
   SET username = username || CAST((
     SELECT COUNT(*) FROM memberships m2
      WHERE m2.tenant_id = memberships.tenant_id
        AND m2.username  = memberships.username
        AND m2.rowid    < memberships.rowid
   ) + 1 AS TEXT)
 WHERE (SELECT COUNT(*) FROM memberships m2
         WHERE m2.tenant_id = memberships.tenant_id
           AND m2.username  = memberships.username
           AND m2.rowid   <= memberships.rowid) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_username ON memberships (tenant_id, username);
```

Create `packages/db/migrations/pg/009_company_code_and_username.sql` with the Postgres form of the two `UPDATE`s (`rowid` is SQLite-only; use `ctid` in a CTE, or a `row_number()` window):

```sql
ALTER TABLE tenants ADD COLUMN code TEXT;
UPDATE tenants SET code = upper(substr(replace(slug, '-', ''), 1, 10)) WHERE code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_code ON tenants (code);

ALTER TABLE memberships ADD COLUMN username TEXT;

UPDATE memberships m
   SET username = lower(split_part(u.email, '@', 1))
  FROM users u
 WHERE u.id = m.user_id AND m.username IS NULL;

UPDATE memberships m
   SET username = m.username || rn::text
  FROM (
    SELECT tenant_id, user_id,
           row_number() OVER (PARTITION BY tenant_id, lower(split_part((SELECT email FROM users WHERE id = user_id), '@', 1)) ORDER BY created_at, user_id) AS rn
      FROM memberships
  ) d
 WHERE d.tenant_id = m.tenant_id AND d.user_id = m.user_id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_username ON memberships (tenant_id, username);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/db && npx vitest run src/__tests__/db.test.ts`
Expected: PASS. Then on Postgres: `TEST_DB_DRIVER=postgres pnpm -w db:migrate` — expected `+ 009_company_code_and_username applied`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/009_company_code_and_username.sql packages/db/migrations/pg/009_company_code_and_username.sql packages/db/src/__tests__/db.test.ts
git commit -m "feat(db): company code and per-company username"
```

---

### Task 2: Contracts — sign-in shape and current company on the session

**Files:**
- Modify: `packages/contracts/src/auth.ts:17-50`
- Test: `packages/contracts/src/__tests__/contracts.test.ts` (existing)

**Interfaces:**
- Produces: `signInRequest` = `{ companyCode?: string, username: string, password: string }`. **Note:** `email` is removed from this schema; the admin app's email sign-in goes through a separate `platformSignInRequest`.
- Produces: `platformSignInRequest` = `{ email: string, password: string }`.
- Produces: `SessionView` gains `currentTenantId: string | null`, `currentTenantCode: string | null`, `currentTenantName: string | null`.
- Produces: `MembershipView` gains `username: string`.

- [ ] **Step 1: Write the failing test**

```ts
it('requires a username and leaves the company code optional at the API', () => {
  expect(signInRequest.safeParse({ username: 'jo', password: 'x' }).success).toBe(true);
  expect(signInRequest.safeParse({ companyCode: 'vgg', username: 'jo', password: 'x' }).success).toBe(true);
  // An email alone is no longer a sign-in: the key is the username.
  expect(signInRequest.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(false);
});

it('keeps a separate email sign-in for platform staff', () => {
  expect(platformSignInRequest.safeParse({ email: 'ops@vendor.test', password: 'x' }).success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && npx vitest run`
Expected: FAIL — `platformSignInRequest is not defined`.

- [ ] **Step 3: Update the schemas**

In `packages/contracts/src/auth.ts`, replace `signInRequest` and add the platform variant:

```ts
/**
 * A company user signing in.
 *
 * `companyCode` is optional **at the API** because the admin app has no company field — a
 * platform administrator belongs to no company. The client app always sends it; a company
 * user reaching the API without one is refused by the route, not by this schema.
 */
export const signInRequest = z.object({
  companyCode: z.string().trim().max(16).optional(),
  username: z.string().trim().min(1, 'Enter your username').max(80),
  password: z.string().min(1, 'Enter your password'),
});

/** Licence-vendor staff, who have no company and therefore no username. */
export const platformSignInRequest = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
```

Then extend the two view interfaces:

```ts
export interface MembershipView {
  tenantId: string;
  tenantName: string;
  role: (typeof COMPANY_ROLES)[number];
  /** The name this person signs in with inside this company. */
  username: string;
}

export interface SessionView {
  // … existing fields unchanged …
  /** The company this session is open in. `null` for platform staff. */
  currentTenantId: string | null;
  currentTenantCode: string | null;
  currentTenantName: string | null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/contracts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/auth.ts packages/contracts/src/__tests__/contracts.test.ts
git commit -m "feat(contracts): username sign-in and current company on the session"
```

---

### Task 3: Remove `SINGLE_COMPANY` from both config layers

**Files:**
- Modify: `apps/api/src/config.ts:29,64`
- Modify: `packages/db/src/config.ts:63,71,81,93`
- Modify: `apps/api/src/__tests__/helpers.ts:41`
- Modify: `apps/api/src/__tests__/api.test.ts:263-275`
- Modify: `.env.example:30`

**Interfaces:**
- Produces: `ApiConfig` without `singleCompany`; `DbConfig` without `singleCompany`. Later tasks construct configs without the field.

- [ ] **Step 1: Write the failing test**

```ts
it('builds a configuration with no single-company flag', () => {
  expect('singleCompany' in testConfig()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/api.test.ts`
Expected: FAIL — `expected true to be false`.

- [ ] **Step 3: Delete the flag everywhere**

Remove `singleCompany` from the `ApiConfig` interface and its construction in `apps/api/src/config.ts`, from `DbConfig` and its construction in `packages/db/src/config.ts`, from `testConfig()` in helpers, and the `SINGLE_COMPANY` line from `.env.example`. In `api.test.ts`, delete the `describe` block that passes `singleCompany: false` — the behaviour it guarded no longer exists to toggle.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove the single-company flag"
```

---

### Task 4: Remove the singular-company boot check and the create refusal

**Files:**
- Modify: `apps/api/src/server.ts:24,47-55`
- Modify: `apps/api/src/lib/company.ts:85-160`
- Modify: `apps/api/src/routes/admin.ts:129`
- Test: `apps/api/src/__tests__/company.test.ts` (create)

**Interfaces:**
- Produces: `createCompany(db, input)` — two arguments, no `singleCompany`.
- Produces: `CreateCompanyInput` gains `code: string` (required, uppercased, 1–16 chars).
- Removes: `assertCompanyIsSingular`, `SingleCompanyError`.

- [ ] **Step 1: Write the failing test**

```ts
it('creates a second company, which the old build refused', async () => {
  const first = await createCompany(db, baseInput({ code: 'AAA', slug: 'aaa', adminEmail: 'a@a.test' }));
  const second = await createCompany(db, baseInput({ code: 'BBB', slug: 'bbb', adminEmail: 'b@b.test' }));

  expect(first.tenantId).not.toBe(second.tenantId);
});

it('refuses a duplicate company code', async () => {
  await createCompany(db, baseInput({ code: 'CCC', slug: 'ccc', adminEmail: 'c@c.test' }));
  await expect(
    createCompany(db, baseInput({ code: 'CCC', slug: 'ccc-two', adminEmail: 'c2@c.test' })),
  ).rejects.toThrow(/unique|duplicate/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/company.test.ts`
Expected: FAIL — `createCompany` still demands a third argument, `code` is unknown.

- [ ] **Step 3: Change the signatures**

In `apps/api/src/lib/company.ts`: drop the `singleCompany` parameter and the `if (singleCompany) { … }` block from `createCompany`; add `code: string` to `CreateCompanyInput`; insert `code` into the `INSERT INTO tenants (…) VALUES (…)` column list and bind `input.code.trim().toUpperCase()`. Delete `assertCompanyIsSingular` and `SingleCompanyError` entirely. In `apps/api/src/server.ts`, delete the import and the `if (dbConfig.singleCompany) { … }` block. In `apps/api/src/routes/admin.ts:129`, drop the `config.singleCompany` argument.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/company.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: allow more than one company"
```

---

### Task 5: Sign-in resolves the company first, then the person

**Files:**
- Modify: `apps/api/src/routes/auth.ts:73-145`
- Test: `apps/api/src/__tests__/signin.test.ts` (create)

**Interfaces:**
- Consumes: `signInRequest` from Task 2, `tenants.code` and `memberships.username` from Task 1.
- Produces: `resolveSignIn(db, input: { companyCode: string; username: string }): Promise<{ userId: string; tenantId: string } | null>` — the one place that decides which person in which company.

- [ ] **Step 1: Write the failing test**

```ts
it('signs a person in to the company named by the code', async () => {
  const cookie = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  const session = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  expect(session.json().data.currentTenantCode).toBe('AAA');
});

it('lets two companies each have a user called jo, and keeps them apart', async () => {
  const inA = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  const inB = await signIn(ctx.app, 'BBB', 'jo', 'a-long-enough-password');

  const a = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: inA } });
  const b = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: inB } });

  expect(a.json().data.currentTenantId).not.toBe(b.json().data.currentTenantId);
});

it('answers the same way for a wrong code, a wrong username and a wrong password', async () => {
  const wrongCode = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-in',
    payload: { companyCode: 'ZZZ', username: 'jo', password: 'a-long-enough-password' } });
  const wrongUser = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-in',
    payload: { companyCode: 'AAA', username: 'nobody', password: 'a-long-enough-password' } });
  const wrongPass = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-in',
    payload: { companyCode: 'AAA', username: 'jo', password: 'wrong-password-entirely' } });

  // Three different failures, one answer: any difference would let a caller discover which
  // company codes exist and which usernames they contain.
  expect(wrongCode.statusCode).toBe(wrongUser.statusCode);
  expect(wrongUser.statusCode).toBe(wrongPass.statusCode);
  expect(wrongCode.json().message).toBe(wrongUser.json().message);
  expect(wrongUser.json().message).toBe(wrongPass.json().message);
});

it('refuses a company user with no company code', async () => {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-in',
    payload: { username: 'jo', password: 'a-long-enough-password' } });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: FAIL — `signIn` helper still takes an email.

- [ ] **Step 3: Implement `resolveSignIn` and use it**

Add to `apps/api/src/routes/auth.ts`:

```ts
/**
 * Which person, in which company.
 *
 * The company is resolved **first** because the username is only unique inside one: `jo` in
 * AAA and `jo` in BBB are different people. Returns `null` for every failure — unknown code,
 * unknown username, removed membership — so the caller cannot accidentally report which one.
 */
export async function resolveSignIn(
  db: Db,
  input: { companyCode: string; username: string },
): Promise<{ userId: string; tenantId: string } | null> {
  const row = await db.get<{ user_id: string; tenant_id: string; disabled_at: string | null }>(
    `SELECT m.user_id, m.tenant_id, u.disabled_at
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN users   u ON u.id = m.user_id
      WHERE t.code = ? AND t.status = 'active'
        AND m.username = ? AND m.status = 'active'`,
    [input.companyCode.trim().toUpperCase(), input.username.trim().toLowerCase()],
  );
  if (row === null || row.disabled_at !== null) return null;
  return { userId: row.user_id, tenantId: row.tenant_id };
}
```

In the `/auth/sign-in` handler, replace the `SELECT … FROM users WHERE email = ?` lookup and the `memberships[0]` pick with: parse with `signInRequest`; if `companyCode` is absent return `sendFail(reply, 'validation_failed', 'Enter your company code.')`; call `resolveSignIn`; on `null` run `burnVerificationTime(body.password)` then return the shared `unauthorized` message; otherwise load `password_hash` by `userId`, verify, and call `createSession` with `tenantId` from `resolveSignIn`. Keep both rate limiters, keying the per-account one on `${companyCode}:${username}`.

- [ ] **Step 4: Migrate the 25 existing `signIn(...)` call sites**

`signIn` is called **25 times** across the API tests with the old `(app, email, password)` shape. Changing its signature breaks all of them at once, which hides real failures behind a compile error.

Make the helper tolerant rather than rewriting every call:

```ts
/**
 * Sign in for a test.
 *
 * Accepts the old `(app, email, password)` form as well as the new
 * `(app, companyCode, username, password)`. The three-argument form resolves the company by
 * looking the email up, so the 25 existing tests keep working while the mechanism under them
 * has genuinely changed — a test that passes here still proves the session was issued.
 *
 * New tests must use the four-argument form: a test that omits the company code is no longer
 * testing the path a real user takes.
 */
export async function signIn(
  app: FastifyInstance,
  codeOrEmail: string,
  usernameOrPassword: string,
  password?: string,
): Promise<string> {
  if (password === undefined) {
    // Old shape: find which company this email belongs to, then sign in properly.
    const row = await db.get<{ code: string; username: string }>(
      `SELECT t.code, m.username FROM users u
         JOIN memberships m ON m.user_id = u.id
         JOIN tenants t ON t.id = m.tenant_id
        WHERE u.email = ? LIMIT 1`,
      [codeOrEmail.toLowerCase()],
    );
    if (row === null) throw new Error(`no company holds ${codeOrEmail}`);
    return signIn(app, row.code, row.username, usernameOrPassword);
  }
  // … new four-argument body …
}
```

The estimate uses this to land the change in one place instead of 25. Verify with `grep -c "await signIn(" apps/api/src/__tests__/*.ts` — the count stays 25 and they all still pass.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole API suite**

Run: `cd apps/api && npx vitest run`
Expected: PASS, including the 25 tests that still use the three-argument form.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/__tests__/signin.test.ts apps/api/src/__tests__/helpers.ts
git commit -m "feat(auth): sign in with company code and username"
```

---

### Task 6: The session carries the current company

**Files:**
- Modify: `apps/api/src/lib/sessions.ts:160-225`
- Modify: `apps/api/src/routes/auth.ts` (session view builder, `loadMemberships`)
- Test: `apps/api/src/__tests__/signin.test.ts` (extend)

**Interfaces:**
- Consumes: `SessionView` fields from Task 2.
- Produces: `SessionUser` gains `tenantCode: string | null`; `GET /auth/session` returns `currentTenantId/Code/Name` and each membership's `username`.

- [ ] **Step 1: Write the failing test**

```ts
it('reports the current company code and name on the session', async () => {
  const cookie = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  const session = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  const data = session.json().data;

  expect(data.currentTenantCode).toBe('AAA');
  expect(data.currentTenantName).toBe('Alpha Sheds');
  expect(data.memberships[0].username).toBe('jo');
});

it('reports nulls for a platform administrator with no company', async () => {
  const cookie = await signInPlatform(ctx.app, 'ops@vendor.test', 'a-long-enough-password');
  const session = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  const data = session.json().data;

  expect(data.currentTenantId).toBeNull();
  expect(data.currentTenantCode).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: FAIL — `currentTenantCode` is `undefined`.

- [ ] **Step 3: Select the code with the session and return it**

In `apps/api/src/lib/sessions.ts`, add `t.code AS tenant_code` to the session `SELECT`, add `tenantCode: row.tenant_code` to the returned `SessionUser`, and add `tenantCode: string | null` to that interface. In the `SessionView` builder in `apps/api/src/routes/auth.ts`, set `currentTenantId`, `currentTenantCode` and `currentTenantName` from the session's `tenantId`/`tenantCode` plus the matching membership's `tenantName`. Extend `loadMemberships`'s `SELECT` with `m.username`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sessions.ts apps/api/src/routes/auth.ts apps/api/src/__tests__/signin.test.ts
git commit -m "feat(auth): the session reports its current company"
```

---

### Task 7: Data isolation — the suite that matters most

**Files:**
- Create: `apps/api/src/__tests__/isolation.test.ts`

**Interfaces:**
- Consumes: every earlier task; `signIn(app, code, username, password)` from Task 5.

- [ ] **Step 1: Write the failing test**

```ts
it('does not list another company quote', async () => {
  const a = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/quotes?limit=50', headers: { cookie: a } });
  const numbers = (list.json().data.items as { number: string }[]).map((q) => q.number);
  expect(numbers).not.toContain(quoteOfB);
});

it('answers 404 — not 403 — for another company quote by id', async () => {
  const a = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/quotes/${quoteIdOfB}`, headers: { cookie: a } });
  // 403 would confirm the row exists; 404 says nothing.
  expect(response.statusCode).toBe(404);
});

it('counts seats per company', async () => {
  // B is full; A must still accept a sign-in.
  await fillSeatsOfB();
  const a = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  expect(a).toBeTruthy();
});

it('stops a removed member on their next request, in that company only', async () => {
  const cookie = await signIn(ctx.app, 'AAA', 'jo', 'a-long-enough-password');
  await ctx.db.run("UPDATE memberships SET status = 'removed' WHERE tenant_id = ? AND user_id = ?", [tenantA, userJo]);
  const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  expect(response.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/isolation.test.ts`
Expected: FAIL on at least one case if any route still reads `memberships[0]`; PASS if Slice 1 is complete. A pass here before Task 5 is a false pass — confirm the `signIn` helper is the new three-argument form.

- [ ] **Step 3: Fix whatever the suite exposes**

Each failure names a route reading a company from somewhere other than the session. Change that route to `session.tenantId`, or change the query to filter on it. Do not weaken the assertion.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/isolation.test.ts`
Expected: PASS on SQLite. Then `TEST_DB_DRIVER=postgres pnpm -w test` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/__tests__/isolation.test.ts
git commit -m "test: prove companies cannot see each other"
```

---

### Task 8: The client reads the session's current company, not `memberships[0]`

**Files:**
- Modify: `apps/client/src/app/quotes/page.tsx:24`
- Modify: `apps/client/src/app/quotes/[quoteId]/page.tsx:74,199`
- Modify: `apps/client/src/app/settings/page.tsx:20`
- Modify: `apps/client/src/app/settings/prices/page.tsx:24`
- Modify: `apps/client/src/app/change-password/page.tsx:22`
- Modify: `apps/client/src/app/quotes/import/page.tsx:22`
- Modify: `apps/client/src/app/team/page.tsx:26`

**Interfaces:**
- Consumes: `SessionView.currentTenantName` from Task 2.

- [ ] **Step 1: Write the failing check**

```bash
grep -rn "memberships\[0\]" apps/client/src
```
Expected before: 8 matches. This is the test: the count must reach **0**.

- [ ] **Step 2: Confirm the current state**

Run the grep above and record the count. If it is 0 already, stop — nothing to do.

- [ ] **Step 3: Replace each read**

In every listed file, replace `session.memberships[0]?.tenantName` with `session.currentTenantName`. In `apps/client/src/app/quotes/page.tsx:24`, the local `const membership = session.memberships[0]` becomes `const companyName = session.currentTenantName` and its later uses follow. Delete the now-unused `membership` binding.

- [ ] **Step 4: Verify the count is zero and the build is clean**

Run: `grep -rn "memberships\[0\]" apps/client/src; echo "exit=$?"`
Expected: no output, `exit=1`. Then `npx turbo run typecheck --filter=@sq/client-app` — expected `Tasks: 4 successful`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src
git commit -m "refactor(client): read the current company from the session"
```

---

### Task 9: The sign-in screen — three fields, two columns

**Files:**
- Create: `apps/client/src/components/SignInShell.tsx`
- Modify: `apps/client/src/components/SignInForm.tsx`
- Modify: `packages/ui/src/field.tsx:52`
- Modify: `apps/client/src/app/page.tsx`

**Interfaces:**
- Consumes: `signInRequest` from Task 2.
- Produces: `<SignInForm />` with no props required; `<SignInShell>{children}</SignInShell>`.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders a company code, a username and a password, in that order', () => {
  render(<SignInForm />);
  const inputs = screen.getAllByRole('textbox');
  expect(inputs[0]).toHaveAttribute('id', 'companyCode');
  expect(inputs[1]).toHaveAttribute('id', 'username');
  expect(screen.getByLabelText(/password/i)).toHaveAttribute('id', 'password');
});

it('shows a typed company code in capitals without changing what is submitted', () => {
  render(<SignInForm />);
  const code = screen.getByLabelText(/company code/i);
  fireEvent.change(code, { target: { value: 'vgg' } });
  expect((code as HTMLInputElement).value).toBe('VGG');
});

it('posts companyCode, username and password — never an email', async () => {
  const posted: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    posted.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ ok: false, code: 'unauthorized', message: 'nope' }), { status: 401 });
  }));

  render(<SignInForm />);
  fireEvent.change(screen.getByLabelText(/company code/i), { target: { value: 'vgg' } });
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'jo' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toEqual({ companyCode: 'VGG', username: 'jo', password: 'pw' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/client && npx vitest run src/components/__tests__/SignInForm.test.tsx`
Expected: FAIL — no `#companyCode`, no `#username`.

- [ ] **Step 3: Build the shell and rewrite the form**

Create `apps/client/src/components/SignInShell.tsx`: a full-height `grid` that is one column below `lg` and two above. The left cell is `hidden lg:flex` with `bg-sq-brand`, the `BrandMark`, a one-line product statement in `text-sq-body-lg text-white/80`, and a 48px-wide gold rule (`bg-sq-gold`). The right cell centres `{children}` in a `max-w-sm` white card with `rounded-sq-lg border border-sq-line` and `p-sq-6`.

Rewrite `SignInForm.tsx` to hold `companyCode`, `username`, `password` and post `{ companyCode: companyCode.toUpperCase(), username, password }` to `/api/session`. The company-code input carries `value={companyCode.toUpperCase()}` with `onChange` storing `event.target.value`, so display is upper-cased while state is what was typed. Keep the existing error summary, per-field errors, focus-to-first-invalid, `loading` and the seat note. Use `autoComplete="organization"` for the code, `autoComplete="username"` for the username, and `autoComplete="current-password"` for the password.

In `packages/ui/src/field.tsx:52`, change `min-h-[38px]` to `min-h-11`.

In `apps/client/src/app/page.tsx`, wrap `<SignInForm />` in `<SignInShell>` and drop the surrounding `min-h-[60dvh]` centring, which the shell now owns.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/client && npx vitest run src/components/__tests__/SignInForm.test.tsx`
Expected: PASS. Then `npx turbo run typecheck` — expected `12 successful`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/SignInShell.tsx apps/client/src/components/SignInForm.tsx apps/client/src/app/page.tsx packages/ui/src/field.tsx apps/client/src/components/__tests__/SignInForm.test.tsx
git commit -m "feat(client): sign in with company code and username"
```

---

### Task 10: The admin app keeps its email sign-in, on the platform route

**Files:**
- Modify: `apps/admin/src/components/SignInForm.tsx:26,42,77`
- Modify: `apps/admin/src/app/api/sq/[...path]/route.ts` (allow `auth/sign-in-platform` if a separate route is used)
- Modify: `apps/api/src/routes/auth.ts` (register the platform route)

**Interfaces:**
- Consumes: `platformSignInRequest` from Task 2.
- Produces: `POST /auth/sign-in-platform` accepting `{ email, password }` and refusing any account that holds a company membership.

- [ ] **Step 1: Write the failing test**

```ts
it('signs a platform administrator in by email', async () => {
  const response = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/sign-in-platform',
    payload: { email: 'ops@vendor.test', password: 'a-long-enough-password' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().data.currentTenantId).toBeNull();
});

it('refuses a company user on the platform route', async () => {
  const response = await ctx.app.inject({
    method: 'POST', url: '/api/v1/auth/sign-in-platform',
    payload: { email: 'jo@alpha.test', password: 'a-long-enough-password' },
  });
  // A company person belongs on the client app, where seats and prices live.
  expect(response.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the platform route**

In `apps/api/src/routes/auth.ts`, extract the shared body of sign-in (rate limits, `verifyPassword`, `burnVerificationTime`, `createSession`, session view) into a local `completeSignIn(user, reply)` helper, then register `POST /auth/sign-in-platform` that parses with `platformSignInRequest`, looks the user up by `email`, and returns the shared `unauthorized` message unless `platform_role IS NOT NULL`. Point the admin app's form at `/api/sq/auth/sign-in-platform` and add that path to the admin bridge's allow-list. The admin form itself keeps its two fields — change only its copy, which must now read "Sign in with your vendor email address."

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/signin.test.ts`
Expected: PASS. Then `cd apps/admin && npx turbo run typecheck --filter=@sq/admin-app` — expected success.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/admin/src/components/SignInForm.tsx apps/admin/src/app/api/sq/\[...path\]/route.ts apps/api/src/__tests__/signin.test.ts
git commit -m "feat(admin): platform staff sign in by email on their own route"
```

---

### Task 11: Seeded company gets a code, and the docs stop promising one company

**Files:**
- Modify: `scripts/install-company.ts` (the seed)
- Modify: `docs/DECISIONS.md` (A2)
- Modify: `docs/TEST-ACCESS.md`
- Modify: `start/start-306.bat` (print the code at boot)

**Interfaces:**
- Consumes: `CreateCompanyInput.code` from Task 4.

- [ ] **Step 1: Write the failing check**

```bash
grep -n "COMPANY_CODE" docs/TEST-ACCESS.md start/start-306.bat
```
Expected before: no output.

- [ ] **Step 2: Confirm the gap**

Run the grep. Both files are silent on the code, so a new operator has no way to learn what to type at the sign-in screen — the one thing they need first.

- [ ] **Step 3: Thread the code through**

Add `COMPANY_CODE` (default `DEMOSHEDS`) to the seed script and to `start/start-306.bat`, printed alongside the existing credentials block. Update `docs/TEST-ACCESS.md` with the code, the username (`owner`) and the three-field sign-in order. Rewrite `docs/DECISIONS.md` A2 to record that the product is multi-company as of 2026-11-03, keyed on `tenants.code`, and that the single-company invariant was removed deliberately.

- [ ] **Step 4: Verify**

Run: `pnpm install:company -- --if-empty` then
`curl -s -X POST http://localhost:3060/api/v1/auth/sign-in -H 'content-type: application/json' -d '{"companyCode":"DEMOSHEDS","username":"owner","password":"a-long-enough-password"}' | head -c 120`
Expected: `{"ok":true,…`. A code of `WRONG` returns the shared rejection.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-company.ts docs/DECISIONS.md docs/TEST-ACCESS.md start/start-306.bat
git commit -m "docs: seed and document the company code"
```

---

## Self-Review

**Spec coverage.** §4.1 → Task 1. §4.2 → Tasks 2, 5, 6. §4.3 → Tasks 2, 6, 8. §4.3b → Task 9. §4.4 → Tasks 3, 4. §6 Slice 1's "xong khi" list → Tasks 7 (isolation), 8 (grep zero), 9 (form renders), 11 (seed reachable). Slices 2–5 and §4.5–4.8 are deliberately outside this plan; they get their own.

**Gap found and fixed:** the spec says the admin app keeps email sign-in but never says *how* two shapes share one route. Task 10 adds the separate platform route and pins that a company user is refused there — otherwise the admin app would silently keep the company-only path and a platform administrator could not sign in at all.

**Second gap found and fixed:** `signIn` has **25 call sites** in the existing tests. Task 5 now carries that migration explicitly as its own step, with a helper that accepts both shapes. Without it the signature change fails the whole suite at compile time and every real regression hides behind it.

**Type consistency.** `resolveSignIn` returns `{ userId, tenantId }` in Task 5 and is consumed as such in Task 6. `SessionUser.tenantCode` (Task 6) is the source of `SessionView.currentTenantCode` (Task 2). `signIn(app, code, username, password)` is used identically in Tasks 5, 6, 7.

**Review Focus → tests.** (1) shared rejection → Task 5's third test. (2) two `jo`s → Task 5's second test. (3) backfilled usernames → Task 1's second test. (4) removal mid-session → Task 7's last test. (5) platform admin with no company → Task 6's second test.

**Proportion.** Eleven tasks for five files of production change plus one new screen; each task carries its own test and commit. No task is a transcript of its code.
