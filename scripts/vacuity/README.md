# `npm run vacuity` — every check shown able to fail

CLAUDE.md has always said:

> Completeness is proven, not claimed: inventory from source, minus what was
> checked, must be empty, **and every check must be shown able to fail**.

Nothing enforced the second half. It was honoured only when a human remembered
to break the code by hand. On **2026-09-19** five guards turned out to be
incapable of failing, and all five had been green for months.

## The five, and the class each belongs to

| # | What happened | Class |
|---|---|---|
| 1 | `posterConfirmationBadge.test.tsx` rendered the badge directly. Deleting the one line in `PostedJobCard.tsx` that MOUNTS it left the test green. | (b) mount-wiring |
| 2 | The edge Supabase mock recorded write filters but dropped read filters — no test could tell a seed-scoped sweep from an unscoped one. | (c) harness |
| 3 | `prepushSkipsLog.test.ts` looped over a **gitignored** log that does not exist in a fresh worktree: `[]`, zero assertions, green. | (a) empty inventory |
| 4 | Playwright's browsers were not installed. Every local nightly that reported green ran no browser. | (c) harness |
| 5 | A status-literal scan passed on the original bug: `auto-release-payment` does mention `in_progress`; it only fails on a null-timestamp conjunct. | (e) literal vs semantic |
| 6 | (Prior art, `registries-checked-against-themselves`.) A list that is both the input and the oracle cannot fail for a missing member. | (d) self-referential |

## What the gate does

Four parts, cheapest first.

1. **Ratchet** (~ms). Every `src/test/*.test.{ts,tsx}` must register a mutation
   or appear in `src/test/vacuity.baseline.json`. A **new** guard with no
   mutation fails the push. The baseline may only **shrink** — a stale entry is
   itself a failure, so it cannot rot into a permanent excuse.
2. **Static scan** (~1s). Detectors for the classes a parser can honestly
   decide: **(a)** an inventory read from the world, iterated, with no
   assertion that it is non-empty; **(d)** a list declared in the test file
   that is both input and oracle. Also reports **(b)** mount-wiring: components
   under test whose *parents* no test ever renders.
3. **Harness preflight** (~150ms). Browsers on disk vs what `playwright.config.ts`
   asks for; the tracer still wired into `src/test/setup.ts`; mock builder
   methods that are chainable no-ops while real edge functions call them.
4. **Mutation** (~0.9s per registration). Break the guarded source, run **only**
   that guard, fail if the guard stayed green.

## Registering a mutation — one line

```ts
// @mutate <file the guard protects> | <literal to find> | <what to put there>
```

`find` must occur **exactly once** in the target, or the registration itself
fails as ambiguous. `replace` may be empty (a deletion). `\n`, `\t` and `\|`
are escapes. Several `@mutate` lines are fine — each must kill the guard
independently. `// @mutate-exempt <reason>` exists, is counted, and is loud.

Worked examples: `src/test/prepushSkipsLog.test.ts`,
`src/test/shellConsistency.test.ts`, `src/test/vacuityGate.test.ts`.

## Safety in a shared tree

Other lanes edit `src/**` while this runs, so a target with uncommitted changes
is **skipped, loudly, never mutated**; original bytes are restored in `finally`,
on SIGINT/SIGTERM and on exit; and if something else wrote the file inside the
mutation window the runner **refuses to clobber it** and saves the pre-mutation
bytes to `node_modules/.vacuity-rescue-*`.

## Scope and runtime

- `npm run vacuity` — per push. Ratchet + scan + preflight + mutations for
  guards whose guard file or guarded file changed vs `origin/main`.
  **~1.4s with nothing in scope; ~7s with 7 mutations in scope.**
- `npm run vacuity:all` — nightly. Every registered mutation, ~0.9s each.
- `npm run vacuity:report` — no gate; writes `docs/audit/vacuity-report.json`.

## What it CANNOT do

- **(e) literal-scan vs semantic** is not statically decidable. Only a
  *semantic* mutation finds it, and only if someone registers one. The gate
  forces the registration; it cannot judge whether the mutation is a good one.
- **(b) mount-wiring** is reported, not gated — the import graph is resolved by
  path, so dynamic or barrel-re-exported mounts are missed.
- A mutation that is too weak still "kills" a guard and tells you nothing. The
  gate proves a guard *can* fail; it does not prove it fails for the right
  reason.
- Non-`src/test` guards (327 colocated specs, 52 under `src/test/edge`) are
  **scanned and reported but not ratcheted**. Extending the ratchet to them is
  the obvious next step.
