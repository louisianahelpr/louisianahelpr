# Launch audit — fleet protocol

Every `lh-*` agent reads this file end to end before doing anything. It is the
contract between 36 agents that never see each other's context.

**Standard:** the `lh-audit` skill (`.claude/skills/lh-audit/SKILL.md`) is the
audit standard — mandate, three lenses, §1–§6. This file does not replace it;
it adds the *coordination* rules the skill has no opinion about.

---

## 1. Fix what you find — after you have proved it

Changed 2026-09-02 at the owner's direction: lanes **fix**, they do not merely
report. The fleet runs autonomously to completion and reports once, at the end.

The old report-then-fix order existed to stop 36 agents editing the same files
at once. That risk is real and is handled by scoping instead: each lane fixes
**only within its own territory**, and the shared files belong to the
orchestrator alone.

**The sequence for every finding is: file → reproduce → fix → verify → mark fixed.**
Filing first is not ceremony; it records the baseline so a later reader can see
what the app did before you touched it.

### The one gate that matters: never fix from a lead

On 2026-09-02 three launch blockers were filed from a read of
`supabase/migrations/`. All three were false — every object had been dropped
months earlier, and one of them (`worker_protection_credits`) had been written
into this very file as "confirmed live". Fixing any of them would have been
damage, not repair.

| A LEAD (never fix from it) | A FACT (fix from this) |
|---|---|
| A grep of `src/` | A query against the live database |
| A migration file | `pg_proc` / `pg_policies` / `to_regprocedure` |
| Another lane's note, or this file | An HTTP request and its response |
| "The code looks like it would…" | A test you ran that failed, then passed |
| A screenshot you did not take | A screenshot you took |

**If you cannot reproduce it, retract it.** A retraction is a success. The count
of findings is not the score; the count of *true* findings is.

### Territory

Fix inside your lane. If the fix belongs to another lane, file it through the bus
and send the lead to the orchestrator (`SendMessage` to **`team-lead`**) — never to
the lane directly (§7). `audit-bus.mjs msg` is retired: it only delivered if the recipient
thought to poll, so a hand-off usually landed after that lane had finished.

**Orchestrator-only files — never edit these, file and message instead:**
`src/index.css` · `src/components/AppShell.tsx` · `src/App.tsx` ·
`src/components/ui/*` · `tailwind.config.ts` · `package.json` · CI workflows.
Concurrent lanes collide there and silently lose each other's work.

### Proving a fix

`npm run typecheck` — **ask the orchestrator for the gate**, never run it while
another lane is. Plus `npx vitest run` on the relevant tests when you touch
tested code, plus a re-run of your original reproduction showing it now passes.
`node scripts/parsecheck.mjs <file>` is the fast syntax check; a clean parse
never proves a missing import.

Anything touching **money, auth or the data model** goes through
`lh-silent-failure`, `lh-authz-rls` and `lh-money-escrow` (dispatched REVIEW-ONLY) over your working diff before you commit — there is no PR gate here to
catch it. The agents this line used to name — `code-reviewer`, `silent-failure-hunter`, `security-auditor` — DO NOT EXIST; the spawn fails, so the guard silently never ran.

Commit **directly to `main`**, early and often, one commit per fix. A
usage-limit kill loses uncommitted work.

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
node scripts/audit-bus.mjs rollup
```

The `msg` and `inbox` subcommands still exist in the script but are **no longer the
cross-talk channel** — see §7. Use `SendMessage` to the orchestrator instead; messages
reach a running lane, a file in the bus does not.

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

**Deliberately staged — DO NOT "complete" these. Landing them early breaks CI by design.**

- **Apex universal links (`louisianahelpr.com` without `www`).** The `vercel.json` half is
  landed and **intentionally inert**: the apex redirect rule cannot take effect until the
  project-domain redirect is cleared by hand in the Vercel dashboard
  (Project → Settings → Domains), because a domain-record redirect is applied at the edge
  *before* `vercel.json` routing. The remaining step is that one click, and only then do
  `applinks:` / `webcredentials:` entries for the apex go into **both** entitlement files.
  A lane that "helpfully" adds those entitlements first turns CI red on purpose — the guard
  in `e2e/happy-path/zz-runtime-probe.spec.ts` enforces the coupling. Leave it alone; it is
  tracked outside this ledger and is owned by the user, not by a lane.

**Assess-then-justify (likely "wontfix", but say so with reasoning, don't skip):**
- **Certificate pinning** — a WKWebView app on ATS-enforced HTTPS to Supabase/Stripe;
  pinning breaks on routine cert rotation and Apple discourages it. Reach a
  documented conclusion rather than filing it as a gap.
- **Jailbreak/root detection (RASP)** — consumer marketplace, not a bank. Same:
  conclude explicitly.
- **Full i18n string extraction** — the app is English-only for Louisiana. Locale
  *formatting* and *timezones* are in scope and important; extracting every
  string to a catalog is a product decision, not an audit finding.

## 6b. CI already covers part of this — read it before you sweep

24 workflows already run in `.github/workflows/`. **Auditing what CI already
proves is wasted budget, and "CI checks this" is not the same as "CI checks this
well."** Your job is the gap, and any workflow that is disabled, path-filtered
into irrelevance, or asserting something weak is itself a finding.

| Already automated | Owning lane must read it first |
|---|---|
| `a11y-axe.yml` — seeded axe sweep, all variants | `lh-a11y-sensory` |
| `lighthouse.yml` — weekly + PR | `lh-perf-deps` |
| `bundle-size.yml` | `lh-build-release`, `lh-perf-deps` |
| `broken-links.yml` — weekly | `lh-copy-content` |
| `security-audit.yml` — weekly | `lh-authz-rls`, `lh-build-release` |
| `edge-function-smoke.yml` — daily | `lh-edge-functions` |
| `db-drift-detect.yml` — daily · `migration-guard` · `migration-lint` · `db-smoke` | `lh-schema-integrity` |
| `prod-freshness.yml` — daily | `lh-build-release` |
| `e2e-happy-path.yml` · `mobile-viewports.yml` · `ui-sweep.yml` | `lh-e2e-journeys`, `lh-route-walker` |
| `test.yml` · `vitest.yml` | `lh-test-ci` |
| `sentry-release.yml` | `lh-observability` |
| `sitemap-drift.yml` | `lh-copy-content` |

**Check `gh workflow list --all` for `disabled_manually` before trusting any of
them.** Guards in this repo have previously been PR-only and dormant in a
direct-to-main workflow, so they never ran at all.

## 6c. Scale — know what you are auditing

Measured, not estimated: **66 edge functions · 108 tables · 254 database
functions of which 218 are `SECURITY DEFINER` · 16 Capacitor plugins ·
~509 components, ~250 lib files, ~135 pages.**

Third-party services in play: **Stripe** (payments, Connect, subscriptions,
payouts, tax, Identity), **Sentry**, **PostHog** (product analytics),
**Apple MapKit JS**, **Resend** (transactional + marketing email), **Slack**
(ops alerting), **APNs**, social login (Apple/Google), biometric auth.

If your lane's scope implies "read every one of these," say so in your coverage
manifest and sample deliberately — a stated sampling strategy is honest; an
unstated one is a false clean.

## 6d. REMOVED FEATURES — confirmed dead by the product owner

Confirmed dead on 2026-09-01. **Do not audit these as product.** Their database
objects, RPCs, edge functions and any surviving UI are **removal findings** owned
by `lh-schema-integrity` (schema) and `lh-edge-functions` (functions) — a
`SECURITY DEFINER` function outliving its product is live attack surface with no
owner, and dead tables still carry RLS policies that must be reasoned about.

| Removed | Objects to sweep for |
|---|---|
| **Entire B2B / business tier** | `businesses`, `business_members`, `business_api_keys`, `business_webhooks`, `business_job_templates`, and every `business_*` RPC — **especially `create_business_api_key`** (customer-facing API keys for a deleted product). **No public API, no outbound webhooks.** |
| **Time banking** | `time_credits`, and its handling inside `money-reconciliation` |
| **Pet evacuation** | `evacuation_pets` only. **Pet profiles stay** — `pet_profiles`, `job_pets`, `pet_report_cards`, `care_relationships` are live |
| **Community posts** | `community_posts`, `community_post_likes` |
| **Broadcast messages** | `broadcast_messages`, `broadcast_dismissals`, `fan_out_broadcast_to_notifications`, `set_broadcast_pending_fan_out`, `send-marketing-blast` |
| **Retainer agreements** | `retainer_agreements` |
| **Helper circles** | `helper_circles`, `helper_circle_members` — zero references in `src/` and in edge functions. Owner did not recognise the feature and approved deletion (2026-09-01). `favorite_helpers` + `?tab=saved_helpers` is the live equivalent |

**The one B2B carve-out:** licensed-and-insured credentialing **stays live** —
`helper_credentials`, `helper_verifications`, `verification_checks`,
`verification_exceptions`, `review_credential`, and the Stripe IDV / background-check
path. Audit those fully.

### Confirmed LIVE (do not treat as dead just because they look quiet)

`pif_credits` (Pay It Forward, `/gift-card`) · `referral_credits` / `referrals` ·
STR iCal sync (`/str-settings`) · pet profiles (`/pets`) · Helpr Wrapped
(`/wrapped`) · Home History (`/home-history`) · group jobs.

> **CORRECTION, 2026-09-02 — `worker_protection_credits` is NOT live.** This
> section previously listed it as live and made SI-001 a launch blocker. That was
> **wrong**, and it is worth understanding why, because it is the exact mistake
> this protocol tells every lane not to make: the finding was built by reading
> migration files, and migration history is an upper bound that includes objects
> since dropped. `lh-schema-integrity` checked live prod: the table was **dropped
> on 2026-08-30** and does not exist. The single `src/` "reference" is a *comment*
> at `CancellationDialog.tsx:412` documenting the removal. SI-001 is retracted;
> there is no unpaid compensation promise.
>
> Two more of the same shape were retracted with it: **SI-003 / SI-005** (zero
> `business_*` tables or functions survive in prod —
> `to_regprocedure('create_business_api_key')` is NULL, so there is no orphaned
> API-key minter) and **SI-004** (`helper_circles` is already gone from prod; the
> owner approved deleting something that had already shipped — **the fix phase
> must NOT write that DROP migration**). All three survive only on staging.
>
> If you are reading this file for scope, treat any claim here that you did not
> personally verify against live state as a lead, not a fact.

### Also CONFIRMED LIVE (owner, 2026-09-01) — audit these fully

**Pro subscriptions** (`create-pro-checkout`, `pro-customer-portal`,
`check-pro-subscription`, `expire-subscriptions`, `subscription-reconciliation`,
`?tab=subscription`, `/admin?view=subscriptions`) · **job boosts** · **auto-tip**
(`/auto-tip`) · **instant payout**.

That makes **four money systems live at once** — escrow, subscriptions, the credit
ledgers, and instant payout — so `lh-money-escrow` and `lh-subscriptions-credits`
must agree on their boundary rather than both assuming the other has a path.
Two consequences worth carrying into those lanes:

- **Pro subscriptions are an App Review risk.** If the subscription unlocks
  digital-only functionality inside the iOS app, Apple may require IAP rather than
  Stripe. `lh-compliance-store` owns the conclusion; `lh-subscriptions-credits`
  owns establishing what it actually unlocks.
- **`reap_stranded_instant_payouts` exists**, which means instant payout has
  stranded money before. Find out how, and whether it still can.

## 6e. The surface is 802, and routes are 4% of it

`SURFACE.md` is regenerated by `node scripts/audit-surface.mjs` and is the
checklist every lane reports coverage against. **Do not report coverage against
the route list.** The measured breakdown:

**34** routes · **14** redirect-only routes · **23** tab variants · **24** admin
views · **139** overlay instances · **40** forms · **517** toast messages ·
**20** email templates · **12** confirmed multi-step flows.

Four things in there change how you work:

1. **517 toast messages across 134 files** are the largest body of user-facing
   copy in the app, and no previous audit counted them at all.
2. **6 overlays are hand-rolled `fixed inset-0` portals** on no dialog
   primitive, so they do not inherit the shared `Dialog`'s portal — the
   containing-block trap concentrates there. `PhotoLightbox` and
   `MessageAttachment` say so in their own comments.
3. **28 confirmations render through a shared `BrandConfirmDialog`** and never
   contain the string `<Dialog>`. A grep for dialog primitives misses every one.
4. **40 forms, and only 9 have a `<form>` tag** — there is no react-hook-form
   here, so most submit from inside a dialog.

The manifest also carries a reconciliation table showing where the script and
three independent enumerations agree. Earlier passes disagreed because each was
measuring a different unit; if you produce a count that contradicts the
manifest, say which unit you counted before concluding the manifest is wrong.

## 7. Cross-talk

Hub and spoke — unchanged as a rule, changed as a mechanism. You message the
orchestrator with `SendMessage({to: "team-lead", message: "..."})` — **`team-lead` is
the orchestrator's address; `lh-orchestrator` is NOT an agent and a send to it fails
silently** — and the
orchestrator fans out. You do **not** message another lane directly, and you do not
negotiate scope with one. A relayed message hands another lane a lead; it never
reassigns work.

`audit-bus.mjs msg` is retired for this. It wrote to a file nobody was obliged to
read, so a lead handed off mid-wave frequently arrived after the recipient had
finished. `SendMessage` is delivered into the running lane at its next tool round.
The rest of the bus is untouched and still mandatory: `file`, `status`, `dupe`,
`list` and `rollup` remain the durable findings ledger. **Findings go in the bus;
conversation goes over `SendMessage`.** A finding that exists only as a message has
not been filed.

Note you are a **teammate**, not an anonymous subagent: you were spawned with a
`name`, you appear in `ListAgents`, and messages arrive unprompted — there is no
inbox to poll.

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
6. **Every finding you filed is FIXED, or has a named reason it is not.** This is
   the criterion this list used to be missing, and its absence is why previous
   passes produced excellent reports and changed nothing. A lane that enumerated
   its whole surface, filed twelve evidenced findings and fixed none of them has
   **not** finished — it has written a document.

   Acceptable reasons not to fix, stated explicitly per finding: it belongs to
   another lane's territory (filed and relayed to the orchestrator); it needs a
   product decision only the owner can make; it needs an action outside the repo
   (an Apple, Stripe or Vercel dashboard change); the orchestrator has not yet
   released you from plan mode. "Ran out of time" is a reason too — say it.

   **A plan the orchestrator rejects during the sweep is a DEFERRAL, not a
   refusal.** Resubmit it in the FIX phase. Do not silently drop a fix because
   your first plan came back rejected.

7. Your lane report's **"what I fixed"** section is the one the owner reads. If it
   is empty, say why in the first line rather than leaving them to infer it.
