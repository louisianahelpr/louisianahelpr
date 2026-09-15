# Hole hunt — silent failures + client-trust + input — 2026-09-15

**Scope:** SILENT FAILURES (dropped errors, zero-row writes, fail-open
catches, Capacitor await, unfiltered realtime, null-coalesce comparisons,
ownerless-job nulls) + CLIENT-TRUST (role/permission decided only in React,
secrets in the bundle, client-controlled fields RLS doesn't constrain) +
INPUT (XSS, unsanitized user content, boundary values).

**Method:** static read of `src/`, `supabase/functions/` and
`supabase/migrations/`, cross-checked against the most recent migration that
touches each surface (the codebase's own audit-comment trail is unusually
rich and was treated as evidence, not taken on faith — every claim below was
re-derived from the current file, not quoted from the comment). One live
read against prod (anon key, POST to an RPC expected to be locked down) to
confirm a hypothesis; no writes, no sign-ups, no PII touched.
**Prod requests used: 1 / 40.**

**Freshness:** rebased onto `origin/main` at `601d1b8a0` ("Class guard: every
client-writable jobs money/state column needs a transition trigger",
2026-09-14 21:52 PDT) immediately before writing this file. Read that
commit's new `src/test/jobsStateColumnGuard.test.ts`: it is scoped to
UPDATE-path transition guards on `jobs` (the round-5 dispute-status class),
enumerated via `KNOWN_OPEN` = `helper_completed_at`, `revision_completed_at`,
`stripe_session_id` for poster/offered seats — it does not enumerate or gate
`is_urgent`/`urgent_fee`/`platform_fee_*`, which is an INSERT-path gap, so
H-001 below is not covered by it and was not closed by this commit.

**Baseline:** `git diff --stat 5fd3686b origin/main` (the last
`lh-silent-failure` lane baseline, 2026-09-01) shows 1,137 files changed
since — too large to diff-review file by file in the time available, so this
pass swept the current tree for the named patterns directly rather than
trying to review the delta. Re-checked `docs/OPEN.md` and the "ALREADY
KNOWN" list in the task brief before filing anything below; nothing here
duplicates open_jobs_browse, the dispute-marker trigger, offer-privacy,
avatar-divergence, rpc-error-map, discarded-query-filters, role-neutral-copy
or dispute-races.

---

## Findings, most severe first

### H-001 — HIGH — PLAUSIBLE — Urgent placement is free: `is_urgent`/`urgent_fee` are client-set at INSERT and never re-validated against each other before the notification fan-out fires

**Where:**
- `src/pages/postjob/useJobSubmit.ts:414-415` — the client INSERT payload sets `isUrgent`/`urgentFee` straight from form state.
- `supabase/migrations/20260903065305_jobs_insert_column_lock.sql` (the `enforce_jobs_insert_column_lock` trigger, BEFORE INSERT) — resets seven columns (`payment_status`, `stripe_payment_intent_id`, `stripe_session_id`, `boosted_at`, `boost_expires_at`, `is_seed`, `status`, `helper_id`) but explicitly leaves `is_urgent`/`urgent_fee`/`platform_fee_*` writable, and its own comment says why: *"STILL OPEN, deliberately, and filed rather than rushed: `is_urgent` / `urgent_fee` (a free urgent placement)... Checkout recomputes the charge from its own figures, which is why this is a revenue-reporting problem rather than a live money-loss one — but it should not stay open past launch."*
- `supabase/functions/create-payment/index.ts:446,507-521` — `urgentFeeCents = Math.round((job.urgent_fee ?? 0) * 100)`, and the "Urgent tip" Stripe line item is only added `if ((job.urgent_fee ?? 0) > 0)`. Charging is read straight off the stored row; nothing here checks `is_urgent` against a required minimum before billing.
- `supabase/functions/instant-job-match/index.ts:293,306` — `if (job.is_urgent || !digest) { immediate.push(h) }` and the notification title gets `· Urgent` appended. `is_urgent` alone (independent of `urgent_fee`) forces immediate full-fanout push to every matching helper, bypassing their digest/batching preference.
- `src/lib/moneyLimits.ts:31` — the legitimate flow requires `URGENT_FEE_FLOOR_DOLLARS = 5` before a job can be marked urgent, but per that file's own header comment this and every other figure in it are enforced "by review, not by CI," and the form is explicitly not the enforcement point (`MIN_JOB_BUDGET_DOLLARS`'s comment: *"the jobs INSERT goes through PostgREST with the poster's own token"*).
- The one DB-level guard that exists, `jobs_urgent_fee_required`, is referenced only in prose (`supabase/migrations/20260902213110_add_urgent_fee_ceiling.sql:4,25` and `src/test/fixtureSchemaContract.test.ts:422`) — its `CREATE`/`ALTER … ADD CONSTRAINT` text is not present in any tracked migration file, so it was authored directly against prod outside the migration history this repo carries. I could not read its exact predicate with the tools available in this session (anon key only; no `pg_get_constraintdef` access), so I can't confirm the exact bypass mechanism — only that the 2026-09-03 migration, which is the most recent commit to touch this exact trigger and function, states in its own words that the gap is still open.

**Repro (not executed live — see Status):** as any IDV-verified, authenticated poster (the `jobs` INSERT policy requires `auth.uid() = customer_id` and IDV-verified, nothing more), `POST /rest/v1/jobs` directly against PostgREST — bypassing the post-job wizard entirely — with `is_urgent: true, urgent_fee: null` (or `0`, if the floor constraint's predicate turns out to use `NOT is_urgent OR urgent_fee >= 5`, which is `NULL` — and therefore constraint-satisfying, not violating — when `urgent_fee` is `NULL` and `is_urgent` is `true`, per ordinary SQL three-valued CHECK-constraint semantics). Every other required column matches a normal legitimate job post.

**Impact:**
1. Free access to a paid feature: instant, unbatched push notification to every matching helper (`instant-job-match`), which the client-side wizard prices at a $5 minimum.
2. At scale this is self-defeating for the product, not just revenue: if any poster can mark every job "urgent" for $0, the whole "Urgent" signal (badge, notification title, helper attention) degrades — the fairness case for why urgent jobs cost money at all becomes moot.
3. Secondary, same root cause: `src/lib/helperEarnings.ts:155` (`return job.platform_fee_amount ?? derived`) and `src/components/profile/EarningsForecastCard.tsx` read `jobs.platform_fee_amount` directly for a helper's pre-payment earnings forecast. Because `platform_fee_amount`/`platform_fee_percent` are likewise client-set at INSERT and only overwritten with server truth once `create-payment` stamps the checkout session (`create-payment/index.ts:583-585`), a poster who sets `platform_fee_amount: 0` at post time makes every helper's earnings forecast on that *unpaid* job show 100% of budget as take-home, until the poster actually pays. This branch is explicitly *not* a live money-loss (checkout always recomputes before Stripe is touched — confirmed by reading `create-payment/index.ts:578-585`, which never selects `job.platform_fee_percent` for the charge), so it's filed here as an impact of H-001 rather than a separate finding.

**Status: PLAUSIBLE.** I verified by reading current code (not a stale comment) that: (a) the INSERT trigger does not touch these columns, (b) `create-payment` charges directly off the stored `urgent_fee` with no re-validation against `is_urgent`, and (c) `is_urgent` alone gates a real behavioral benefit (fan-out bypass) independent of the fee actually paid. I did not execute a live INSERT — this session has no authenticated test-account JWT and the prod rules forbid sign-ups, and PostgREST writes require `auth.uid()`, which the anon key does not carry. The one live check I did run (see below) is adjacent, not this bug directly.

**Live check run (1 request):** confirmed `get_service_role_key()` — a helper function referenced in the generated types that had raised my suspicion during this sweep — is correctly locked down: anon `POST /rest/v1/rpc/get_service_role_key` → `401 {"code":"42501","message":"permission denied for function get_service_role_key"}`. Not a finding; recorded so the request-budget line item is legible.

**Suggested class-check:** a PGlite-replayed insert against the live-shaped `jobs` table with `is_urgent=true, urgent_fee=NULL` and a second with `urgent_fee=0`, asserting the INSERT is *rejected* (red today per the code read above; would need to actually run to confirm PROVEN vs PLAUSIBLE) — mirroring `scripts/probes/dispute-table-door.probe.mjs`'s shape. Paired with a `create-payment` unit test asserting the "Urgent tip" line item is present and >= the floor whenever `is_urgent` is true, regardless of what `job.urgent_fee` holds, i.e. moving the check from "trust the column" to "recompute or reject," which is exactly what the 2026-09-03 migration comment says still needs to happen.

---

## Coverage — what was swept and came back clean

- **Dropped Supabase errors / zero-row writes on money & trust surfaces**: read every `.update(`/`.upsert(`/`.insert(` site touching `jobs`, `profiles`, `disputes`, `applications`, `user_bans`, `reports`, `admin_user_notes` in the ~114 files touched since 2026-09-10 that reference those tables (`src/pages/dashboard/useApplyFlow.ts`, `useOfferHandlers.ts`, `AdminReports.tsx`, `AdminDisputes.tsx`, `AutoTip.tsx`, `DisputeTimelineDialog.tsx`, `JobTracking.tsx`, `EditJobDialog.tsx`, `CredentialsTab.tsx`, `useAdminUserActions.ts`, `BanDialog.tsx`, and more). Every one carries `.select("id"|"user_id")` + `unwrapMutation`/an explicit zero-row check, several with comments citing the exact prior incident that motivated the guard. No new unguarded write found past what `lh-silent-failure` (2026-09-01) already catalogued.
- **`DisputeTimelineDialog.tsx` evidence-attach paths** (both the `disputes` table path and the legacy `jobs.dispute_evidence_urls` path): read in full. The legacy path matches an already-open OPEN.md item (either party can rewrite dispute evidence/reason text at any time) — not re-filed.
- **Realtime channels**: re-swept all `.channel(` sites. `Admin.tsx`'s unfiltered `jobs`/`reports` subscription is deliberate and documented (admin-wide dashboard, not user-scoped by design) — not a finding. `useChatPresence.ts`'s shared-topic presence channel is the same documented exception the prior lane found. No new channel missing `channelNonce()` or a user-scoped `filter`.
- **XSS / `dangerouslySetInnerHTML` / `innerHTML`**: exactly 3 hits repo-wide. `Index.tsx`'s two are `JSON.stringify` of static schema objects (safe). `mapMarkers.ts`'s `innerHTML` assembly only interpolates resolved CSS-token hex colors and a fixed SVG path — job title/location are used for the accessible name only, never concatenated into the HTML string. Clean.
- **Client-controlled money fields** (`budget`, `platform_fee_percent`, `platform_fee_amount`, `sales_tax_rate`, `sales_tax_amount`, `urgent_fee`) in the jobs INSERT payload: traced every one through `create-payment/index.ts`. `budget` is legitimately poster-set (their own offer) and bounded server-side (`jobs_budget_range`, $10–$5,000). `platform_fee_*`/`sales_tax_*` are client-set at INSERT but always overwritten with server-computed values before Stripe is ever called (confirmed by reading the `stampSession` call at `create-payment/index.ts:583-585`, which never reads the client-set fee columns back for charging) — this is why H-001 is filed as "urgent fee," not "commission theft." `urgent_fee` is the one column actually read back and charged verbatim.
- **Gift card mint bounds** (`GiftCard.tsx`, `create-gift-card-checkout`): client-side `MIN_GIFT`/`MAX_GIFT` explicitly mirror `MIN_GIFT_CENTS`/`MAX_GIFT_CENTS` in the edge function per an in-file comment; not re-verified live (no spend), but the pattern (server-side edge function owns the real charge, not a direct client table write) matches every other money surface checked.
- **Auto-tip bounds** (`AutoTip.tsx`): client validity checks are mirrored by a DB CHECK constraint per its own comment; write is `.select()`-guarded with an explicit zero-row report. Clean.
- **`get_service_role_key()`**: appears in `src/integrations/supabase/types.ts` as a callable RPC, which read as suspicious on sight. Read its defining migration (`20260506150000_cache_vault_secrets_via_stable_helpers.sql`): `REVOKE ALL … FROM PUBLIC, anon, authenticated` immediately after creation, correctly naming roles rather than relying on bare `PUBLIC` (the exact class of bug that reopened `open_jobs_browse`). No later migration re-creates or re-grants it. Live-confirmed via the one prod request this session used: anon call → `401`/`42501 permission denied`.
- **Ownerless-job null handling**: re-checked `useDashboardFilters.ts`, `useDashboardData.ts`, `adminAnalyticsHelpers.ts` for the "coalesce null to `''` in a comparison" and "null thrown inside `.filter()`" patterns named in the brief. `adminAnalyticsHelpers.ts`'s `customerJobsByUser` map-building is properly `if (j.customer_id)`-guarded before use as a Map key — initially looked like a bare-null-key bug, was not. `useDashboardFilters.ts:217`'s `allJobs.filter((j) => !!j.customer_id)` client-side excludes ownerless jobs from Browse — this is the same *class* of bug as the already-open "Browse header count disagrees with rendered list" OPEN.md item (a client-only predicate the server-side count doesn't subtract), but that specific predicate isn't named in the existing writeup. Not filed separately since it's the same root cause and remedy (subtract client-only predicates server-side, or null the count) already on the open list — flagging here only so whoever picks up that item knows this is a fourth contributor beyond the three named there.
- **Capacitor plugin await pattern**: spot-checked the newest plugin-adjacent files touched since 2026-09-10; all destructure at the dynamic-import site, consistent with the prior lane's 100%-clean finding. Not re-enumerated exhaustively (time-boxed).
- **Contact-scanner / disintermediation input class**: read `20260915020258_contact_scan_phone_digit_boundary_and_hidden_copy.sql` in full (298 lines, same day as this hunt). It fixes exactly the client-trust bug this brief is looking for — `apply_message_violation_consequence` used to strike a user based on whatever the *client* claimed was a violation, with no server-side re-check — and closes it: the RPC now only strikes when `contact_leak_reason` independently flags the same text server-side, and the internal ladder function has no anon/authenticated EXECUTE grant at all. Did not find a parallel unguarded consequence RPC for the applications/bio paths in the time available; flagging as **UNVERIFIED** rather than clean (see below), not as a finding.

## UNVERIFIED — could not reach, and why

1. **The exact predicate of `jobs_urgent_fee_required`.** Central to grading H-001's severity precisely (whether the bypass is `urgent_fee = NULL`, `urgent_fee = 0`, or genuinely closed and the 2026-09-03 comment is stale). Needs `pg_get_constraintdef` or equivalent DB introspection, which this session's anon-only key cannot reach. The verifier should run this before grading.
2. **Whether `scan_application_contact_info` (the applications/bio-path sibling of the messages contact scanner) got the same "recompute, don't trust the client" fix as `apply_message_violation_consequence` did today.** Read the migration's own text but did not trace the applications-path RPC source to confirm parity; time-boxed out of this pass.
3. **A live authenticated repro of H-001.** No test-account JWT available in this session; prod rules forbid sign-up. The verifier or a lane with test-account access should attempt the INSERT described above (against a throwaway/`is_seed` job) and, per the class-check above, check whether it's accepted.
4. **Full re-enumeration of the 1,137 changed files against every pattern in the brief.** This pass targeted the highest-risk surfaces (money, dispute, admin, realtime, XSS) rather than repeating the prior lane's exhaustive per-file count; a from-scratch 100% count would need materially more time/request budget than this run's constraints allowed.
