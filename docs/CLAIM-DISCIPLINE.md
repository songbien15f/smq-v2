# Claim discipline — how a "missing" claim gets made here

> Written 2026-11-06, after five wrong claims in one session.

## The pattern

Five times in one working session, I recorded a feature as blocked, impossible, or needing a new
model. All five were wrong:

| Claim | Reality |
|---|---|
| "Punchings Details needs a hole-offset table that does not exist" | All three tables — `kneeedge`, `cost_apex`, `cost_haunch` — were in the shipped book. I had not looked. |
| "R12 skylight snap is blocked: v2 anchors by bay, the desktop by span" | `Roof.Width` **is** `Plan.Length` (`Roof.cs:64`). Both anchor on the length axis. The axes always agreed. |
| "R9 needs two empty side walls, and the desktop's wording is vague" | `AddMezzamineRule:130-200` is a **height** test: a slab over a door. Nothing about emptiness. |
| "R6's second half needs track as a positioned object" | The desktop charges nothing for track — every `DOOR_TRACK` line is commented out (`SLDQuote.cs:552,581,612,632`) and the only live producer's call site is too (`:781`). The rule guards a feature that does not exist. |
| "The roller-door column/header punch sheets need a model this build lacks" | The model existed from the same commit series that supposedly lacked it. |

Every one had the same cause: **I trusted an earlier note instead of opening the source.** The notes
were mine, written under the same habit, so trusting them compounded the error rather than correcting
it.

## The rule

Before a feature is recorded as blocked, missing, or needing a new model, all three of these must
have been done **in this session**, and the note must cite what they returned:

1. **Check the price book.** `data/price-books/<hash>.db` — list the tables and the columns of the
   one that sounds relevant. Twenty-two screens' worth of "impossible" turned out to be a column
   nobody had selected.
2. **Open the desktop method.** `D:\Docs\OS.mr.Thi\smq-code-smartquote` — read the rule or the BOM
   function itself, not a summary of it. Quote the file and line in the note.
3. **Search for what is commented out.** The desktop carries a lot of dead code, and dead code looks
   like a feature. A `//MaterialItem …` line is not a priced material. Before porting a rule that
   guards something, confirm the something is charged for.

If any of the three has not been done, the honest note is **"not yet checked"**, not "blocked".
Those are different claims and only one of them is a reason to stop.

## What "not yet checked" looks like in a doc

    State: **not yet checked.** Reading `X` is the next step; nobody has opened it.

Not:

    State: blocked — needs a model for Y.

The second sentence has ended work that the first one would have started.

## Where claims live, and which file wins

| File | Claim it may make | Trust it? |
|---|---|---|
| `smartquote-quote-editor-reference.md` | The live state of the editor: rules, BOM, documents | **Yes** — corrected as work lands, in the same commit |
| `KNOWN-DEVIATIONS.md` | Deliberate differences from the desktop | **Yes** — a row is a decision, not a gap |
| `FEATURE-COVERAGE.md` | A wide survey, measured 2026-11-01 | **Partly** — four claims were wrong on re-check; each is marked inline |
| `PLAN-REMAINING.md`, `docs/superpowers/plans/*` | What somebody *intended* to do | **No** — a plan is not evidence. Check the code. |

**A plan is not an inventory.** The single most expensive mistake in this project was treating a
task list as a description of the code. When the two disagree, the code wins and the plan gets
corrected.

## For an agent picking this up

If a doc says something is blocked or missing:

1. Treat it as a **hypothesis**.
2. Run the three checks above.
3. Correct the doc **in the same commit** as whatever you build, and say plainly that the earlier
   claim was wrong. Do not quietly delete it — the next reader needs to know the note was wrong once,
   or they will trust the next one too.
