---
description: Orchestrate the 33-lane launch audit fleet — pre-flight, wave dispatch, cross-talk routing, verification
argument-hint: "[wave N | critical | status | verify | fix]"
---

# Launch audit — orchestrator

You are the **hub** of a 33-lane audit fleet. You do not audit; you dispatch, route
messages between lanes, hold the gates, and enforce the phase discipline.

Read first, every time:
- `docs/audit/launch-2026-09/PROTOCOL.md` — the contract every lane obeys
- `docs/audit/launch-2026-09/WAVES.md` — the schedule and the critical-path subset
- `docs/audit/launch-2026-09/SURFACE.md` — the 148-surface coverage checklist

## Argument handling

- **no argument / `status`** — `node scripts/audit-bus.mjs rollup` then `list --blockers`,
  report where the fleet is, and name the next wave.
- **`wave N`** — dispatch that wave from `WAVES.md`.
- **`critical`** — run the critical-path schedule (C1–C5) instead of the full 12 waves.
- **`verify`** — dispatch `lh-verifier` alone.
- **`fix`** — begin the FIX phase. **Only permitted after the verifier has written
  `VERDICT.md`.** Refuse otherwise and say why.

## Wave 0 — pre-flight, before any lane runs

Do this yourself, and **stop the audit if it fails**:

1. `node scripts/audit-surface.mjs` — regenerate the coverage checklist.
2. Migration drift: `supabase migration list --linked` must match on both sides.
   **Confirm which project is linked first** — `supabase/.temp/project-ref` currently
   points at *staging*, not prod.
3. `gh workflow list --all` — note anything `disabled_manually`.
4. `gh run list --branch main --limit 10` — is `main` actually green right now?
5. `npm run check:launch`.

If prod deploys are red or migrations have drifted, **stop**. Every finding downstream is
noise until the baseline is clean.

## Dispatching a wave

Launch the wave's lanes **in a single message, as parallel `Agent` calls** so they run
concurrently. Never more than 3. Each lane's own definition carries its brief — do not
restate it; pass only wave-specific context (what earlier waves found that this lane
should know).

While a wave runs:
- Do not start the next wave until all three report.
- Hold the gate: if a lane asks to run `typecheck`/`vitest`/`lint`, serialize it.
- **Route cross-talk.** When a lane reports something actionable for another,
  `node scripts/audit-bus.mjs msg --to <lane> --from <lane> --body "..."`. You are the
  hub; lanes do not negotiate scope with each other.

After each wave: `node scripts/audit-bus.mjs rollup`, commit
`docs/audit/launch-2026-09/`, and report new blockers to the user immediately —
**a launch blocker is not held until the end of the audit.**

## Phase discipline — enforce it

**SWEEP → VERIFY → FIX, strictly ordered.** During the sweep, no lane edits `src/`,
`supabase/` or `ios/`. If a lane reports having fixed something, that is a process defect:
record it, and have the verifier re-check the baseline it destroyed.

## The FIX phase

Only after `VERDICT.md` exists:
1. Blockers first, then HIGH, then MEDIUM, in the verifier's order.
2. Serialize edits to shared files — `index.css`, `AppShell.tsx`, `App.tsx`, `PageScaffold.tsx`.
3. Commit **directly to `main`**; run `npm run typecheck` (plus `npx vitest run` when
   touching tested code) locally. Run the review agents (`code-reviewer`,
   `silent-failure-hunter`, `security-auditor`) against the working diff before committing
   anything touching money, auth or the data model.
4. Removals of dead features are **migrations** — `npm run migration:new -- <slug>`,
   never a hand-typed timestamp, guarded for replay-safety, applied 3× in PGlite to prove it.
5. After each batch, `node scripts/audit-bus.mjs status <id> --set fixed --by lh-orchestrator`.

## Ping the user

Push-notify on every question and every completed wave — the user is not watching the
transcript. Use `osascript` with a sound; the push channel is silent for them.
