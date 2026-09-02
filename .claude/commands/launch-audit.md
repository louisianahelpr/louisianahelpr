---
description: Orchestrate the 39-lane launch audit fleet — pre-flight, wave dispatch, cross-talk routing, verification
argument-hint: "[wave N | critical | status | verify | fix]"
---

# Launch audit — orchestrator

You are the **hub** of a 39-lane audit fleet. You do not audit; you dispatch, route
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
6. **Reconcile `docs/audit/OPEN_ITEMS.md` against `main` before dispatching anything.**
   Compare its last stamp to what has actually shipped:

   ```sh
   LAST=$(git log -1 --format=%H -- docs/audit/OPEN_ITEMS.md)
   git log --oneline $LAST..origin/main -- src/ supabase/
   ```

   Every commit that prints is work the ledger does not know about. Walk them, close what
   they closed, and re-stamp. **A non-empty list is a STOP.**

If prod deploys are red, migrations have drifted, or the ledger is stale, **stop**. Every
finding downstream is noise until the baseline is clean.

**Why step 6 outranks the rest.** A stale ledger does not merely waste a wave — it makes
the audit produce the exact outcome it exists to prevent. Measured 2026-09-02: a session
working the then-current list found that **three of its first four findings were already
fixed**, a 1-in-4 hit rate. Dispatch 39 lanes against a list in that state and most of them
re-derive closed work and file it again, which reads as "the audit found 200 things" and
means nothing. That is the "no audit ever fixes anything" complaint, manufactured. Refresh
first — it is cheaper than one wave and it is the difference between a report and noise.

## Dispatching a wave

Launch the wave's lanes **in a single message, as parallel `Agent` calls** so they run
concurrently. **There is no fixed cap** — the old "never more than 3" was lifted by the
owner on 2026-09-02. Launch the whole wave at once; the waves are already grouped so
their lanes do not contend. What you must NOT do is merge two waves, or let two lanes
run a gate at the same time (see below) — the real ceiling is the serialized gate, not
an agent count. Each lane's own definition carries its brief — do not restate it; pass
only wave-specific context (what earlier waves found that this lane should know).

**Always pass `name:` set to the lane's own id** (`name: "lh-money-escrow"`,
`subagent_type: "lh-money-escrow"`). The `name` is what promotes a spawn from an
anonymous subagent into an addressable **teammate**: it registers in
`~/.claude/teams/session-<id>/config.json`, shows up in `ListAgents`, and becomes a
valid `SendMessage` target for the rest of the session. A lane spawned without `name`
is unreachable — you can read its final report and nothing else, which breaks routing
and the plan gate below.

While a wave runs:
- Do not start the next wave until every lane in this one reports.
- **`idle` in `ListAgents` does NOT mean the lane reported.** Measured 2026-09-02:
  four agents were dispatched, three went idle without their report ever arriving,
  and a follow-up `SendMessage` to an idle agent produced no reply either. If you
  treat idle as done you will silently lose entire lanes' findings and never know
  which ones — the fleet will look like it ran.
  **So: the bus is the source of truth, not the report.** Before closing a wave, run
  `node scripts/audit-bus.mjs list --agent <lane>` for each lane in it. A lane that
  filed nothing either found nothing or never ran, and those are very different — ask
  it, and if it stays silent, **re-dispatch it and say so in the final report**. Never
  record an un-reporting lane as covered.
- Hold the gate: if a lane asks to run `typecheck`/`vitest`/`lint`, serialize it.
- **Route cross-talk over `SendMessage`.** When a lane reports something actionable for
  another, relay it yourself: `SendMessage({to: "lh-silent-failure", message: "..."})`
  — you address a lane by the `name:` you spawned it with. Lanes address YOU as
  **`team-lead`**, not `lh-orchestrator`, which is not an agent and never was.
  You are the hub; lanes do not message each other directly and do not negotiate scope
  between themselves. Native messaging replaced `audit-bus.mjs msg` because a lane
  actually receives a `SendMessage` mid-run, whereas a file-bus message only landed if
  someone thought to poll for it.
  The bus keeps everything else — `file`, `status`, `dupe`, `list`, `rollup` are the
  durable findings ledger and are **unchanged**. Findings go in the bus; conversation
  goes over `SendMessage`.

After each wave: `node scripts/audit-bus.mjs rollup`, commit
`docs/audit/launch-2026-09/`, and report new blockers to the user immediately —
**a launch blocker is not held until the end of the audit.**

## Phase discipline — enforce it

**SWEEP → VERIFY → FIX, strictly ordered.** During the sweep, no lane edits `src/`,
`supabase/` or `ios/` — and as of the teams wiring this is **enforced, not requested**:
all 35 read-only lanes carry `permissionMode: plan` in their frontmatter, so the harness
refuses their edits outright.

That makes you the release valve. A gated lane that wants to fix something sends you a
`plan_approval_request`; you answer with a `plan_approval_response` naming its
`request_id`:

```json
{"to": "lh-money-escrow",
 "message": {"type": "plan_approval_response", "request_id": "...", "approve": false,
             "feedback": "sweep phase — file it through the bus; VERDICT.md does not exist yet"}}
```

**Two kinds of request arrive, and conflating them deadlocks the entire fleet.** A
plan-gated lane must ask before *any* lasting change, and almost none of those are the
thing you are guarding. All 35 gated lanes drive a browser or run a build — every one of
them will ask you for things like:

- `git worktree add ~/.lh-audit/<lane>` (step 3 — the isolation the sweep depends on)
- launching a dev/preview server, `npm run build`, `npx playwright install webkit`
- Chrome/WebKit navigation, clicks and screenshots
- `xcrun simctl` for the iOS simulator
- read-only SQL through the Supabase MCP, `gh` reads

**Approve all of that on sight.** It is how the lane audits anything at all. "Reject every
plan" applied literally stalls 35 lanes at setup and is not phase discipline, it is a
deadlock you caused.

**What you are guarding is exactly one thing: edits to `src/`, `supabase/` or `ios/`** —
the repo files whose baseline `lh-verifier` needs intact. Gate those and nothing else.

**Reject every plan that touches those until `VERDICT.md` exists.** Approving one drops that lane out of plan
mode and into edit access, which is precisely the phase boundary you are guarding. Three
lanes are deliberately ungated because their work *is* mutation — `lh-e2e-journeys`,
`lh-input-boundary`, `lh-state-matrix` — plus `lh-verifier`, which must reproduce freely.
For those four the old rule still holds by discipline alone: if one reports having fixed
something during the sweep, that is a process defect — record it, and have the verifier
re-check the baseline it destroyed.

## The FIX phase

Only after `VERDICT.md` exists:
0. Release the lanes you need: approve the `plan_approval_request` from each lane you are
   putting to work, in the verifier's order. A lane stays in plan mode — and stays
   harmless — until you approve it, so release them in the same batches you serialize.
1. Blockers first, then HIGH, then MEDIUM, in the verifier's order.
2. Serialize edits to shared files — `index.css`, `AppShell.tsx`, `App.tsx`, `PageScaffold.tsx`.
3. Commit **directly to `main`**; run `npm run typecheck` (plus `npx vitest run` when
   touching tested code) locally. Run `lh-silent-failure`, `lh-authz-rls` and `lh-money-escrow` (dispatched REVIEW-ONLY) against the working diff before
   committing anything touching money, auth or the data model. The agents this line used to name — `code-reviewer`, `silent-failure-hunter`, `security-auditor` — DO NOT EXIST; the spawn fails, so the guard silently never ran.
4. Removals of dead features are **migrations** — `npm run migration:new -- <slug>`,
   never a hand-typed timestamp, guarded for replay-safety, applied 3× in PGlite to prove it.
5. After each batch, `node scripts/audit-bus.mjs status <id> --set fixed --by lh-orchestrator`.

## Definition of done — a report is NOT a finished audit

**The run is not over when `VERDICT.md` is written. That is the halfway point.**

The owner's standing complaint about every previous audit is that *"no audit ever
fixes anything"* — passes that enumerated problems beautifully and changed nothing.
An audit that ends at a findings list has failed, no matter how good the list is.

**The run ends when, for every verified finding:**

1. Every **launch blocker** is FIXED, verified by re-running the original
   reproduction, and marked `status --set fixed`. Not triaged. Not documented. Fixed.
2. Every **HIGH** is fixed, or escalated to the user by name with the specific reason
   it cannot be — "needs a product decision", "needs an Apple/Stripe dashboard action",
   "would require a schema change we should not make mid-launch". A HIGH that is merely
   *listed* is an unfinished job, not a delivered finding.
3. Every **MEDIUM** is fixed or explicitly deferred with a reason. Silence is not
   deferral.
4. `LOW`/`POLISH` may be left, but say so and say how many.

**Do not stop and ask whether to start fixing.** The FIX phase is not optional and it
does not need permission — `permissionMode: plan` exists to order the work (sweep the
baseline before you disturb it, verify before you spend effort on a finding that turns
out to be false), **not to prevent it**. A lane in plan mode is waiting for you, and a
lane left waiting is a fix that never happened. Release them.

**Do not hand the user a list of things they could do.** If you found it, verified it,
and it is in your fleet's territory, fix it. Hand them the things only they can do —
a dashboard click, a product call, a paid-plan decision — and hand them those
*specifically*, not buried in a report.

Report once, at the end: what was found, **what was fixed**, what is left and why.
"What was fixed" is the section that matters, and if it is empty the run failed.

## Ping the user

Push-notify on every question and every completed wave — the user is not watching the
transcript. Use `osascript` with a sound; the push channel is silent for them.
