# Brand artwork

`Logo.ico` — the master icon, eight sizes from 32×32 to 256×256 (4bpp, 8bpp and 32bpp variants plus two
256×256 PNG entries). It is the source; the apps do not read it.

## What each app serves

| File | Where | Why |
|---|---|---|
| `favicon.ico` | `apps/{client,admin,site}/public/` | a copy of `Logo.ico`. Each Next app is its own web root, so each needs its own copy — there is no shared `/public` |
| `logo.png` | `apps/{client,admin,site}/public/` | 512×512, the in-app mark and the `apple-touch-icon` |

`logo.png` is also what the document renderer reads through `LOGO_FILE`, so a customer's PDF, the tab
icon and the mark in the navy bar are one image rather than three that drift.

## When the artwork changes

1. Replace `Logo.ico` here.
2. Copy it to each app: `for a in client admin site; do cp tools/branding/Logo.ico apps/$a/public/favicon.ico; done`
3. Replace each `apps/*/public/logo.png` with the 512×512 PNG.
4. Re-run the PDF golden test — the document freezes a `logoHash` per revision, and a changed image
   means revisions after this one carry a different hash. That is correct, not a failure.

**The mark carries its own white plate** (41.9% of its pixels are white, 4% transparent at the rounded
corners). It reads on the navy bar because of that plate — do not swap in a transparent-only version
without re-checking it against `--color-sq-brand`.
