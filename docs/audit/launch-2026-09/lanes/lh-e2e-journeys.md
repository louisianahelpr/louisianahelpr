# lh-e2e-journeys — launch audit 2026-09

Two real accounts, two isolated browser contexts, prod data, dev server at
`localhost:8123`. Every claim below was produced by driving the app, not by
reading it.

**Accounts provisioned through the real `/signup` flow** (kept, for the verifier):

| Persona | Email | auth uid |
|---|---|---|
| Poster | `helpr-e2e-poster-0902@mailinator.com` | `71c56dfb-b326-4010-b960-b18dd3966e7f` |
| Helper | `helpr-e2e-helper-0902@mailinator.com` | `437de07d-1bd7-46c8-a451-6b46aa3bcad5` |

Password for both is in `scratchpad/j-lib.mjs`. Emails were confirmed with
`update auth.users set email_confirmed_at = now() where email = ...` (blanket
testing approval, 1 row each); no other row was touched.

---

## What I fixed

Five findings, each reproduced first, fixed, then re-measured. All pushed
directly to `main`.

| id | commit | what was wrong |
|---|---|---|
| EJ-003 | `ed372fab5` | `/signup` showed the raw GoTrue string **"email rate limit exceeded"**. Split `recognizedAuthError()` out of `friendlyAuthError` so signup can reuse the auth vocabulary without inheriting Login's fallback. Toast now reads "Too many attempts just now. Give it a moment and try again."; raw text still logged. |
| EJ-004 | `ed372fab5` | **"Edge Function returned a non-2xx status code"** shown verbatim to users (`userFacingError.ts:37` INTERNAL_PATTERNS). That is what supabase-js throws for any non-2xx from any of 71 `functions.invoke` sites; `userFacingError` has 30 callers, overlapping TipDialog, JobBoostDialog, ReferralSection, AdminDisputes and SecurityTab. Suppressed at the chokepoint; `npx vitest run src/lib/userFacingError.test.ts` → 20 tests pass, 2 new. |
| EJ-005 | `c57c1fb8f` | The **"Offer It to a Saved Helpr"** entry card vanished under the finger that tapped it. Its query was gated on `expandedOnce`, so the self-hiding guard could only fire *after* a tap. Now fetches on mount, matching its Repost sibling. |
| EJ-007 | `288e3f9c6` | The **Hire button was painted on top of the verification chip that justifies it**. Measured overlap with `elementFromPoint`: 62px @320, 51px @344, 35px @360, **20px @375**, 2px @393. Moved the chip to its own full-width line: 0px overlap at all five widths. |
| EJ-009 | `87a9fabe3` | The **draft flush-on-teardown had a hole exactly where its comment said it didn't**. Two stacked debounces (form 2s + hook 5s) meant the flush ran with an empty pending draft for the first ~2s of typing. Loss window measured before/after: 300ms and 1000ms went from LOST to kept. |
| EJ-006 | `0230742f4` | **Repost prefilled a 45-char title into a 32-char field and called the section DONE.** `maxLength` guards typing, not a prefill, and prod holds 8 jobs with titles up to 45 chars. Over-limit now reads as invalid in all four places that previously disagreed. |

## What I filed and did NOT fix

**EJ-001 (HIGH, candidate launch blocker) — signup is capped at ~3-4 accounts/hour, project-wide.**
Not fixable from the repo: the limit lives in the Supabase dashboard
(Auth → Rate Limits). Reproduced live — two real signups back to back, the 4th
in that hour returned HTTP 429 `email rate limit exceeded` and created no
`auth.users` row. `GET /auth/v1/settings` returns `mailer_autoconfirm:false`, so
a throttled user can never confirm and the account is unusable. No hour in 30
days has ever exceeded 3 signups. An `auth-email-hook` → Resend → pgmq path
exists, but GoTrue enforces its limit *before* calling the hook, so that
capacity is unused. Secondary: the queue drains on a 5-minute cron, so even
under the limit a confirmation email is up to 5 minutes late. Relayed to
`team-lead` for the owner and `lh-email-delivery`.

**EJ-008 (MEDIUM) — the real-money hard stop.** Recorded so the gap is explicit
rather than silently missing. See UNVERIFIED below.

## Retracted

**EJ-002** — I filed the shared-deep-link funnel break, then found it was
already BD-001, fixed at 14:42 that day in `deedc745b`, which was not in my
worktree. `origin/main` moved `b170609a → c24354a79` *during* my run. Re-tested
at current main: all three guest doors converge correctly on
`/dashboard?quickApply=<id>`. My first probe also read the wrong storage key —
the deep-link door sets `helpr.jobIntent`, not `helpr.signupRedirect`.

---

## Verified working (artifact per claim)

- **Signup, end to end.** Both accounts created through the real two-step form.
  Per-field validation copy is human and specific ("Add a profile photo", "Add
  your date of birth", "Add your city") — `Signup.tsx:136` enforces the avatar,
  `:145` the DOB, `:150` the city, all on submit rather than via a dead disabled
  button. Shots: `001-poster-signup-step1.png`, `001-poster-neg-no-avatar.png`,
  `003-poster-signup-result.png`.
- **The 18+ age gate is structural, not advisory.** The DOB wheel's year column
  stops at exactly 18 years before today and the month/day columns truncate to
  today's date in that year, so an under-18 date is unselectable. Enumerated all
  114 `[role=option]` values on 2026-09-02: months January..September, days 1..2,
  years 2008..1906. Shot `001-poster-dob-wheel.png`.
- **All three guest→auth doors preserve the job.** `/browse` card tap and
  `/jobs?job=` "Sign up to apply" both persist `helpr.signupRedirect`; the
  `/jobs/:id` deep link persists `helpr.jobIntent` (`ProtectedRoute.tsx:208`).
  All three land on `/dashboard?quickApply=34ccf004-b710-4458-bd28-d30734fa0d03`.
  Shots: `001-DOOR1-landing.png`, `002-DOOR2-landing.png`,
  `003-DOOR3-landing.png`.
- **All six post-a-job entry paths exist and work** (`001-E0-entry.png`): Start Fresh, Pick Up Your
  Draft, Repost (`?rebook=`), Use a Template (10 templates, budget prefilled),
  AI Job Builder, Offer It to a Saved Helpr (picker renders "ET / Eli
  Thibodeaux" and navigates to `?offerTo=11111111-1111-1111-1111-111111111104`).
  `EntryChoice.tsx:137` Start Fresh, `:163` draft, `:216` repost, `:307`
  template. Shots: `001-E0-entry.png`, `003-E2-draft-resumed.png`,
  `005-E3-template-applied.png`, `003-R2-repost-prefilled.png`,
  `005-R4-ai-open.png`, `002-OF-offerTo.png`.
- **Login lockout.** Five wrong passwords each get "That email or password
  doesn't match."; the sixth gets "Too many attempts — try again in 5 min.", and
  the lockout correctly also refuses the *correct* password (`Login.tsx:249`).
  Shots: `001-N1-lockout.png`, `002-N1-after-correct.png`.
- **Duplicate apply is guarded server-side**: "You've already applied to this
  job." Captured from `[data-sonner-toast]`; shot `007-Y-helper-dup.png`.
- **A poster opening their own job's share link** is routed to
  `/my-posts?highlight=<id>&filter=waiting` — DH-001 regression clean, no "you
  can't apply to your own post". Shot `001-Y-poster-own-link.png`.
- **Offline handling.** With the network cut: "No connection — You've dropped
  offline. Try again once you're back on…" plus a working Try again, and clean
  recovery on reconnect. Shots: `004-I2-offline.png`, `005-I2-recovered.png`.
- **The hire gate is correct and well-worded** (`004-H3-after-hire.png`). Hiring a helper with no Stripe
  Connect account is refused with "Hallie Helper hasn't finished setting up
  payouts yet, so they can't be hired. They'll show as ready once they do."
  Shots: `003-H2-deadline-dialog.png`, `004-H3-after-hire.png`.
- **Cross-account visibility is correct** (`002-H1-applicants.png`). Helper's feed shows the poster's job;
  poster's Applicants panel shows the helper by name with their message. No
  wrong-person leakage observed on any surface either persona reached. Shots:
  `001-X-helper-feed.png`, `002-H1-applicants.png`. Backing row:
  `select * from public.applications where job_id = 'e2e00000-0000-4000-8000-00000000ee02'`
  returned 1 row, status `pending`, helper `Hallie Helper`.

Two things that look like bugs and are not, recorded so nobody re-files them:

- **Browse prices are ~87.5% of `jobs.budget`** ($132 for a $150 job). That is
  the helper's earnings after platform commission, not a money bug. Shot
  `001-X-helper-feed.png`.
- **A newly posted job is invisible in browse for 20 minutes.** `open_jobs_browse`
  filters on `early_access_cutoff()`, a deliberate subscription perk (Elite 0
  min, Pro 10, Basic 15, free 20). Measured with
  `select public.early_access_cutoff(), now()` → `21:56:36` vs `22:16:36`, exactly
  20 minutes apart, so a fresh job needs `created_at` backdated or the feed looks
  broken (`open_jobs_browse` predicate; `src/lib/earlyAccess.ts:1`).

---

## UNVERIFIED — could not reach, and why

**Everything after "hire".** The owner's standing constraint is no live Stripe,
and the platform correctly refuses to hire a helper without a real Stripe
Connect payout account. So the journey stops at the refusal. Not driven by this
lane: **accept, on-my-way, arrived, working, mark-complete, poster confirm,
escrow release, payout, review in either direction, tip.** The stopping point is
`004-H3-after-hire.png`. Also not driven, for
the same reason: the checkout step itself, 3DS (`4000 0025 0000 3155`), decline
(`4000 0000 0000 9995`), expired card, and every interrupted-payment case my
mission lists (kill the network between accept and pay; force-quit after paying
before the success screen). **No ambiguous escrow state was observed, because no
escrow state was ever created.**

Also unverified:

- **A job taken while you are applying**, **accepting a withdrawn bid**, and
  **completing a cancelled job** — each needs a job past the hire gate.
- **Native / WKWebView.** Everything here is Chromium. `NativeLaunchRouter` and
  `RouteMemory` route restoration on native resume was not exercised; my
  backgrounding tests used real `beforeunload` and SPA unmount, and my one
  attempt at true lifecycle backgrounding failed (CDP
  `Page.setWebLifecycleState` → "Unidentified lifecycle state").
  `useDraftJob.ts:103` is the flush this would have exercised on device. The iOS resume path is genuinely untested by
  me.
- **The EJ-006 submit toast.** Field-level invalidity is proven; I could not
  reach `handleReview` because my seeded `location` string does not split into
  the form's four address fields, so the button stays disabled earlier in the
  chain. My test data, not the app.

---

## Coverage manifest

Routes and surfaces actually opened and operated:

`/signup` (both steps, valid + invalid) · `/signup-pending` · `/login` (valid,
6× invalid, lockout) · `/browse` (guest) · `/jobs?job=<id>` (guest preview) ·
`/jobs/:id` (guest bounce, authed redirect, own-post redirect) · `/dashboard`
(both personas) · `/dashboard?quickApply=<id>` · `/post-job` (entry step, all
six cards) · `/post-job` form step (Details + Logistics + Budget) ·
`/post-job?rebook=<id>` · `/post-job?offerTo=<id>` · `/my-posts` (collapsed,
expanded, Applicants panel, hire → ResponseDeadlineDialog → Send Offer) ·
`/my-jobs` (helper, before and after) · offline state · draft
save/resume/interrupt.

Viewports measured: 320 · 344 · 360 · 375 · 393.

Not opened: every admin view, all 18 profile tabs, messages, the checkout step,
and the whole post-hire lifecycle. Those belong to other lanes or sit behind the
money gate above.

## Note for `lh-test-ci`

`e2e/two-role-lifecycle.spec.ts` and `e2e/payment-lifecycle.spec.ts` live at
`e2e/`, not `e2e/happy-path/`, and **both are env-gated** —
`PLAYWRIGHT_TWO_ROLE=1` and `PLAYWRIGHT_TEST_USER_*` respectively.
`e2e-happy-path.yml` runs only `npm run test:e2e:happy`, which is the
`e2e/happy-path/` directory. So the two-role lifecycle — the exact journey this
lane exists to cover — has effectively **zero CI coverage**, and the spec that
documents it is skipped silently on every run.

## Reproducing

Seed SQL for the cross-account fixture. Removed after the run:
`select count(*) from public.open_jobs_browse` returned 10 rows, its original
value, and jobs/applications/favorite_helpers for both accounts returned 0 rows.

```sql
insert into public.jobs
 (id, title, description, category, date_needed, budget, status, payment_status,
  customer_id, location, zip_code, start_time, is_seed)
values
 ('e2e00000-0000-4000-8000-00000000ee02', 'Audit cross-account test job',
  'seed', 'cleaning', current_date + 4, 150.00, 'open', 'escrow',
  '71c56dfb-b326-4010-b960-b18dd3966e7f', '100 Audit Way, Lafayette',
  '70501', '11:00:00', true);
-- REQUIRED, or it will not appear in browse for 20 minutes:
update public.jobs set created_at = now() - interval '2 hours'
 where id = 'e2e00000-0000-4000-8000-00000000ee02';
```
