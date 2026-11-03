#!/usr/bin/env bash
#
# Dump the SmartQuote desktop price database to JSON.
#
# Usage:  bash tools/price-dump/run.sh /path/to/SmartQuote [outDir]
#
# The desktop app's price database (`Jz62L4.dll`) is a SQLCipher file. Node cannot
# open it — the SQLCipher variant that System.Data.SQLite 1.0.107 writes does not
# match what any JS driver implements — so this uses the same driver the desktop
# uses, compiled with the .NET Framework compiler that ships with Windows.
#
# Prerequisites:
#   - Windows with .NET Framework 4.x (csc.exe at
#     C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe)
#   - PRICE_DB_PASSWORD in the environment
#
set -euo pipefail

APP_DIR="${1:-}"
OUT_DIR="${2:-}"

if [ -z "$APP_DIR" ]; then
  echo "usage: bash tools/price-dump/run.sh /path/to/SmartQuote [outDir]" >&2
  exit 1
fi

if [ -z "${PRICE_DB_PASSWORD:-}" ]; then
  echo "PRICE_DB_PASSWORD is not set. See tools/price-dump/README.md." >&2
  exit 2
fi

DB="$APP_DIR/Jz62L4.dll"
CSC="/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe"

# The app directory holds the database but not always the driver: a source
# checkout has `System.Data.SQLite.dll` and `SQLite.Interop.dll` under the build
# output beside it. Look in the app directory first, then in the sibling build
# directory, so one script works for both an installed copy and a checkout.
find_asset() {
  local name="$1"
  for candidate in \
    "$APP_DIR/$name" \
    "$APP_DIR/../SmartQuote.Build/App/$name" \
    "$APP_DIR/../SmartQuote.Db/bin/Release/$name"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

SQLITE_DLL="$(find_asset System.Data.SQLite.dll || true)"
INTEROP_X64="$(find_asset x64/SQLite.Interop.dll || true)"
INTEROP_X86="$(find_asset x86/SQLite.Interop.dll || true)"

if [ ! -f "$DB" ]; then
  echo "missing: $DB" >&2
  exit 3
fi
if [ -z "$SQLITE_DLL" ]; then
  echo "missing: System.Data.SQLite.dll under $APP_DIR or its build directory" >&2
  exit 3
fi
if [ -z "$INTEROP_X64" ] && [ -z "$INTEROP_X86" ]; then
  echo "missing: SQLite.Interop.dll under x64 or x86" >&2
  exit 3
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/x64" "$WORK/x86"
cp "$DB" "$WORK/price.db"
cp "$SQLITE_DLL" "$WORK/"
[ -n "$INTEROP_X64" ] && cp "$INTEROP_X64" "$WORK/x64/"
[ -n "$INTEROP_X86" ] && cp "$INTEROP_X86" "$WORK/x86/"
cp "$(dirname "$0")/DumpAll.cs" "$WORK/"

# MSYS_NO_PATHCONV stops Git Bash turning /nologo into a path. The compile runs
# inside $WORK so csc.exe resolves the source and the reference by relative name.
(cd "$WORK" && MSYS_NO_PATHCONV=1 "$CSC" /nologo /platform:x64 \
  /r:System.Data.SQLite.dll /out:DumpAll.exe DumpAll.cs)

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$(dirname "$0")/out"
fi
mkdir -p "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" && pwd)"

(cd "$WORK" && ./DumpAll.exe "$OUT_ABS")

echo "--- summary ---"
if grep -q "ERROR" "$OUT_DIR/_summary.tsv"; then
  echo "FAILED: the dump reported errors:" >&2
  grep "ERROR" "$OUT_DIR/_summary.tsv" >&2
  exit 4
fi
awk -F'\t' '{ rows += $3 } END { printf "%d objects, %d rows\n", NR, rows }' "$OUT_DIR/_summary.tsv"
