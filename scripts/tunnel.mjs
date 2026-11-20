#!/usr/bin/env node
/**
 * Public links for a QA session, through Cloudflare's quick tunnels.
 *
 * ## What it does
 *
 * Starts one `cloudflared tunnel --url http://localhost:<port>` per service, waits for each to print
 * its `https://<something>.trycloudflare.com` address, and writes them to
 * `start/tunnel-urls.txt` plus a short table on stdout. Ctrl+C closes every tunnel.
 *
 * ## Why the API needs the addresses
 *
 * The tunnel is a reverse proxy: a browser on the public link talks to **Cloudflare**, which forwards
 * to the front-end on localhost. So the `Origin` header the API sees is the *public* host, not
 * `localhost:3061`. The API's CORS allow-list is explicit (never a wildcard with credentials), and
 * the front-ends' own `allowedDevOrigins` decides whether Next serves its dev assets to that host.
 * Both therefore have to learn the tunnel host **before** the services start or reload — which is
 * why this script prints the values instead of quietly starting tunnels behind a running server.
 *
 * ## Usage
 *
 *     node scripts/tunnel.mjs                 # every service
 *     node scripts/tunnel.mjs site client     # only these
 *
 * then, in the shell that runs `pnpm dev` (see the printed block):
 *
 *     set CLIENT_ORIGIN=https://….trycloudflare.com
 *     set SITE_ORIGIN=https://….trycloudflare.com
 *     set GUEST_PLACES_SESSION_SECRET=…       (a real secret; see below)
 *     pnpm dev
 *
 * ## What a tunnel exposes
 *
 * Everything the chosen service serves, to anyone with the link. Quick tunnels have no access
 * control of their own. For QA of the public Guest page (`apps/site`) that is the point. Tunnelling
 * the **client** or **admin** app puts a sign-in screen on the public internet, reachable by
 * password-guessing from anywhere — that is a decision, not a default, and `start/tunnel.bat` says so
 * before it starts one.
 *
 * `cloudflared` must be installed (`winget install Cloudflare.cloudflared`).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Which service each name means, and the port variable that carries it. */
const SERVICES = {
  api: { portVar: 'API_PORT', defaultPort: 3060, label: 'API' },
  client: { portVar: 'CLIENT_PORT', defaultPort: 3061, label: 'Client (sign-in required)' },
  admin: { portVar: 'ADMIN_PORT', defaultPort: 3062, label: 'Admin (sign-in required)' },
  site: { portVar: 'SITE_PORT', defaultPort: 3063, label: 'Site (public)' },
};

/** `start/ports.env`, so the tunnels point at the ports actually in use. */
function readPorts() {
  const file = join(root, 'start', 'ports.env');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)\s*=\s*(\S+)\s*$/.exec(line);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const names = requested.length > 0 ? requested : Object.keys(SERVICES);
for (const name of names) {
  if (!(name in SERVICES)) {
    console.error(`unknown service "${name}": expected one of ${Object.keys(SERVICES).join(', ')}`);
    process.exit(2);
  }
}

const ports = { ...readPorts(), ...process.env };
const QUICK_TUNNEL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const children = [];

/** Start one tunnel and resolve with what it printed, or reject after `timeoutMs`. */
function tunnel(name) {
  const { portVar, defaultPort, label } = SERVICES[name];
  const port = Number(ports[portVar] ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`${portVar}="${ports[portVar]}" is not a port number`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // `cloudflared` writes its banner to stderr on most builds, the address to either.
      windowsHide: true,
    });
    children.push(child);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${label} on ${port}: no public address after 45 s (is the service running?)`));
    }, 45_000);

    const scan = (chunk) => {
      if (settled) return;
      const text = chunk.toString();
      const m = QUICK_TUNNEL.exec(text);
      if (m === null) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name, label, port, url: m[0] });
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        error.code === 'ENOENT'
          ? new Error('cloudflared is not installed or not on PATH. Install it with: winget install Cloudflare.cloudflared')
          : error,
      );
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${label} tunnel exited with code ${code} before printing an address`));
    });
  });
}

function shutdown() {
  for (const child of children) child.kill();
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

try {
  const results = await Promise.all(names.map(tunnel));

  const lines = results.map((r) => `${r.name.padEnd(7)} ${r.label.padEnd(26)} ${r.url}  →  localhost:${r.port}`);
  const byName = Object.fromEntries(results.map((r) => [r.name, r.url]));

  const env = [
    byName.client === undefined ? null : `set CLIENT_ORIGIN=${byName.client}`,
    byName.site === undefined ? null : `set SITE_ORIGIN=${byName.site}`,
    byName.admin === undefined ? null : `set ADMIN_ORIGIN=${byName.admin}`,
    // The Guest page's address search signs a three-minute session with this. A tunnel is not a
    // private machine any more, so a real 32+ character value is required; `GUEST_PLACES_ENABLED=1`
    // without one makes the API refuse at boot rather than sign with a throwaway secret.
    byName.site === undefined ? null : 'set GUEST_PLACES_SESSION_SECRET=<32+ random characters>',
  ].filter((line) => line !== null);

  const output = [
    'Public links (Cloudflare quick tunnels):',
    '',
    ...lines.map((line) => `  ${line}`),
    '',
    'Restart the services with these in the same shell, or the API refuses the public origin:',
    '',
    ...env.map((line) => `  ${line}`),
    '  pnpm dev',
    '',
    byName.client === undefined && byName.admin === undefined
      ? 'Only the public site is tunnelled.'
      : 'A tunnelled client/admin app puts a sign-in screen on the public internet. Anyone with the link can try passwords.',
    '',
    'Links stop working when this window closes or the tunnels restart (quick tunnels are not stable).',
  ].join('\n');

  console.log(`\n${output}\n`);

  const outFile = join(root, 'start', 'tunnel-urls.txt');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    [
      `# Public links for the QA session that started ${new Date().toISOString()}`,
      '# These change every time the tunnels restart. Not a secret, but not yours to publish either.',
      ...results.map((r) => `${r.name}=${r.url}`),
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`Written to ${outFile}. Ctrl+C here closes every tunnel.\n`);

  // Keep the process (and its children) alive until Ctrl+C.
  await new Promise(() => {});
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  shutdown();
  process.exit(1);
}
