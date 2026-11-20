#!/usr/bin/env node
/**
 * Run a Next.js app on the port the environment names.
 *
 * ## Why this exists
 *
 * `next dev --port 3061` in `package.json` beats `PORT` in the environment, so a launcher that
 * exports a different port silently lost: the app still listened on the hard-coded one, and the
 * symptom (a bridge calling the wrong origin, or "address already in use" for a port nobody
 * mentioned) pointed somewhere else entirely. This script removes the hard-coded number from the
 * four places it used to live.
 *
 * ## Usage
 *
 *     node ../../scripts/next.ts dev   CLIENT_PORT 3061
 *     node ../../scripts/next.ts start SITE_PORT   3063
 *
 * The first argument is the command, the second the environment variable that carries the port,
 * the third the value used when that variable is unset. The variable's value is passed to Next as
 * `--port` explicitly, so `next` never falls back to its own default.
 *
 * Spawns with `stdio: 'inherit'` and forwards SIGINT/SIGTERM, so Ctrl+C behaves exactly as it does
 * with a direct `next dev`: one process group, one shutdown.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

const [command, portVar, fallback] = process.argv.slice(2);

if (command === undefined || portVar === undefined || fallback === undefined) {
  console.error('usage: node scripts/next.ts <dev|start> <PORT_ENV_VAR> <default-port>');
  process.exit(2);
}
if (command !== 'dev' && command !== 'start') {
  console.error(`unknown command "${command}": expected "dev" or "start"`);
  process.exit(2);
}

const raw = process.env[portVar] ?? fallback;
const port = Number(raw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`${portVar}="${raw}" is not a port number (1–65535). Check start/ports.env.`);
  process.exit(2);
}

/*
 * Resolve Next's own CLI from the app's directory, not this script's.
 *
 * The app declares `next` as a dependency, so `apps/<app>/node_modules/next` is the copy it would
 * have run; the workspace root has no `next` of its own (pnpm keeps it in `.pnpm`), which is why
 * resolving from here failed with "Cannot find module …\\node_modules\\next\\dist\\bin\\next".
 *
 * Spawning `process.execPath` with that file keeps one process tree, so Ctrl+C and the exit code
 * behave exactly as a direct `next dev`.
 */
const appNodeModules = join(process.cwd(), 'node_modules', 'next');
const nextBin = join(appNodeModules, 'dist', 'bin', 'next');

const child = spawn(process.execPath, [nextBin, command, '--port', String(port)], {
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
