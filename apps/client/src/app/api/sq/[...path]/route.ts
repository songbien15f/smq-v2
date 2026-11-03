/**
 * The API bridge.
 *
 * The browser only ever talks to this app. A request to `/api/sq/<path>` is forwarded to the API
 * with the session cookie attached, and the answer is returned unchanged.
 *
 * ## Why a bridge rather than calling the API directly
 *
 * The API is a different origin, so every call would need `credentials: 'include'` plus a CORS
 * allow-list, and a misconfiguration of either looks like "the user is randomly signed out".
 * One bridge is one place to be right.
 *
 * ## Why the path is an allow-list
 *
 * Not because the bridge could grant anything — the API authorises every route itself, and a
 * proxy adds no privilege. It is because an unrestricted forwarder turns this app into a way to
 * probe API paths from a browser, and because an allow-list documents which endpoints the client
 * is expected to use. A path that is not listed is a request nobody designed.
 */

import { NextResponse } from 'next/server';

const API = process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';

/**
 * What the browser is allowed to ask for.
 *
 * Prefixes, so a future `/quotes/<id>/revisions` needs no change here. Everything else is
 * refused with a 404 — not a 403, so an unlisted path is indistinguishable from a missing one.
 */
const ALLOWED_PREFIXES = [
  'evaluate',
  'quotes',
  'settings',
  /*
   * The people in the company.
   *
   * This list said `members` — a route the API does not have — and not `team`, which it does. So
   * every call from the Team screen answered 404 "No such route" and the page rendered an empty
   * table that looked loaded. An allow-list is only as good as its agreement with the routes; a
   * name that matches nothing is worse than a missing entry, because it looks like coverage.
   */
  'team',
  /*
   * The price list: template download, preview and apply. The API routes live under `/admin/prices`
   * because they change every future quote's numbers, and they are gated by `price:manage` there.
   */
  'admin/prices',
  /*
   * Reading a legacy `.sqd` file. The export is a plain download link and needs no proxy entry;
   * the import posts a file, so it does.
   */
  'quotes/import',
  /*
   * Address suggestions. The Google key stays on the API; the browser only ever sees our route.
   */
  'places',
  /*
   * The template catalogue: read the list, and count a clone.
   */
  'templates',
  /*
   * ShedSafe site checks. The credentials stay on the API; the browser only sees our routes.
   */
  'quotes',
  'auth/session',
  'auth/password',
] as const;

/** True when `path` is one the client is meant to use. */
function allowed(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Forward one request. */
async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const joined = path.join('/');

  if (!allowed(joined)) {
    return NextResponse.json(
      { ok: false, code: 'not_found', message: 'No such route.' },
      { status: 404 },
    );
  }

  if (joined.includes('..')) {
    // A traversal attempt is a 404 like any other unlisted path.
    return NextResponse.json({ ok: false, code: 'not_found', message: 'No such route.' }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const cookie = request.headers.get('cookie') ?? '';

  /*
   * A body is what the *request* carries, not what its method usually carries.
   *
   * This used to be `method !== 'GET' && method !== 'HEAD'`, which sent a `content-type:
   * application/json` header on every DELETE. Fastify refuses an empty JSON body with a 400
   * (`FST_ERR_CTP_EMPTY_JSON_BODY`), so **every DELETE through this bridge failed** — revoking a
   * share link and removing a team member both answered 400 while the screen showed the reason as
   * an unexplained error. Reading the body first and forwarding the header only when there is one
   * is the fix.
   */
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
  const hasBody = body !== null && body !== '';

  const upstream = await fetch(`${API}/${joined}${incoming.search}`, {
    method: request.method,
    headers: {
      accept: 'application/json',
      // The CSRF-relevant origin travels with the request, so the API can refuse a
      // cross-origin write even though the bridge is the thing making the call.
      ...(request.headers.get('origin') === null ? {} : { origin: request.headers.get('origin') as string }),
      ...(hasBody ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {}),
      ...(cookie === '' ? {} : { cookie }),
    },
    ...(hasBody ? { body } : {}),
    cache: 'no-store',
  });

  const payload = (await upstream.text()) as string;
  const response = new NextResponse(payload, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });

  // A sign-in through this bridge must set the cookie on *this* origin, which is why the
  // Set-Cookie header is copied rather than dropped.
  for (const raw of upstream.headers.getSetCookie?.() ?? []) {
    response.headers.append('set-cookie', raw);
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

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}
