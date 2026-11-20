import { resolveApiBaseUrl } from '@sq/contracts';
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

const API = resolveApiBaseUrl(process.env.API_BASE_URL, process.env.API_PORT);

/** What a browser component in this app may ask for. Prefixes, so a nested path needs no change. */
const ALLOWED_PREFIXES = [
  'admin/companies',
  'prices',
  'admin/enquiries',
  'admin/price-books',
  'admin/audit',
  'admin/releases',
  'admin/templates',
  // The Guest page's building types (plan admin-guest-building-types). A platform catalogue, like
  // templates, so it is listed here rather than reached through a generic `admin/*` prefix.
  'admin/guest-types',
  // Requests sent from the Guest page: the status change on one request's page.
  'admin/guest-requests',
  'admin/usage',
  'auth/session',
  'auth/password',
  /*
   * Vendor staff sign in by email on their own route: they belong to no company, so the
   * company-code + username route cannot serve them.
   */
  'auth/sign-in-platform',
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

  /*
   * The visitor's address, forwarded so the API can rate-limit by person rather than by server.
   *
   * Every request here reaches the API from this process's loopback address. Without the header, the
   * API sees one address for every vendor user — so thirty wrong passwords from anybody would lock out
   * the whole admin app. The API honours this header because this bridge is a trusted peer (see
   * `TRUST_PROXY` in `apps/api/src/config.ts`).
   */
  const clientAddress = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');

  const upstream = await fetch(`${API}/${joined}${incoming.search}`, {
    method: request.method,
    headers: {
      accept: 'application/json',
      ...(request.headers.get('origin') === null ? {} : { origin: request.headers.get('origin') as string }),
      ...(hasBody ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {}),
      ...(cookie === '' ? {} : { cookie }),
      ...(clientAddress === null || clientAddress === '' ? {} : { 'x-forwarded-for': clientAddress }),
    },
    ...(hasBody ? { body } : {}),
    cache: 'no-store',
  });

  /*
   * A download is bytes, not text. A template's `.sqd` is an attachment; reading it as UTF-8 and
   * re-encoding would corrupt it silently. Forwarded as an ArrayBuffer with the filename header.
   */
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  if (!contentType.includes('json')) {
    const file = new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { 'content-type': contentType },
    });
    for (const header of ['content-disposition', 'x-content-sha256']) {
      const value = upstream.headers.get(header);
      if (value !== null) file.headers.set(header, value);
    }
    return file;
  }

  const payload = await upstream.text();
  return new NextResponse(payload, {
    status: upstream.status,
    headers: { 'content-type': contentType },
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

/**
 * `PUT`, because a route that needs it exists.
 *
 * A Next App Router route module only accepts the methods it **exports**, and PUT was missing here
 * while `PriceOverridesPanel` had been calling it — so "Change" on `/prices` answered 405 from this
 * file and never reached the API. The API side was missing its route too; both halves are fixed
 * together, because either one alone leaves the screen doing nothing.
 */
export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  return forward(request, context);
}
