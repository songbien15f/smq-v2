import 'dotenv/config'

import { spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Nightly-style local backup: one timestamped folder per run containing a
 * custom-format PostgreSQL dump plus a copy of the uploads.
 *
 *   backups/2026-11-19T05-48-12-345Z/
 *     smartcoa.dump   pg_dump --format=custom
 *     media/          recursive copy of media/
 *
 * Folders older than 14 days are pruned at the end of a successful run.
 *
 * Run with `npm run backup`. Any failure (a missing pg_dump binary, a failed
 * dump, an unreachable database) exits non-zero so cron/Task Scheduler and CI
 * notice it.
 */

const RETAIN_DAYS = 14

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backupsRoot = path.join(projectRoot, 'backups')
const mediaSource = path.join(projectRoot, 'media')

const isWindows = process.platform === 'win32'
const pgDumpName = isWindows ? 'pg_dump.exe' : 'pg_dump'

const fail = (message: string): never => {
  console.error(`[backup] ${message}`)
  process.exit(1)
}

const isExecutableFile = async (candidate: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(candidate)
    if (!stats.isFile()) return false
    await fs.access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** True when a bare command name (no path) is resolvable on PATH. */
const resolvesOnPath = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = spawn(command, ['--version'], { stdio: 'ignore', shell: false })
    probe.on('error', () => resolve(false))
    probe.on('close', (code) => resolve(code === 0))
  })

/**
 * Locate pg_dump.
 *
 * Windows installers do not add `C:\Program Files\PostgreSQL\<n>\bin` to PATH,
 * so a plain `pg_dump` spawn fails there even though the server is running.
 * Resolution order:
 *   1. `PG_BIN` — either the pg_dump executable itself or its bin directory.
 *   2. The known PostgreSQL 18 install path.
 *   3. The Windows / Unix PATH.
 */
const resolvePgDump = async (): Promise<string> => {
  const configured = process.env.PG_BIN?.trim()

  if (configured) {
    const asFile = path.resolve(configured)
    if (await isExecutableFile(asFile)) return asFile

    const asDir = await isExecutableFile(path.join(asFile, pgDumpName))
    if (asDir) return path.join(asFile, pgDumpName)

    fail(
      `PG_BIN is set to "${configured}" but it is neither a ${pgDumpName} executable nor a ` +
        `PostgreSQL bin directory containing one. Point PG_BIN at the bin directory, ` +
        `e.g. C:\\Program Files\\PostgreSQL\\18\\bin`,
    )
  }

  if (isWindows) {
    const knownBins = [
      'C:\\Program Files\\PostgreSQL\\18\\bin',
      'C:\\Program Files\\PostgreSQL\\17\\bin',
      'C:\\Program Files\\PostgreSQL\\16\\bin',
    ]

    for (const binDir of knownBins) {
      const candidate = path.join(binDir, pgDumpName)
      if (await isExecutableFile(candidate)) {
        console.log(`[backup] using pg_dump found at ${candidate}`)
        return candidate
      }
    }
  }

  if (await resolvesOnPath('pg_dump')) {
    console.log('[backup] using pg_dump from PATH')
    return 'pg_dump'
  }

  return fail(
    'pg_dump was not found. Install PostgreSQL client tools, add their bin directory to ' +
      'PATH, or set PG_BIN to the PostgreSQL bin directory ' +
      '(for example PG_BIN="C:\\Program Files\\PostgreSQL\\18\\bin").',
  )
}

const connectionString = process.env.DATABASE_URI?.trim() ?? ''

if (!connectionString) {
  fail('DATABASE_URI is not set. Copy .env.example to .env and fill it in.')
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = path.join(backupsRoot, timestamp)
const dumpTarget = path.join(backupDir, 'smartcoa.dump')

const runPgDump = (pgDump: string, target: string): Promise<void> =>
  new Promise((resolve, reject) => {
    // Arguments are passed as an array, so the connection string is never
    // re-parsed by a shell (Windows MySQL-style quoting bugs do not apply).
    const child = spawn(
      pgDump,
      ['--format=custom', `--file=${target}`, connectionString],
      { stdio: ['ignore', 'inherit', 'inherit'], shell: false },
    )

    child.on('error', (error) => reject(error))
    child.on('close', (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`pg_dump exited with ${code ?? signal}`))
    })
  })

const copyMedia = async (destination: string): Promise<number> => {
  try {
    const stats = await fs.stat(mediaSource)
    if (!stats.isDirectory()) throw new Error('media is not a directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // A fresh install with no uploads yet: still create the folder so the
      // backup shape is identical every night and restore scripts stay simple.
      await fs.mkdir(destination, { recursive: true })
      console.log('[backup] media/ does not exist yet; wrote an empty media folder')
      return 0
    }
    throw error
  }

  await fs.cp(mediaSource, destination, { recursive: true })
  const entries = await fs.readdir(destination)
  return entries.length
}

/** Delete backup folders older than RETAIN_DAYS, by directory mtime. */
const pruneOldBackups = async (): Promise<string[]> => {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
  const removed: string[] = []

  let entries: string[]
  try {
    entries = await fs.readdir(backupsRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return removed
    throw error
  }

  for (const entry of entries) {
    if (entry === timestamp) continue
    const entryPath = path.join(backupsRoot, entry)

    try {
      const stats = await fs.stat(entryPath)
      if (!stats.isDirectory()) continue
      if (stats.mtimeMs >= cutoff) continue

      await fs.rm(entryPath, { recursive: true, force: true })
      removed.push(entry)
    } catch (error) {
      // One unreadable folder must not fail the whole run: the new backup is
      // already on disk and is the part that matters.
      console.warn(`[backup] could not prune ${entryPath}:`, error)
    }
  }

  return removed
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const main = async (): Promise<void> => {
  const pgDump = await resolvePgDump()

  await fs.mkdir(backupDir, { recursive: true })
  console.log(`[backup] writing to ${backupDir}`)

  try {
    await runPgDump(pgDump, dumpTarget)
  } catch (error) {
    // Do not leave a half-written dump (or an empty run folder) behind that
    // could be mistaken for a valid backup.
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
    fail(
      `pg_dump failed (${error instanceof Error ? error.message : String(error)}). ` +
        `Database: ${connectionString.replace(/:\/\/([^:@]+)(:[^@]*)?@/, '://$1:***@')}`,
    )
  }

  const dumpStats = await fs.stat(dumpTarget)
  if (dumpStats.size === 0) {
    await fs.rm(backupDir, { recursive: true, force: true })
    fail('pg_dump produced an empty dump file')
  }

  const mediaEntries = await copyMedia(path.join(backupDir, 'media'))
  const removed = await pruneOldBackups()

  console.log(`[backup] dump     ${dumpTarget} (${formatBytes(dumpStats.size)})`)
  console.log(`[backup] media    ${mediaEntries} top-level entries copied`)
  console.log(
    `[backup] pruned   ${removed.length === 0 ? 'nothing older than ' + RETAIN_DAYS + ' days' : removed.join(', ')}`,
  )

  const restoreHint = isWindows
    ? '"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore"'
    : 'pg_restore'
  console.log(
    `[backup] restore with: ${restoreHint} --clean --if-exists --dbname "$DATABASE_URI" "${dumpTarget}"`,
  )
  console.log('[backup] done')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
