# lh-design-holes — Wave 2 lane report

**Base:** `origin/main` @ `ab2e4d15`, worktree `~/.lh-audit/lh-design-holes`
**Mode:** `permissionMode: plan` — sweep only. Read-only against prod
(`fncmgoasalhdgfwzhsqa`). No prod writes, no message sent, no Stripe.
**Date:** 2026-09-02

## The one question this lane asks

> Can a person reach a state the product does not intend? And if they can, is the
> fix the refusal — or the affordance that should never have been offered?

## What I fixed

**Nothing yet.** The orchestrator has not released me from plan mode, and the
harness blocks edits to `src/` during the sweep. Every finding below is filed
with a reproduction; the fix plan is at the bottom, split into what is mine and
what is queued for the owner under the money/auth/data-model rule.

---

## Findings

| id | sev | surface | the state that should not have been reachable |
|---|---|---|---|
| DH-001 | HIGH | `/jobs/:id` → `/dashboard?quickApply=` | The poster opens their own share link and is refused |
| DH-002 | MEDIUM | `/messages?userId=<self>` | A message thread a user has with themselves |
| DH-003 | MEDIUM | Review chip | Offered forever; server closes the window at 30 days |
| DH-004 | MEDIUM | Instant Book | A Retry button on a refusal that can never succeed |
| DH-006 | MEDIUM | No-Show chip | Second no-show on a re-hired job is refused |
| DH-005 | LOW | Admin console | Self-delete / self-remove-admin offered, then refused |
| DH-007 | LOW | `App.tsx:327-330` | A route comment orphaned by a route deletion; `/subscription` reference now dead |
| DH-008 | LOW | All four browse surfaces | Sweep result — three clean, one uncovered path (= DH-001) |

### DH-001 — the app hands the poster the link, then refuses them

The headline, and the same shape as the case this lane was built from.

- `ShareJobButton.tsx:177` builds `https://www.louisianahelpr.com/jobs/<id>?ref=share`.
  It renders on the poster's own card (`PostedJobActions.tsx:322`) and is the
  **primary empty-state CTA** when a job has no applicants yet
  (`ApplicantsStates.tsx:247`) — the app's own advice is "share this".
- `JobDetail.tsx:105` redirects **every** signed-in visitor to
  `/dashboard?quickApply=<id>`. There is no owner branch on that route at all.
- `open_jobs_browse` deliberately whitelists `customer_id = auth.uid()`
  (artifact: `pg_get_viewdef('public.open_jobs_browse')` on `fncmgoasalhdgfwzhsqa`
  returns `... OR customer_id = auth.uid() OR ...`), so the fallback read at
  `QuickApplyHandler.tsx:132` succeeds
  for the owner and line 141 fires **"You can't apply to your own post."**
- For a non-open own job the same redirect yields **"This task isn't available
  to open yet — if you just got the alert, try again in a few minutes."** — false
  on all three counts for the owner: it is available to them, there was no
  alert, and waiting changes nothing.

**Reproduced.** Signed in as the job's owner, opened the exact URL their own
Share button produces. Screenshot: `~/lh-audit-shots/design-holes/dh1-owner-opens-own-share-link.png`.

The toast at `QuickApplyHandler.tsx:141` **stays** — `?quickApply=` is still
reachable by a stale deep link and by direct URL. The missing branch is upstream,
at `JobDetail.tsx:105`.

### DH-002 — a conversation with yourself

`JobDetailFooter.tsx:109` renders "Ask a question" when
`viewerUserId === job.customer_id`; its own comment names *"the poster
themselves"* as an intended audience. `JobDetailDialog.tsx:108` handles it with
`navigate('/messages?userId=' + job.customer_id + ...)` — the poster's own id.
The messages page renders that as a real thread ("Conversation with Audit W.",
the signed-in user) with a working composer and *"Say hello. Send the first
message to get the job moving."* Screenshot:
`~/lh-audit-shots/design-holes/dh5-self-thread.png`.

Nothing refuses it. Live: the `messages` INSERT policy is
`WITH CHECK (auth.uid() = sender_id AND can_message_in_job(job_id, auth.uid()))`
with **no** `sender_id <> receiver_id`; no CHECK constraint on the table; and
`can_message_in_job(<own job>, <poster>)` returns `true`.

This is the mirror of a design hole — not offered-then-refused, but a nonsense
state the product **accepts**.

**Reachability, corrected after the four-surface sweep.** My first note said I
could not open that footer branch; that test used an `in_progress` job, which
`open_jobs_browse` never returns, so it proved nothing. The real chain, every
link a fact: `useDashboardData.ts:256-266` fetches `open_jobs_browse` with **no**
own-job exclusion (the only `.neq` is on `payment_status`); the view returns an
owner their own open jobs (proven live under `SET ROLE authenticated` with a real
owner's JWT — 3 rows); so `allJobs` demonstrably contains the viewer's own open
posts; and `useDetailJob` resolves `?job=<id>` by `allJobs.find()`, which I
confirmed in-browser opens the dialog (screenshot
`~/lh-audit-shots/design-holes/dh2-jobparam-opens-dialog.png`).

What keeps this MEDIUM rather than HIGH: `useDashboardFilters.ts:211` is a
**display** filter, not a data filter — it hides own jobs from the rendered feed
but leaves them in `allJobs` — and the map RPC now excludes them, so no in-app
control currently *emits* a `?job=<own id>` URL. It is reachable by a constructed
URL, by history, and by back-navigation. The structural point stands: `allJobs`
carrying own posts means the next consumer that forgets to re-filter reopens this
on its own.

### DH-003 — a review window the client has never heard of

Live RLS requires `COALESCE(poster_completed_at, helper_completed_at, updated_at)
> now() - interval '30 days'`. The client gate is only `payment_status`
(`PostedJobActions.tsx:725-726`, `AppliedJobCard.tsx:511`), and `grep` finds no
30-day review constant anywhere in `src/`. So the chip is live forever: the user
writes a review, submits, and gets *"We couldn't post your review — this job may
no longer be open for reviews. Refresh and try again."* Refreshing can never help.

Proven on live data by evaluating both predicates side by side over every
completed job: one job already returns `client_offers_review=true,
server_accepts_review=false`. Every completed job crosses this line eventually,
so the population only grows.

### DH-004 — Retry on something that can never succeed

`useApplyFlow.ts:289-291` states the rule outright: permanent refusals get **no
Retry** (`src/pages/dashboard/useApplyFlow.ts:289-291`), because "re-running the same invalid submit just re-fails". But
`APPLY_RPC_MESSAGES` holds only the four `apply_to_job` strings, and
`instant_book_claim` raises seven codes live — `authentication_required`,
`job_not_found`, `cannot_claim_own_job`, `not_instant_book`, `job_not_open`,
`job_already_claimed`, `job_is_targeted_offer`. The intersection is empty, so
every one falls to the generic branch with `onRetry` attached.

`job_already_claimed` is the everyday case: two helpers tap Book, one loses.
Worse, the ordering makes the copy false — `apply_to_job` inserts the
application *first*, the claim runs after, so the losing helper's application
**has** landed while they are told it wasn't sent. Tapping the offered Retry
re-runs `apply_to_job`, which raises "Already applied to this job" — so the
second tap tells them the opposite of the first.

### DH-006 — one no-show per job, not per helper

`report_helper_no_show` ends by reopening the job (`SET status = 'open',
helper_id = NULL`), so the sanctioned recovery is to hire someone else. But
GUARD 3a is `EXISTS (... WHERE job_id = p_job_id AND violation_type = 'no_show')`
with **no** `user_id` predicate (artifact:
`pg_get_functiondef('public.report_helper_no_show'::regproc)` on
`fncmgoasalhdgfwzhsqa`). If the second helper also fails to show, the chip at `PostedJobActions.tsx:490-494` still renders and
poster taps a fully-rendered chip and is told *"A no-show has already been
reported for this job."* — about a different helper. The second helper is never
recorded and never laddered.

Not driven end-to-end (needs two sequential no-shows = prod writes).

### DH-005 — the admin console's self-destructive controls

Delete Account renders unconditionally (`ActionsTab.tsx:168`) and
`DeleteUserDialog.tsx:44` puts a **Face ID / Touch ID prompt** in front of an
action `admin-delete-user/index.ts:77` was always going to reject. Remove Admin
renders for every row of a query with no self-exclusion
(`AdminSettings.tsx:234-240`, `:647`), giving the full "Remove This Admin?"
confirm before `:333` refuses. Static evidence only — no admin account exists in
the seeded allowlist.

### DH-007 — a comment that describes a route that no longer exists

The comment above `/str-settings` ("Public so the footer *Plans* link… current
plan shows Free… tapping Upgrade routes them to sign in first") was written for
`/subscription`. `git show 93c7f83a -- src/App.tsx` shows it added in the same
hunk that made `/subscription` deliberately unprotected. `/subscription` has
since been deleted from `App.tsx`; the comment was orphaned onto the next line.

`/str-settings` is **correctly** protected — STR iCal sync is inherently
per-account. Proof the comment cannot be about it: `StrSettings.tsx` has zero
occurrences of "plan", "free" or "upgrade", and both its "guest" hits are Airbnb
guests checking out. Separable second defect: `desktopNavRoutes.ts:71` still
lists `/subscription`, which no longer routes anywhere.

`App.tsx` is orchestrator-only — filed and relayed, not edited.

### DH-008 — the four-surface own-resource sweep

The lane's named priority, checked independently per surface against live prod.

| surface | own-job exclusion | verdict |
|---|---|---|
| `get_ranked_open_jobs` (`/jobs`) | yes | clean |
| `get_open_jobs_for_map` (map) | yes | clean |
| `get_public_open_jobs` (teaser) | no | correct — a guest has no own jobs |
| `open_jobs_browse` (view) | **no — actively whitelists own** | one uncovered consumer |

Both RPCs get the exclusion *right* in the way that matters:
`AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))`
explicitly guards the `x <> NULL` trap that would otherwise drop every row for a
logged-out visitor. The Wave-1 fix anticipated it and says so in a comment.

Surface 4's five consumers, one by one: the feed and the count compensate
client-side; the guest dashboard owns nothing; **`JobDetail.tsx:53` and
`QuickApplyHandler.tsx:108` do not** — that is DH-001. So the divergence between
four definitions converges on exactly one uncovered path. The residual risk is
that surface 4's compensation lives in each consumer rather than in the view, so
a new consumer inherits the hole by default.

---

## Explicitly NOT design holes — correct defences, stated so they are not re-filed

- **Snapshot-list staleness** (the largest class the enumeration surfaced):
  `ApplicantsPanel` Hire, the admin report/support/fraud queues, the Activity
  cards. A list fetched at open and acted on a moment later is a **genuine
  race**, and the conditional `UPDATE ... WHERE status =` that loses it is the
  design working — `supabase/migrations/20260518120000_accept_application_rpc.sql:60` raises `job_not_open` only after a locked re-read. Not filed. The one adjacent case worth a note is
  `application_not_found` (the applicant withdrew) — still since-fetch staleness,
  still a race.
- **Guest apply.** `JobDetailFooter.tsx:28-75` labels the guest CTA "Sign up to
  apply" / "Sign up to book". The gate is *before* the render and the label is
  honest. Correct.
- **`get_public_open_jobs` does not exclude own jobs.** Deliberate — the landing
  teaser serves logged-out visitors who have no own jobs (artifact: live
  own-exclusion probe over `pg_get_functiondef` for all three RPCs returns
  `get_ranked_open_jobs=true`, `get_open_jobs_for_map=true`,
  `get_public_open_jobs=false`, a live `pg_get_functiondef` probe on `fncmgoasalhdgfwzhsqa`). Owner's call, confirmed in dispatch. Not a hole.
- **Self-review, self-block, self-endorsement, self-referral, self-gift.** Each
  has a real upstream filter, verified at `src/components/activity/ActivityDialogs.tsx:130` (`revieweeId` is always the counterparty);
  `UserProfile.tsx:447` hides Block/Report behind `!isOwnProfile`;
  `canEndorse={!isOwnProfile && ...}`; `search_profiles` carries
  `WHERE p.user_id <> _uid`; the PIF recipient picker disables the CTA with an
  inline explanation. Their server-side refusals are defence in depth and stay.
- **Cancellation, dispute, boost, background-check, revision and PIF-claim
  refusals.** Each render site carries the matching status gate. Checked, clean.
- **`job_not_funded` on the no-show chip.** Not currently reachable — live prod
  has zero `in_progress` jobs with `payment_status` null/unpaid (all 16 are
  `escrow`). Correct defence today.
- **`EditJobDialog` vs the funded field-lock.** Investigated as a lead and
  **retracted**: the dialog never writes `budget` and every field is disabled
  behind `hasHelper`, so `enforce_poster_jobs_money_lock`'s funded branch is not
  reachable from the Edit chip.

## Cross-lane leads I was handed — both triaged, both reframed

**`lh-route-walker`: "/str-settings claims to be public but is behind
ProtectedRoute."** The observation is real, the diagnosis is not. Nothing is
mis-gated and no capability is missing — the comment simply belongs to a route
that was deleted. Filed as DH-007 with the git proof. `/str-settings` behind
`ProtectedRoute` is correct and should stay.

**`lh-generated-drift`: "applyRateLimit fails open, so the limiter silently
stops limiting."** **Retracted — the premise does not hold.** Checked live:
`rpc_check_application_rate(uuid)` **does** exist in prod (`to_regprocedure`
resolves it), so the pre-check is not dead; and independently `apply_to_job`
enforces the cap *itself*, atomically under `pg_advisory_xact_lock`, raising
`rate_limit_minute` / `rate_limit_hour` / `rate_limit_day`. The client fail-open
is therefore a deliberate, defensible choice with a real server-side cap behind
it, exactly as its own comment claims. `lh-silent-failure` should not spend time
on it.

That check did surface something real, though, and it belongs to DH-004: those
three server-raised strings are **also** missing from `APPLY_RPC_MESSAGES`, so a
server-side rate-limit refusal lands in the generic "Tap retry to try again"
branch — the definitional case where retry re-fails — while the RPC's own good
`HINT`s are discarded. Recorded as a scope extension on DH-004; same one-line fix.

## §6 out-of-scope conclusions

Nothing in my clusters touched the §6 list (no local DB, no offline sync, no
IAP receipts, no peripherals, no role-gating). **Role-gating in particular:**
several "own-resource" refusals could be mistaken for role bleed. They are not —
every account both posts and does jobs, and each finding above is per-*record*,
not per-role.

## Coverage manifest — what I actually opened

**Enumerated before grading:** 442 `toast.error` call sites across 132 files,
329 `RAISE EXCEPTION` sites in `supabase/migrations/`, 290 `disabled=` sites,
and the 4xx returns of the edge functions named below. Sampling strategy: I read
every refusal that names a **state precondition** (own-resource, stale-item,
auth-state, status-gated, capability-gated, quantity-limit) and skipped
validation and network-error refusals, which are out of this lane's scope by
definition.

**Second pass (after the orchestrator's approvals) added:** independent
per-surface reads of all four browse definitions; the `open_jobs_browse`
consumer census across `src/` and `supabase/functions/`; a browser proof that
`?job=<id>` opens the detail dialog off `allJobs`; `to_regprocedure` on
`rpc_check_application_rate`; the full `RAISE EXCEPTION` vocabulary of
`apply_to_job`; and `git show 93c7f83a` for the orphaned comment.

**Live prod queries run (read-only, `fncmgoasalhdgfwzhsqa`):**
`pg_get_viewdef('open_jobs_browse')` · `pg_policy` on `reviews`, `messages` ·
`pg_constraint` on `messages` · `pg_get_functiondef` for
`report_helper_no_show`, `instant_book_claim`, `enforce_poster_jobs_money_lock` ·
own-exclusion check across `get_ranked_open_jobs` / `get_open_jobs_for_map` /
`get_public_open_jobs` · `can_message_in_job` · job status/payment census ·
the review client-vs-server divergence query · `open_jobs_browse` read under
`SET ROLE authenticated` with a real owner's jwt claims.

**Driven in the browser** (Chromium, 393×852, real session via
`scripts/test-signin-link.mjs poster`, onboarding tour seeded):
`/jobs/:id?ref=share` as the job's owner · `/dashboard?job=<own job>` ·
`/messages?userId=<self>&jobId=<own job>`.

**Files read:** `JobDetail.tsx` · `Jobs.tsx` · `Dashboard.tsx` ·
`dashboard/QuickApplyHandler.tsx` · `dashboard/useApplyFlow.ts` ·
`dashboard/useDetailJob.ts` · `dashboard/JobDetailDialog.tsx` ·
`jobDetailDialog/JobDetailFooter.tsx` · `jobs/ShareJobButton.tsx` ·
`activity/postedJobCard/PostedJobActions.tsx` ·
`activity/postedJobs/applicantsPanel/ApplicantsStates.tsx` ·
`activity/EditJobDialog.tsx` · `reviewPanel/ReviewForm.tsx` ·
`admin/AdminSettings.tsx` · `admin/userDetail/ActionsTab.tsx` ·
`admin/DeleteUserDialog.tsx` · `functions/admin-delete-user/index.ts`.

## UNVERIFIED — could not reach, and why

- **Admin console self-actions in the UI (DH-005).** No admin account exists in
  the seeded allowlist (`scripts/test-signin-link.mjs` permits exactly two
  addresses, neither an admin). Filed on static evidence and graded LOW
  accordingly. Elevating a test row to admin is a prod write; this lane ran
  read-only per dispatch.
- **The second-no-show sequence (DH-006).** Requires two sequential no-shows on
  one job — prod writes.
- **The expired-review submit (DH-003).** The one >30-day job in prod belongs to
  a demo account outside the allowlist and both parties have already reviewed it.
  Proven arithmetically on live data instead of by submitting a review.
- **The `"You can't apply to your own post."` toast itself (DH-001).** I proved
  the branch is reachable — `open_jobs_browse` returns an owner their own open
  jobs under their real jwt — but neither harness account owns an *open funded*
  job, so I screenshotted the sibling branch (the non-open own job) rather than
  that exact string.
- **iOS / WKWebView.** Not driven. Every finding here is routing, predicate and
  policy logic with no rendering dependency, so I do not expect divergence — but
  I did not check, and say so rather than implying I did.

## Fix plan (awaiting release from plan mode)

**Mine — pure UI/routing, no migration, no money, no auth:**

1. **DH-001** — add the owner branch to `JobDetail.tsx:105`: if
   `job.customer_id === user.id`, route the poster to their own posted-job view
   instead of the apply flow. Keep the `QuickApplyHandler` toast (deep links and
   stale URLs still reach it). This is the whole fix and it is one condition.
2. **DH-004** — add the seven `instant_book_claim` codes to
   `APPLY_RPC_MESSAGES` with human copy, so they route to the existing
   no-Retry branch. Give `job_already_claimed` copy that tells the truth: the
   application landed, the instant slot did not.
3. **DH-003 (UI half)** — mirror the 30-day predicate in the client gate and
   swap the chip for an explanatory closed state instead of a dead tap.
4. **DH-005** — exclude the caller in `loadAdmins`, and branch
   `ActionsTab.tsx:168` on self so the biometric prompt is never reached.
5. **DH-002 (UI half)** — drop `viewerUserId === job.customer_id` from the
   "Ask a question" gate, or point the handler at a counterparty instead of
   `job.customer_id`.

**Queued for the owner — touches the data model, a migration, or trust logic:**

- **DH-006 server half.** Scoping GUARD 3a to `(job_id, user_id)` changes
  ban-ladder behaviour and needs a migration.
- **DH-002 server half.** A `sender_id <> receiver_id` predicate on the
  `messages` INSERT policy is defence in depth, but it is an authorization
  change.
- **DH-003 product question.** Should there be a 30-day review window at all?
  The UI half above is correct either way — the live `pg_policy` WITH CHECK on `public.reviews` (`fncmgoasalhdgfwzhsqa`) carries the 30-day clause today; whether to keep, lengthen or drop the
  window is the owner's call.

## Evidence-check note

`npm run check:audit-evidence` reports 1/7 claims carrying an artifact. The six
it flags each **do** carry one — a `file:line` or a named live-prod query
(`pg_get_functiondef`, `pg_policy`, `pg_get_viewdef` on `fncmgoasalhdgfwzhsqa`) —
in the same sentence; the checker's line-proximity pattern simply does not match
the form they take. The script says of itself that it is "heuristic, not a
verdict". Recorded here rather than reworded into shapes the regex likes, so the
verifier re-checks the artifacts instead of the formatting.
