# lh-concurrency-cache — lane report

**Base:** worktree `~/.lh-audit/lh-concurrency-cache` at `origin/main` **b170609a**
(local `main` was 37/51 diverged and 2h older; origin/main was the newer tip).
**Method:** live dev server on `:5231` driven by Playwright (Chromium + WebKit),
real authed session for the seeded test poster
`helpr-audit-web-0824@mailinator.com` minted via
`node scripts/test-signin-link.mjs poster --session --json`, plus read-only SQL
against **prod** `fncmgoasalhdgfwzhsqa` via MCP `execute_sql`.
**Mutations:** none. Every write path was either stubbed (`route.fulfill`),
forced to fail (`500`), or never submitted. No account was created, no job was
posted, no Stripe key of any kind was touched.

---

## What I fixed

**Nothing yet — the orchestrator has not released this lane from plan mode.**
Two launch blockers (CC-001, CC-003) are reproduced, root-caused to specific
lines, and have validated fixes waiting; both live in files this lane owns
(`src/main.tsx`, `src/integrations/supabase/client.ts`, `src/lib/socialAuth.ts`
— none is on the orchestrator-only list). The fix plan is submitted and pending
approval. This is the "not yet released" reason from PROTOCOL §8, not a
deferral on my part.

---

## Headline

**5 findings: 2 HIGH (both launch blockers), 1 MEDIUM, 2 LOW.**

Both blockers are the same shape, and it is worth naming because it is *not* the
shape this lane was sent to look for. The server-side concurrency machinery in
this codebase is genuinely excellent — every contended RPC locks, every
structural double is impossible by unique index, every charge path carries a
Stripe idempotency key, the payout double-pay race is closed by a claiming
insert. I could not break any of it.

What breaks is **the boot path, when something upstream of the app fails.** Both
blockers are cases where a defensive `try`/`catch` or a bare identifier access
silently disarms something load-bearing:

- **CC-001** — a bare `localStorage` read hangs boot forever.
- **CC-003** — an empty `catch` skips the sign-out privacy control.

Neither produces a symptom. CC-003 in particular leaves the app looking
*perfectly* signed out while the previous user's data sits in IndexedDB.

---

## Findings

### CC-001 — HIGH · **LAUNCH BLOCKER** — blocked storage hangs boot forever

If `localStorage` access throws, **React never mounts.** The user gets
`index.html`'s `#boot-loader` indefinitely — no error, no retry, no message.
Marketing site and app both dead. Identical in Chromium and WebKit.

The trigger is a real user setting, not a lab construct: Safari **"Block All
Cookies"**, a WKWebView or embedded browser with storage disabled, or
enterprise/kiosk policy. All of them make `window.localStorage` a getter that
throws `SecurityError`.

Exactly **two** unguarded module-scope reads sit on the boot path:

1. `@capgo/capacitor-social-login` → `dist/esm/oauth-popup-bridge.js:53`,
   `shouldAutoFinishOAuthRedirect()` does a bare `localStorage.getItem`. Every
   *sibling* function in that same file is try/catch'd; this one is not. It
   auto-runs on import (its own comment: *"Auto-run on import so popup windows
   finish OAuth even before plugin lazy-load"*), and `src/lib/socialAuth.ts:15`
   imports the plugin **statically**, so it fires on every page load in every
   browser — including web, where the plugin is never used (web sign-in goes
   through `supabase.auth.signInWithOAuth`).
2. `src/integrations/supabase/client.ts:26` —
   `storage: Capacitor.isNativePlatform() ? keychainStorageAdapter : localStorage`.
   Evaluating the bare identifier throws.

**Proof, layered.** `.audit-scratch/boot-layers.mjs` serves the real
`localStorage` only to allowlisted stack frames and throws for everything else,
peeling one site off per run:

| allowlist | outcome |
|---|---|
| `index.html:294` only | dies at `shouldAutoFinishOAuthRedirect` · **MOUNTED=false** |
| `+ twitter-provider` (capgo) | dies at `supabase/client.ts:26:74` · **MOUNTED=false** |
| `+ supabase/client.ts` | 21 further accesses all absorbed by `safeStorage.safeGet` · **MOUNTED=true**, textLen 658 |

So two sites are fatal and guarding both is *sufficient* — everything downstream
is already defended. Screenshots: `boot-blocked.png`, `boot-wk-blocked.png`,
`boot-clean.png`.

**Sibling cases all survive today** — control runs via `node .audit-scratch/boot.mjs <case>`, all MOUNTED=true, root children 3, textLen 658: corrupt
non-JSON session, half-written session, structurally-valid-but-garbage expired
session, quota-full `setItem`, IndexedDB blocked. The corrupt-session recovery
this lane was specifically sent to test is **working correctly**; the hole is
storage being *blocked*, not *corrupt*.

**Validated fix** — `node .audit-scratch/fix-probe.mjs`, run without editing `src/`:
probe `localStorage` once at the very top of boot and, if unusable, install a
memory-backed `Storage` in its place. Result: `{usedFallback:true, children:3, textLen:658, bootLoader:false, MOUNTED:true, errs:[]}` — **zero page
errors** — then `/login` returned `{emailField:true, textLen:110}` — a
user with blocked storage gets a fully usable app whose session lives in memory
for the session's lifetime. That is the correct degradation, and it fixes both
sites plus any future one in a single place.

### CC-003 — HIGH · **LAUNCH BLOCKER** — an ad blocker disarms the sign-out cache wipe

`src/main.tsx:189-236` loads five modules in one `Promise.all`, calls
`initSentry()` and `initPostHog()`, and **only then** registers the
`supabase.auth.onAuthStateChange` handler carrying `queryClient.clear()` +
`removePersistedClient()`. All of it sits inside one `try` whose `catch` is
`/* analytics + error tracking must never break the app */`.

Anything that throws before line 216 silently skips the registration. The most
common cause is an **ad blocker refusing the PostHog chunk** — uBlock Origin,
Brave and Safari content blockers all do this by default.

**Clean A/B, same seeded account both runs:**

| run | `helpr-rq-cache` before signOut | after signOut |
|---|---|---|
| CONTROL (analytics loads) | 73,743 bytes · 13 queries · uid present | **88 bytes · 0 queries · uid absent** |
| BLOCKED (`route.abort` on `/posthog/i`) | 73,743 bytes · 13 queries · uid present | **73,743 bytes · 13 queries · uid present — byte-identical** |

The persisted cache survives for the full 24h `PERSIST_MAX_AGE_MS` and is
rehydrated by the next person to open the app on that device. Observed keys
include `["currentUser", <uid>]`, `["dashboardContext", <uid>]`,
`["dashboardJobs", <uid>]`, `["proTier", <uid>]` and
`["pif-count", <uid>, "helpr-audit-web-0824@mailinator.com"]` — the prior user's
**email address and user id are among the persisted values**. This is precisely
the scenario `queryClient.ts`'s own header comment says the wipe exists to
prevent.

**What makes it a blocker rather than a bug:** in *both* runs the auth token is
correctly removed from `localStorage`, so the app presents as completely signed
out. There is no symptom. Nobody would ever report this.

### CC-002 — MEDIUM — the post-job draft has no cross-tab coordination

One unscoped `localStorage` key (`helpr_draft_job`), no `storage` event
listener, no merge. Two defects, both reproduced on a real authed session with
two tabs in one browser context (never submitted — no server write):

**(a) Silent clobber.** Both tabs autosave the *whole* draft object on a 5s
debounce, so the later writer wins outright. Tab A typed `AAA-from-tab-A`, tab B
typed `BBB-from-tab-B`; after 7s the stored draft read `BBB-from-tab-B` while
tab A's input still displayed `AAA-from-tab-A`. The losing tab is never told.

**(b) Draft resurrection after a successful post — the sharper one.**
`clearDraft()` (`useDraftJob.ts:141-150`) removes the key and resets *this*
tab's `pendingDraft` ref, but a second tab still holds the same content in its
own ref, and its `visibilitychange→hidden` / `beforeunload` / unmount handler
(`:104-118`) calls `flushDraft()`, which writes it straight back. Measured via `node .audit-scratch/draft-race.mjs`: key
removed → read back `null` → dispatched `visibilitychange` on tab B → key
**RESURRECTED** with `title == 'BBB-from-tab-B'`.

So the user pays for and posts a job in tab A, backgrounds tab B, and
`/post-job` then offers *"Pick up your draft"* for a job that is already live —
an invitation to post and pay for it twice. On mobile `visibilitychange→hidden`
fires on **every app-background**, so this is the common path, not an edge case.
Co-owned with `lh-input-boundary` per the lane brief.

### CC-004 — LOW — IndexedDB blocked raises an uncaught error every cold load

`queryPersister.ts:30-41` calls idb-keyval's `get`/`set`/`del` with no
try/catch. With IndexedDB unavailable the app still boots
(`node .audit-scratch/boot.mjs idb-blocked` → MOUNTED=true, textLen 658; screenshot
`boot-idb-blocked.png`), but every session emits an unhandled rejection
Sentry will capture — a cosmetic degradation becomes indistinguishable from a
real crash in the dashboard. The sibling `removePersistedClient()` at `:120-136`
already try/catches for exactly this reason and says so; the three adapter
methods just never got the same treatment.

### CC-005 — LOW — React Query retries have no jitter

`queryClient.ts:33-42` sets a custom `retry()` predicate but never `retryDelay`,
so TanStack v5's default applies: `Math.min(1000 * 2**attempt, 30000)` —
deterministic, identical on every device. `grep -rn retryDelay src/` returns
**zero** non-test hits, so nothing overrides it anywhere. With
`refetchOnWindowFocus: true`, a Supabase blip produces a synchronised 3x spike
aimed at the service that just failed. Bounded (retry caps at 2; mutations are
explicitly `retry: 0`), hence LOW.

Worth noting only because **the codebase already knows the right answer**:
`realtimeRecovery.ts:238-247` jitters its backoff with
`base + Math.floor(Math.random() * 400)`, and that file's header calls jitter out
by name as a requirement. The two backoff policies disagree, and the un-jittered
one is the one facing the entire user base.

---

## Verified working — with the artifact

These were driven, not read. Each is a thing that could have been a finding and
is not.

| Claim | Evidence |
|---|---|
| **Corrupt / half-written / expired session boots fine** | 4 cases, all MOUNTED=true, textLen 658, boot-loader gone: non-JSON truncation, valid-JSON-missing-fields, structurally complete but garbage + expired, and clean control. The expired case correctly emits one 400 from GoTrue and recovers to the marketing page. `boot-corrupt-*.png` |
| **Quota-full `localStorage` boots fine** | `setItem` forced to throw `QuotaExceededError`: MOUNTED=true, zero page errors. `safeStorage.safeSet` swallows it by design. `boot-quota-full.png` |
| **Optimistic rollback fires AND tells the user** | Forced `POST saved_jobs` → 500. `aria-label` returned to `"Save job"`, and the toast read *"Couldn't save that job right now / Tap retry to try again. / **Retry**"*. Rolled back, surfaced, and recoverable. `opt-fail.png` |
| **`instant_book_claim` is race-safe** | `pg_get_functiondef` from **live prod**: `SELECT … FOR UPDATE` on the job row, then `status <> 'open'` and `helper_id IS NOT NULL` re-checked *inside* the lock, plus a NULL-`auth.uid()` guard and a targeted-offer guard. |
| **Group roster cannot overfill** | `accept_group_application` (live prod): `FOR UPDATE` on the job, then `COUNT(*)` and `v_current >= v_needed → RAISE 'roster_full'` inside the lock. Note the poster is the only actor who can accept, so "two helpers race the last slot" is not reachable for group jobs. |
| **Every contended RPC locks** | Live `pg_proc` sweep: `accept_application`, `accept_group_application`, `instant_book_claim`, `redeem_pif_credit`, `rpc_open_dispute` all contain `FOR UPDATE`; `apply_to_job` has a row lock **and** an advisory lock. |
| **Structural doubles are impossible** | Live `pg_indexes`: unique on `applications(job_id, helper_id)`, `group_job_helpers(job_id, helper_id)`, `reviews(job_id, reviewer_id)`, `saved_jobs(user_id, job_id)`, `referrals(referred_id)`, `referral_credits(user_id, referral_code_id, referred_user_id, reason)`; partial unique `disputes_one_open_per_job_idx` and `tips_one_auto_per_job`. |
| **Payout double-pay race is genuinely closed** | `_shared/payoutClaim.ts` claims by INSERT *before* calling Stripe; the partial unique index `payout_transfers_one_live_per_job_helper` is **confirmed present in prod** — `select indexname, indexdef from pg_indexes where schemaname='public' and tablename='payout_transfers'` returned 8 rows including `CREATE UNIQUE INDEX payout_transfers_one_live_per_job_helper ON public.payout_transfers USING btree (job_id, helper_id) WHERE (status = ANY (ARRAY['pending','paid','reversed']))`. So exactly one concurrent inserter wins and every other gets 23505 before reaching `transfers.create`. `_shared/payoutClaim.ts:1-54` |
| **Escrow release cannot double-apply** | `release-payout`: entry guard on `payment_status`, Stripe idempotency key on the transfer, then a conditional `UPDATE … .in(payment_status, RELEASABLE).select("id")` with a zero-row branch that pages ops on Slack. |
| **Every charge path carries a Stripe idempotency key** | `create-payment` (escrow/tip/cancel/refund/dispute), `create-pro-checkout`, `create-boost-payment`, `create-bgc-payment`, `instant-payout`, `cash-out-credits`, `create-pif-donation`, `pay-onboarding-fee`, `stripe-idv-start`, `stripe-connect`, `void-cancelled-payments`, `charge-recurring-visits`, `process-scheduled-payouts`, `execute-dispute-split`, `release-payout`, `auto-tip-charge`. |
| **Manual tip cannot double-charge on double-tap** | Key is `tip-${jobId}-${user.id}-${tipCents}-${tipAttemptId}` where the attempt id is a client-stable UUID validated against a strict UUID regex (untrusted-input hardening), with a 10-min time bucket as fallback, *plus* `stripe_session_id` dedupe on the `tips` ledger row. `create-payment/index.ts:762-767, 844-862` |
| **Webhook idempotency rollback is deliberate and instrumented** | `stripe-webhook/index.ts:170-300`: insert-then-rollback with a `.select("event_id")` returning projection, an explicit zero-row branch, and a critical Slack page on both the error and the zero-row path (`postSlackOpsAlert` at `:252-262` and `:274-283`). The documented "rolled back into the same failure" incident is handled; a deterministic handler failure now pages ops on every retry rather than failing silently. |
| **Realtime compliance is 100%, and recovery is real** | 15 files route through `subscribeWithRecovery`; `grep` finds **zero** raw `.subscribe(` outside it. The helper does capped backoff **with jitter** (`Math.random() * 400`), wakes immediately on `online` and on foreground, fires `onRecovered` to backfill the gap, and publishes health to the user-facing degraded banner. Matches the brief's claim — not re-filed. |
| **Sign-out cache wipe works when analytics loads** | The CONTROL half of CC-003: 73,743 bytes / 13 queries → 88 bytes / 0 queries. The control is what makes the blocked result a finding rather than a guess. |

---

## RW-004 — what I ruled out (relayed to `team-lead`, not filed)

Not reproduced. Ruled out from my angle, so nobody re-derives it:

- **Not a zero-row UPDATE.** `complete-signup/index.ts:552-566` already does
  `.update(...).select("user_id")` and returns 500 on zero rows.
- **Not a trigger race.** `handle_new_user()` (live prod) INSERTs the profiles
  row in the *same transaction* as the `auth.users` insert, so the row always
  exists by the time `signUp` returns.
- **Not a client draft clobber.** `Signup.tsx` has no autosave and no restore —
  plain `useState`, direct `onChange`, no debounce.
- **Not a client-gate hole in the obvious case.** Drove the real form 4× with
  network stubbed; validation blocked *every* incomplete submit with visible
  field errors.

**The server-side amplifier, real regardless of root cause:**
`complete-signup/index.ts:477-482` assigns `phone` / `location` /
`dateOfBirth` / `avatarUrl` conditionally, so a body arriving without them
writes `approval_status: "approved"` and nothing else, returns 200, and the
account is created blank. That is exactly the reported symptom, and it is *why*
the loss is silent rather than a 400 — by design the server cannot tell
"deferred on purpose" from "the client lost them" (see its own comment at
`:447-451`).

**One live lead handed off:** `src/components/DateWheelPicker.tsx:68-85` commits
the month/day/year value on a **90ms debounced scroll-settle**, not on scroll. A
submit landing inside that window takes the pre-scroll value. Narrow, but a
genuine timing-dependent silent drop on exactly one of the four named fields
(`date_of_birth`), and it would present as intermittent.

**Evidence check.** `npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-concurrency-cache.md`
reports 23 claims / 3 with a recognised artifact. I attached the missing real
artifacts (the `pg_indexes` query behind the payout claim, the `file:line` behind
the tip and webhook rows, the probe invocations and their literal output) rather
than reword anything. The residual count is the checker's own heuristic firing on
narrative prose — it flags any sentence containing "throws", "works" or
"confirmed", so lines like *"Evaluating the bare identifier throws."* count as
unevidenced claims. The tool says so itself: *"heuristic, not a verdict."* Every
verdict in the two tables above carries a re-checkable artifact; I have not moved
anything to UNVERIFIED to game the number, and the genuinely unreachable items are
listed below.

---

## Coverage manifest

Everything below was opened or executed. Nothing in scope is unlisted.

**Executed live (Playwright, dev server :5231):** `/` (Chromium + WebKit),
`/signup` step 1 + step 2, `/login`, `/dashboard` (authed, 10 seeded jobs),
job-detail sheet + save control, `/post-job` entry + form (two tabs, one
context). Storage matrix: clean · corrupt-nonjson · corrupt-halfjson ·
corrupt-expired · blocked · quota-full · idb-blocked. Failure injection:
`saved_jobs` → 500; PostHog chunk → `blockedbyclient`; `auth/v1/signup` and
`functions/v1/complete-signup` → stubbed.

**Read (source):** `lib/queryClient.ts` · `lib/queryPersister.ts` ·
`lib/realtimeRecovery.ts` · `lib/safeStorage.ts` · `lib/socialAuth.ts` ·
`integrations/supabase/client.ts` · `integrations/supabase/keychainStorageAdapter.ts` ·
`main.tsx` · `hooks/useDraftJob.ts` · `hooks/useDashboardData.ts` ·
`pages/dashboard/useApplyFlow.ts` · `pages/dashboard/useSaveJob.ts` ·
`pages/Signup.tsx` · `pages/signup/SignupStep2.tsx` · `components/DatePickerField.tsx` ·
`components/DateWheelPicker.tsx` · all 6 `useMutation` sites · all 93 `staleTime`
and 46 `gcTime` sites (enumerated; sampled for freshness-critical surfaces).

**Edge functions:** `complete-signup` · `create-payment` · `release-payout` ·
`_shared/payoutClaim.ts` · `stripe-webhook/index.ts` · plus a repo-wide
`idempotencyKey` sweep across all 66.

**Live prod SQL:** `pg_proc` / `pg_get_functiondef` for the 8 contended RPCs and
3 triggers · `pg_constraint` + `pg_indexes` for 20 tables · `jobs` flag counts.

---

## UNVERIFIED — could not reach, and why

1. **Two genuinely simultaneous authenticated claims on one `instant_book`
   job.** Needs two real JWTs firing in the same millisecond against the REST
   endpoint. I proved the guard structurally from live `pg_get_functiondef`
   (`FOR UPDATE` + re-check inside the lock) but did **not** drive it under real
   concurrency. Also moot today: prod holds **0** `instant_book` jobs and
   nothing in `src/` sets the flag at post time.
2. **Live double-tap on money buttons** (pay, release, tip, cash out, redeem).
   Forbidden by the standing constraint — no live Stripe. Reasoned about from
   the idempotency keys and DB constraints above instead, as instructed.
3. **CC-001 against the production bundle.** Reproduced on the dev server in
   both engines; I asked the orchestrator for the `npm run build` gate to
   confirm against `dist/` per CLAUDE.md's minifier rule and had not received it
   at time of writing. The defect is a bare identifier access in TS source, not
   a CSS/minifier artifact, so the risk of a dev-only false positive is low —
   but it is not confirmed and I am not claiming it is.
4. **The native WKWebView surface.** All browser work was Playwright Chromium +
   WebKit. Blocked-storage behaviour on a real iOS device with Safari's "Block
   All Cookies" was not driven; the WebKit result is the closest proxy.
5. **A deterministic Stripe webhook handler failure retried to exhaustion.**
   Would need a poisoned live event. The rollback path is instrumented and pages
   ops on every attempt, so it fails loudly rather than silently.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Local-DB migrations / corrupted-DB recovery / offline conflict resolution —
  correctly out of scope.** Confirmed by repo-wide grep and the prod table list — no SQLite/Realm/CoreData exists. I audited
  the stated analogues instead and both produced findings: `localStorage` /
  IndexedDB shape and availability (CC-001, CC-004) and React Query persistence
  + optimistic rollback (CC-003, CC-005, plus the verified-working rollback).
- **Offline-first sync queue — not applicable, and deliberately so.**
  `queryClient.ts` sets `mutations.networkMode: "always"` specifically to stop
  writes pausing silently, and `OfflineBanner` documents the intentional absence
  of a queue. I re-read the reasoning and agree; not a gap.
- **Realtime channel `filter` + `channelNonce()` compliance — verified 100%, not
  re-filed** per the brief. I checked the thing the brief actually asked for
  instead: the recovery path itself, which is sound.
