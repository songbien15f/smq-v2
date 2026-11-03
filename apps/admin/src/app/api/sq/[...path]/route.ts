import { NextResponse } from 'next/server';

/**
 * The admin app's bridge to the API.
 *
 * ## Why an allow-list rather than forwarding everything
 *
 * The session cookie is HttpOnly and same-origin, so a browser component cannot call the API
 * directly. This route is the one place a browser request becomes an API request, and the list
 * below is what it may become. Forwarding any path would turn this app into an open proxy for the
 * whole API under the operator's session — the same mistake the client app's bridge exists to avoid.
 *
 * ## Why the body is read before the header is set
 *
 * A body-less DELETE with `content-type: application/json` is refused by Fastify with a 400
 * (`FST_ERR_CTP_EMPTY_JSON_BODY`). The client app's bridge had exactly that bug and every DELETE
 * through it failed; the header is forwarded here only when a body actually exists.
 */

const API = process.env.API_BASE_URL ?? 'http://localhost:3060/api/v1';

/** What a browser component in this app may ask for. Prefixes, so a nested path needs no change. */
const ALLOWED_PREFIXES = [
  'admin/companies',
  'prices',
  'admin/enquiries',
  'admin/price-books',
  'admin/audit',
  'admin/releases',
  'admin/templates',
  'admin/usage',
  'auth/session',
  'auth/password',
] as const;

function allowed(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const joined = path.join('/');

  // A traversal attempt is a 404 like any other unlisted path.
  if (!allowed(joined) || joined.includes('..')) {
    return NextResponse.json({ ok: false, code: 'not_found', message: 'No such route.' }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const cookie = request.headers.get('cookie') ?? '';
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
  const hasBody = body !== null && body !== '';

  const upstream = await fetch(`${API}/${joined}${incoming.search}`, {
    method: request.method,
    headers: {
      accept: 'application/json',
      ...(request.headers.get('origin') === null ? {} : { origin: request.headers.get('origin') as string }),
      ...(hasBody ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {}),
      ...(cookie === '' ? {} : { cookie }),
    },
    ...(hasBody ? { body } : {}),
    cache: 'no-store',
  });

  const payload = await upstream.text();
  return new NextResponse(payload, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
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
