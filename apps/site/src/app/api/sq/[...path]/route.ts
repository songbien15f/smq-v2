/**
 * The site's API bridge (plan G-a P7), for the public Guest quote page.
 *
 * A trimmed copy of the client's bridge (`apps/client/src/app/api/sq/[...path]/route.ts`): the browser
 * calls `/api/sq/<path>` on this origin and the request is forwarded to the API. Three differences:
 *
 * 1. **Only the Guest page's public routes are listed.** A guest has no account, so nothing here
 *    needs a session, and an unrestricted forwarder on a public site would be a way to probe API paths
 *    from any browser. An unlisted path is a 404, indistinguishable from a missing one.
 * 2. **Two cookies only, both ways: the assistant's `sq_ga` and the optional guest account's
 *    `sq_guest`.** If a visitor is also signed in to the editor on this host, that session cookie must
 *    not travel to a public route by accident, so everything else is dropped. `sq_ga` is the assistant's conversation: the
 *    API reads the earlier turns from it and attaches the transcript to the sent request. Without it,
 *    every message started a new conversation — the assistant asked "roller or PA door?", the answer
 *    "roller" arrived with no question before it, and nothing was added (seen 2026-11-20).
 * 3. **JSON only.** GET and POST, plus PATCH/PUT/DELETE for the guest account's profile and drafts.
 *
 * The enquiry form on `/` still posts to the API directly; moving it here is not part of G-a.
 */

import { resolveApiBaseUrl } from '@sq/contracts';
import { NextResponse } from 'next/server';

const API = resolveApiBaseUrl(process.env.API_BASE_URL, process.env.API_PORT);

/** `public/guest/*` (types, places, suburbs) and `public/guest-requests` (tab ④). */
const ALLOWED_PREFIXES = ['public/guest', 'public/guest-requests'] as const;

function allowed(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** `ASSISTANT_COOKIE` in `apps/api/src/lib/guestAssistant.ts`; the API alone decides what it holds. */
const ASSISTANT_COOKIE = 'sq_ga';

/** `GUEST_ACCOUNT_COOKIE` in `apps/api/src/lib/guestAccount.ts` (docs/specs/guest-accounts.md). */
const GUEST_ACCOUNT_COOKIE = 'sq_guest';
const FORWARDED_COOKIES: readonly string[] = [ASSISTANT_COOKIE, GUEST_ACCOUNT_COOKIE];

/** The forwarded cookies from the browser's Cookie header, or `null`. Every other cookie stays here. */
function forwardedCookies(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  const kept: string[] = [];
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== undefined && FORWARDED_COOKIES.includes(name) && rest.length > 0) kept.push(`${name}=${rest.join('=')}`);
  }
  return kept.length === 0 ? null : kept.join('; ');
}

function notFound(): NextResponse {
  return NextResponse.json({ ok: false, code: 'not_found', message: 'No such route.' }, { status: 404 });
}

async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const joined = path.join('/');
  if (joined.includes('..') || !allowed(joined)) return notFound();

  const incoming = new URL(request.url);
  const body = request.method === 'GET' ? null : await request.text();
  const hasBody = body !== null && body !== '';

  /*
   * The visitor's address, so the API's per-address limits count visitors and not this bridge.
   * The API honours the header only because this bridge connects from a peer `TRUST_PROXY` trusts
   * (`apps/api/src/config.ts`); a direct caller's header is ignored.
   */
  const clientAddress = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  const origin = request.headers.get('origin');
  const cookie = forwardedCookies(request);

  let upstream: Response;
  try {
    upstream = await fetch(`${API}/${joined}${incoming.search}`, {
      method: request.method,
      headers: {
        accept: 'application/json',
        ...(origin === null ? {} : { origin }),
        ...(hasBody ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {}),
        ...(clientAddress === null || clientAddress === '' ? {} : { 'x-forwarded-for': clientAddress }),
        ...(cookie === null ? {} : { cookie }),
      },
      ...(hasBody ? { body } : {}),
      cache: 'no-store',
    });
  } catch {
    // The API is down or restarting. The page shows this sentence and offers to retry.
    return NextResponse.json(
      { ok: false, code: 'upstream_failed', message: 'The quote service is not answering. Please try again in a moment.' },
      { status: 503 },
    );
  }

  const response = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
  for (const setCookie of upstream.headers.getSetCookie()) {
    if (FORWARDED_COOKIES.some((name) => setCookie.startsWith(`${name}=`))) {
      response.headers.append('set-cookie', setCookie);
    }
  }
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}
