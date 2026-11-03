# Price book dumper

Reads the SmartQuote desktop's price database and writes one JSON file per table,
for the web app's importer.

## Why this exists

The desktop ships its prices in `Jz62L4.dll` — a **SQLCipher** database, not a
plain SQLite file. Node cannot open it: the SQLCipher variant that
`System.Data.SQLite` 1.0.107 writes does not match any JS driver's implementation,
and the key-derivation attempts that work elsewhere fail here.

So the dump runs on Windows, with the same driver the desktop uses, and hands the
result to the web app as plain JSON. This is a **setup tool**, not part of the app
bundle: it runs once per price update, on a machine that has the desktop installed.

## Prerequisites

- Windows with .NET Framework 4.x (`csc.exe` under
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`).
- A SmartQuote desktop install: the script needs `Jz62L4.dll`,
  `System.Data.SQLite.dll`, and `x64/SQLite.Interop.dll` from its directory.
- The database password in `PRICE_DB_PASSWORD`. It is in the desktop source at
  `Layer/Repository/Config/SmartQuote.Repository.Config.Provider/RepositoryConfig.cs`.
  It is **not** in this repository, because it protects a licensed price book.

## Run

```bash
export PRICE_DB_PASSWORD='...'
bash tools/price-dump/run.sh "/d/Docs/OS.mr.Thi/smq-code-smartquote/App/SmartQuote"
```

Optional second argument: the output directory (default `tools/price-dump/out`).

Expected output ends with:

```
DONE 75 objects -> /…/tools/price-dump/out
--- summary ---
75 objects, 31548 rows
```

If the dump hits an error it prints the failing table and exits non-zero, so a
partial dump cannot be imported by accident.

## Output

- `out/<table>.json` — a JSON array, one object per row, keys in column order.
- `out/_summary.tsv` — `name<TAB>type<TAB>rowCount`.

`out/` is git-ignored: it is generated from a licensed database.

## Then

Import it into the app:

```bash
npx tsx scripts/import-price-book.ts tools/price-dump/out
```

That writes `data/pricing.db`. Re-run both after a price update.

## Notes

- The price database is read-only here: the dumper never writes to `price.db`.
- `country_surburb` is the largest table (16 741 rows) and is not needed for
  quoting; the importer loads it anyway so address lookup works later.
- If the desktop's password changes, only `PRICE_DB_PASSWORD` changes — no code.
