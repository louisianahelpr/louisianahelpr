# Launch audit — fleet protocol

Every `lh-*` agent reads this file end to end before doing anything. It is the
contract between 20 agents that never see each other's context.

**Standard:** the `lh-audit` skill (`.claude/skills/lh-audit/SKILL.md`) is the
audit standard — mandate, three lenses, §1–§6. This file does not replace it;
it adds the *coordination* rules the skill has no opinion about.

---

## 1. Phase discipline — REPORT, then verify, then fix

The fleet runs in three strictly ordered phases. This is `lh-audit` §1
non-negotiable #5, and it is also the only thing that keeps 20 agents from
editing `index.css`, `AppShell.tsx` and `App.tsx` at the same time.

| Phase | Who | Rule |
|---|---|---|
| **SWEEP** (waves 1–6) | every lane agent | File findings. **Do not edit `src/`, `supabase/`, or any shipped file.** Not one line. |
| **VERIFY** (wave 7) | `lh-verifier` | Independently reproduce every finding. Confirm, retract, or mark duplicate. |
| **FIX** (after) | orchestrator + targeted agents | Only verified findings get fixed, in severity order, on a serialized gate. |

A lane agent that "just fixed a small one while it was there" has broken the
audit: it destroys the baseline, hides the defect *pattern*, and makes coverage
unprovable. Write it down and keep going.

**Writing to `docs/audit/launch-2026-09/` and your own scratch dir is always allowed.**
That is not "editing the app."

## 2. The bus — append-only, never rewritten

All inter-agent state lives in `docs/audit/launch-2026-09/findings.jsonl`.
Parallel sessions in this repo have destroyed each other's work by rewriting a
shared file. So: **one JSON object per line, single atomic append, nothing is
ever modified in place.** A status change is a *new* record pointing at the
original id.

Never hand-edit the JSONL or `ROLLUP.md`. Use the CLI:

```bash
# File a finding (this is the ONLY way to report one)
node scripts/audit-bus.mjs file \
  --agent lh-money-escrow --severity HIGH --blocker \
  --surface "/post-job → checkout" \
  --claim "Accepted bid price is not applied; Stripe charges the original budget" \
  --repro "seed job w/ budget 100, accept bid at 150, checkout charges 10000 cents" \
  --evidence "~/lh-audit-shots/postjob-checkout.png,scratch/stripe-pi.json"

node scripts/audit-bus.mjs list --blockers      # what must not ship
node scripts/audit-bus.mjs list --agent lh-x    # your own lane
node scripts/audit-bus.mjs show M-004
node scripts/audit-bus.mjs status M-004 --set verified --by lh-verifier --note "..."
node scripts/audit-bus.mjs dupe R-011 --of M-004 --by lh-verifier
node scripts/audit-bus.mjs msg --to lh-visual-critic --from lh-route-walker --body "..."
node scripts/audit-bus.mjs inbox --agent lh-route-walker
node scripts/audit-bus.mjs rollup
```

**Severity** is `lh-audit` §4 vocabulary — `HIGH` / `MEDIUM` / `LOW` / `POLISH`
— plus an orthogonal `--blocker` flag meaning *this alone should stop the
launch*. Severity is how bad; blocker is whether we ship. They are not the same
axis: a HIGH polish-adjacent finding may not block, and a MEDIUM legal one may.

## 3. The evidence bar

> An audit of this app has been reported clean while real breakage sat in
> production, because a session that could not operate the app substituted
> reading the code and filed that as verification. Prose reads identically
> either way.

**A claim about runtime behavior requires an artifact somebody else can
re-check.** A screenshot path, an HTTP status, a SQL result, a row count,
command output, a computed-style value, a Stripe object id, a log line.

- Reading a source file is **not** verification of what renders or runs.
- "The primitive looks correct so the screen is fine" is a known failure mode
  here and is not admissible.
- Filing without evidence is allowed but is auto-marked `unevidenced` — the
  verifier will reproduce it from scratch or retract it. Don't pad your count.
- Before you file your lane's report, run
  `npm run check:audit-evidence -- <your report>`.

Static-analysis findings (a dropped `error`, a missing realtime `filter`) are
evidenced by `file:line` plus the reason it matters at runtime.

## 4. Isolation rules — these have each cost real time

- **Worktree under `$HOME`, never `/tmp`.** An hourly job wipes `/tmp`; audit
  infrastructure has been destroyed mid-run by it. Use `~/.lh-audit/<agent>/`.
- **`git checkout origin/main` first.** A new worktree forks the *local* HEAD,
  which is often mid-edit. Agents have audited stale code this way.
- **Stagger the gates.** Never run `typecheck` / `vitest` / `lint` while
  another agent is. Ask the orchestrator for the gate; don't just run it.
- **Commit early.** A usage-limit kill loses uncommitted work. Findings live in
  the bus (committed), not in your context.
- **Read-only against the seeded account.** `scripts/audit-capture.mjs` is
  read-only *by design* — a sweep that clicked controls once silently flipped
  `push_enabled → false` and all 7 `helper_availability` rows to unavailable on
  `eli.test.helper@louisianahelpr.com`, and every later audit read that as a
  product defect. **If your lane clicks, toggles, submits or drags, you MUST
  call `snapshotAccountState()` before and `restoreAccountState()` in a
  `finally`.** Do not reinvent them.
- **Verify which Supabase project you're pointed at.** `supabase/.temp/project-ref`
  currently points at **staging** (`okpxtpfvwtmbuxugqsws`), not prod
  (`fncmgoasalhdgfwzhsqa`). A secrets listing through the CLI once nearly
  produced a false "APNs is unconfigured" conclusion because of this.
- **Never `apply_migration` against prod via MCP.** `execute_sql` for read-only
  checks is fine.
- **Stripe: test mode only.** Confirm you are on test keys before exercising any
  payment path. Never touch a live key.

## 5. Stack facts every lane must hold

Getting these wrong produces confident, wrong findings.

- This is a **Capacitor** app. The UI, navigation, state, and business logic are
  **React 18 + TypeScript + Vite** in `src/`. There are no SwiftUI/UIKit
  patterns to audit. Map every "native" concept to its React/Capacitor analogue.
- **`ios/App/App/AppDelegate.swift` is NOT out of scope**, and "it's stock
  boilerplate" is not a reason to skip it. Stock boilerplate is exactly why push
  was dead for the life of the project: Capacitor's `PushNotificationsPlugin`
  observes `.capacitorDidRegisterForRemoteNotifications`, which the framework
  *declares* but posts from nowhere — the host app must post it from
  `didRegisterForRemoteNotificationsWithDeviceToken`. iOS handed the app a valid
  APNs token every launch and it was dropped on the floor. No error, no log.
- The **phone-sized website and the native app are ONE surface.** Never accept a
  divergence gated on `Capacitor.isNativePlatform()` unless it is a genuine
  native capability.
- **Every account can both post and do jobs.** There is no role system. "Role
  bleed" is not a defect here — never file one.
- Backend is **Supabase** (Postgres, RLS, RPCs, edge functions). Payments are
  **Stripe Connect escrow**.

## 6. Explicitly OUT OF SCOPE — do not hunt for these

These appear on generic mobile-audit checklists and **do not exist in this
stack.** Searching for them produces hallucinated findings. If you believe one
genuinely applies, file it as `LOW` with evidence and say why — don't assume.

| Not applicable | Because | The real analogue to check instead |
|---|---|---|
| Realm / CoreData / SQLite migrations, corrupted-DB recovery | No local database exists | localStorage/IndexedDB shape changes, and a corrupt Supabase session token that prevents boot — see `lh-concurrency-cache` |
| Offline-first sync, conflict resolution, last-write-wins | No offline store | React Query cache persistence + optimistic-mutation rollback |
| SDWebImage / Glide image caching | Not a native image pipeline | `<img loading="lazy">`, `decoding`, Supabase storage transforms, `srcset` |
| Apple IAP receipt validation | Payments are Stripe Connect, not IAP | **But**: whether gift cards / PayItForward trip Apple's IAP rules is a live App Review risk — `lh-compliance-store` owns it |
| Bluetooth, IoT, card readers, peripherals | No hardware integrations | — |
| Audio interruption, closed captions, subtitle tracks | No audio/video playback modules | — |
| XCTest / Detox / Maestro | Test stack is Vitest + Playwright | `lh-test-ci` |
| FlatList / LazyVStack virtualization | React, not React Native | Whatever virtualization the browse feed and message list actually use |
| SwiftUI `@State` / `@Observable` / Swift concurrency | No SwiftUI | React state + React Query |
| Role-gating: "prevent clients reaching provider-only dashboards" | **There is no role system.** Every account both posts and does jobs; the UI shows all features to everyone | Per-*record* authorization: can user B read/modify user A's job, bid, message, payout? That is `lh-authz-rls`, and it is a real risk |
| Dual-app / dual-mode interface switching | Same reason — one account, one mode | Whether the single surface stays coherent when a user is simultaneously poster and helper on different jobs |

**Assess-then-justify (likely "wontfix", but say so with reasoning, don't skip):**
- **Certificate pinning** — a WKWebView app on ATS-enforced HTTPS to Supabase/Stripe;
  pinning breaks on routine cert rotation and Apple discourages it. Reach a
  documented conclusion rather than filing it as a gap.
- **Jailbreak/root detection (RASP)** — consumer marketplace, not a bank. Same:
  conclude explicitly.
- **Full i18n string extraction** — the app is English-only for Louisiana. Locale
  *formatting* and *timezones* are in scope and important; extracting every
  string to a catalog is a product decision, not an audit finding.

## 7. Cross-talk

Hub and spoke. You message the orchestrator; the orchestrator fans out. Peer
messages via `audit-bus.mjs msg` are for handing another lane a lead, not for
negotiating scope.

Send a message when your finding is **actionable for a different lane**:
- Visual lane measures an overlay at 10% viewport height → tell `lh-silent-failure`
  (portal + `pointer-events` pair) and `lh-visual-critic` (re-shoot it).
- Money lane finds a write with no `.select("id")` → tell `lh-silent-failure`.
- Any lane sees "This page hit a problem" → tell the orchestrator immediately;
  check `error_logs` before theorizing.

## 8. Definition of done for a lane

1. Every surface in your scope enumerated **before** grading any of it.
2. Every finding filed through the bus with evidence.
3. A lane report at `docs/audit/launch-2026-09/lanes/<agent>.md`: scope covered,
   what you could NOT cover and why, findings by severity, and your explicit
   **out-of-scope conclusions** (§6) with reasoning.
4. `npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/<agent>.md` run.
5. Coverage manifest: list every route/file you actually opened. "No partial
   audits" (`lh-audit` §5) — an honest gap is a finding; a silent gap is a defect
   in the audit.
