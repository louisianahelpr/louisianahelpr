# Full-app audit — Fable lead pass, 2026-08-23

**Head at close:** `690211b93` · **Base:** `05ac2ed25` · 8 commits shipped, all
gated (typecheck + 1734 vitest green each), all pushed direct to `main`.

Method: the language lane was done in the foreground; the three engineering
lanes (money formulas, client/edge parity + Stripe webhooks, RLS/authorization)
and were run as parallel `opus` sub-agents; the visual/interaction/a11y lane was
**not run** this pass (see coverage). Every engineering finding below was
established by a sub-agent and is quoted with `file:line`; RLS findings were
verified against the **live** database (`pg_policies`/`pg_proc`), money findings
against the source at HEAD plus the one real prod payout row.

---

## The mandate check

- **No number the app displays disagrees with the number it charges** — this
  bar is **not yet met.** Six display-vs-charge defects survive (B-series and
  M-series below); none moves money wrong *today* on real data, but three ship a
  figure to a user that the payout/charge path contradicts.
- **A reader can't tell different people wrote different screens** — closer after
  this pass: toasts, empty/error titles, the "Couldn't" voice, button casing,
  and the canonical noun are now uniform. The dialog-header backlog (Sheets) and
  the visual cohesion lane remain.

---

## APPLIED — shipped this pass (mechanically safe, no judgement risk)

**Second wave, 2026-08-24** (after the owner resolved the open decisions): the
$100 new-helper earnings cap and the unenforced "3 active jobs" block left the
published Community Rules (`afc00a120`); admin copy swept to "Helpr"
(`f4e8f1a5c`); 222 suppressed toast calls deleted (`93791628f`); actionable
toasts reopened (`fc4b395bb`); three posting tips stopped implying Helprs send
quotes, since bidding is gone (`b3a1f8c6b`).


| commit | what | scope |
|---|---|---|
| `afc00a1` | Removed the `$100` new-helper earnings cap from Community Rules + its dead constant. Arithmetically impossible (one avg job = ~$123 take-home vs a $100 cap needing 3 completions to lift) and enforced nowhere. | 2 files |
| `df132af` | (a) Terms payout window derives from `PAYOUT_HOLD_HOURS` instead of a typed "24–48 hour" range wider than the cron keeps. (b) Removed the "New Helpr account limits" block (3-active-jobs + probation) — enforced nowhere; `apply_to_job` has only the rate ladder. (c) AdminSettings' `run supabase db push` dev toast → human copy. (d) Drip emails: "Post a task" → "Post a job", "New tasks in your area" → "New jobs". (e) 18+ rule unified to one voice. | 6 files |
| `32edb0a` | Every **live** toast (`toast.error`/`toast.warning`) ends with terminal punctuation. See the punctuation ruling below. | 50 files |
| `1fa2f06` | Empty-state fragment titles drop the period (5:1 majority); error titles unified to "We couldn't load X." (replacing 11 bare "Couldn't load X."). | 16 files |
| `06e5846` | "Couldn't" beats "Could not" across `src/` (191 vs 33). | 6 files |
| `e0890a6` | **Fixed the red E2E** (`apply-dialog-fit.spec`) — red since the corner-X dialog refactor `6ebadde14`, before this session. Spec now matches the "Close" dismiss and treats the corner X as frame chrome. | 1 file |
| `fac35b7` | Title Case button-label sweep closed (the sweep `PLATFORM_CONVENTIONS §1` marked incomplete). ~96 labels, incl. hyphen both-halving and phrasal particles. `On`→`on` corrected in "Manage Payouts on Stripe". | 60 files |
| `690211b9` | Canonical noun reaches edge user-copy: status email "post tasks"→"post jobs", Stripe line items "Helpr Task:"→"Helpr Job:" / "Browse Tasks"→"Browse Jobs", Connect product "Local task…"→"Local job…". | 4 files |

### The toast-punctuation ruling (the brief asked for a decided rule)

Of 249 unique live toast strings the corpus already split 122 ending in a full
stop, 30 in the house "… — try again?" softener, 97 bare. A **no-punctuation**
rule can't hold: toasts here are sentence-case prose, frequently multi-clause and
sometimes multi-sentence, so many *must* carry internal punctuation and a bare
tail then reads as a truncation. A **full-stop** rule holds uniformly. **Decision:
every live toast ends with terminal punctuation** — the 97 bare strings take the
stop, the question-mark idiom keeps its mark, nothing is stripped. Applied to the
432 `toast.error` + 8 `toast.warning` that actually render (the ~230 suppressed
`success`/`info`/`message` were left — see the open decision below).

---

## REPORTED — needs a tone / money / legal / product decision (severity-ranked)

### CRITICAL — trust (load-bearing wall)

**R1 — Any authenticated user can permanently ban any other user.** `public.report_helper_no_show(p_job_id)` (SECURITY DEFINER, granted to `authenticated`) checks only that the caller owns the job — never that the named helper accepted it, that the start time passed, or that two reports came from different posters. The poster fully controls `jobs.helper_id` (the money-lock self-disarms while `payment_status='unpaid'`). Post two throwaway unpaid jobs, set `helper_id = <victim>`, call the RPC twice → victim is `permanently_banned`. Unprivileged, repeatable, irreversible without admin. *Verified against live DB.* Fix shape: require an accepted application, a passed start time, and distinct reporters. **This is release-blocking.**

**R2 — The pgmq email-queue wrappers are ungated.** `read_email_batch` / `enqueue_email` / `delete_email` / `move_to_dlq` (SECURITY DEFINER → `authenticated`, zero authorization, no queue allowlist). Any logged-in user can read every pending outbound email (bulk PII + embedded tokens), inject a message the worker sends *from the platform's domain* (phishing), or delete/timeout messages (delivery DoS). Fix shape: `has_role(auth.uid(),'admin')` + a queue allowlist, or revoke from `authenticated`.

### HIGH — trust / money

**R3 — A poster can mark an unpaid job "escrow funded."** The money-lock only engages once `payment_status <> 'unpaid'`, so the first `unpaid → escrow` write is unguarded. Fires the real "payment secured" notification to the helper and enters `auto-release-payment`. No funds move (`release-payout` re-verifies the PaymentIntent), but it's a turnkey do-the-work-never-get-paid lure and burns admin alerts. Fix: add `boosted_at`/`boost_expires_at`/`is_urgent`/the `escrow` transition to the lock.

**R4 — `get_helper_distances_from_job` deanonymizes home addresses.** SECURITY DEFINER, executable by **anon**, no ownership check, caller controls both the job coords and the `user_ids[]`. Post three jobs at chosen points, query the victim against each, trilaterate to ~100 m. On a platform that sends strangers to homes. Fix: gate to the job's owner / job participants.

**R5 — `release-payout` and `process-scheduled-payouts` pay different cents for the same job.** `Math.round(perHelperBudget * pct)/100` vs `(perHelperBudget * pct)/100` then round. 2,243 (budget, tier) pairs under $200 differ by 1¢; the `payout_transfers` ledger can't reconcile bit-for-bit across the two paths. Fix: one shared `helperCommission()` in `_shared/`.

**R6 — Four payout fallbacks pass `10` where the platform default is `12`.** `process-scheduled-payouts:123`, `create-payment:457,906`, `void-cancelled-payments:66`, `auto-release-payment:153` — `helperFees.ts:33` documents the default as `DEFAULT_TIER_FEE_PERCENT = 12` "so an unexpected value never under-charges the platform." On a tier-read failure the platform under-collects $4 per $200 job. `release-payout` is the one path that does it right (reads `platform_settings`, 500s rather than defaulting).

**R7 — Two entitlement-poll functions revoke paid tiers on a page view.** `check-pro-subscription` (invoked from `useDashboardData` on every dashboard mount) and `check-business-seat-subscription` (every `/business` mount) resolve the Stripe customer with `limit: 1`, and on no-match reach an **unconditional** `subscription_tier: null` write (`check-pro-subscription:173`) — the Supabase `error` is dropped (violates the "never drop the error" rule). A paying subscriber whose first-returned Stripe customer isn't the one holding the sub is downgraded on load. Compounds with the known `subscription_tier` last-write-wins collision (9 writers, no precedence) flagged in-code at `businessSeatGrant.ts:27`.

**R8 — `transfer.created` has no state precondition.** Its three siblings (`transferFailed/Canceled/Reversed`) all guard `.eq("payment_status","released")`; the one handler that *writes* `released` doesn't. A redelivery after a `transfer.failed` resurrects a failed payout to `paid`/`released` → helper permanently unpaid, every dashboard says paid. Fix: `.eq("status","pending")` on the ledger write, `.in("payment_status",["payout_pending","escrow"])` on the job write.

**R9 — `payment_intent.payment_failed` overwrites a funded job to `failed`.** No precondition; an out-of-order/retried failure on a PI that later succeeded flips `escrow → failed`, and `PaymentSuccess.tsx` then tells the poster "no money was ever taken" on funded escrow. Fix: `.in("payment_status",["unpaid",null])`.

**R10 — accepted-bid price is never applied (carried open from 2026-08-19).** `accept_application`/`accept_group_application` write `status`/`helper_id`/`response_deadline` but never copy `applications.proposed_price` into `jobs.budget`; only `respond_to_counter_offer` does. On the `accept_bids` path a poster who accepts a $200 bid funds escrow at the original budget. No live rows prove it yet (code-path gap). Adjacent: `enforce_bid_price_lock` only freezes the bid once viewed/countered, and the poster has whole-row UPDATE on `applications` — a poster who never marks-viewed can rewrite a bid down before accepting.

**R11 — A message recipient can rewrite the sender's messages.** The "mark as read" UPDATE policy (`USING/CHECK auth.uid()=receiver_id`) grants **whole-row** update with no column lock — recipient can rewrite `content`, swap `attachment_url`, clear `flagged_hidden`, set `sender_id`. Fabricated chat evidence in disputes; edited content never re-scans (scan is INSERT-only). Fix: column-lock UPDATE to `read_at` only.

### HIGH — display disagrees with what's charged (the mandate breaches)

**R12 — Instant-payout upsell invents a $1 flat fee that isn't charged.** `EarningsTab.tsx:470` — `"Stripe's standard 3% + $1 fee applies"`. The real fee is a flat 3%, no fixed add-on (`instantPayoutFee.ts`); at the $25 minimum it quotes $1.75 vs the actual $0.75 — a $1 overstatement, in the sheet that sells the perk, contradicting the dialog one tap later. Also mis-attributes a Helpr fee to Stripe. Replacement: derive from `instantPayoutFeeLabel()`.

**R13 — Boost dialog shows $3 to Basic/Pro posters charged $2.40.** `JobBoostDialog.tsx:32` gates the discount on `subTier==="elite"` only, but `create-boost-payment` applies the 20% discount to basic+pro. They see $3.00 + a "Free with Elite" upsell, then get charged $2.40 — a 60¢ gap and a silently-withheld advertised perk. `BOOST_DISCOUNT_PCT` has no client mirror. Replacement: mirror the constant, derive the shown price.

**R14 — The 1099 tax banner tells helpers $600, the same screen's disclosure says $20,000.** `EarningsTab.tsx:182` / `ThresholdBanner.tsx:42` fire "$600 mark" while `EarningsTab.tsx:458` and both legal pages say the $600 step-down was repealed and the threshold is $20k/200-tx federal. Any helper past $600 is told they may get a 1099-K they won't. Replacement: one shared threshold constant; correct the stale comment at `EarningsTab.tsx:171`.

**R15 — Payout headlines round UP instead of flooring.** `formatPriceFloor` exists for exactly this ("a payout figure may never read above the payout") and has **one** consumer (`JobPrice.tsx:113`); seven take-home headlines use `formatPrice` (rounds up): `IdentityHeader.tsx:484`, `WorkRecord.tsx:387` (labelled an "official earnings document"), `HelprWrapped.tsx:259`, `MonthlyGoalCard.tsx:91,233,258,259`, `RecentTransfers.tsx:22` (the actual Stripe-sent ledger). Up to 49¢ over per figure. Replacement: `formatPriceFloor` on every take-home headline; `JobCard` aria-label vs chip also disagree (a11y parity break).

**R16 — Helper analytics + admin payout math recompute from gross budget.** `fetchAnalytics.ts:87` sums full `budget` with no group split, no frozen `helper_fee_percent`, no urgent bonus → "Earnings by month" shows $300 on a 3-helper job that paid ~$88. `useAdminUserSummaries.ts:117` + `userDetail/JobsTab.tsx` use `|| 10` (should be `?? 10`), so a comped $0-fee job silently becomes 10%. Replacement: import `helperTakeHomeDollars`/`sumHelperTakeHomeDollars`.

### MEDIUM — reconciliation, parity, moderation

- **R17** `weekly-helper-report:108` emails group-job helpers N× their real earnings (no `/helpersCount`). Tips tile (`EarningsTab.tsx:146`) shows gross, helper receives net-of-Stripe (~$0.88 over per $20 tip). Admin dispute slider (`DisputeCard.tsx:179`) quotes dollars that never move at partial splits.
- **R18 — parity guards that don't bind.** `escrowTiming.parity.test.ts` asserts constants against literals restated *in the test*; the cron (`auto-release-payment`) hardcodes `48`/`24h` and imports nothing — change the cron, every test still passes. `earlyAccess.parity.test.ts` pins a migration superseded 2026-08-23. `formatPayoutDollars`↔`formatPriceFloor` byte-identical, no test. `PRODUCT_TO_TIER` copy-pasted into `check-pro-subscription` (drops `ONE_TIME_PRODUCTS`). `get_payout_batches` SQL hardcodes `0.029`. Fix pattern exists: `seatLimitLadder.parity.test.ts` resolves the *latest* migration and asserts non-empty.
- **R19 — latent RLS/PII leaks (currently 0 rows, fire on first use).** `evacuation_pets` anon-readable incl. `destination_address` (fires during a hurricane). `job-photos` is a **public** storage bucket behind a participant-scoped policy that a public URL bypasses. `reviews` SELECT is `USING(true)` (defeats moderation `status`). `is_licensed`/`is_insured` outside the `prevent_self_escalation` denylist → forgeable "Licensed/Insured" badges. 12 cron/sweep RPCs (`cleanup_stripe_webhook_events` destroys the idempotency ledger) executable by any authenticated user. `get_pending_invite_for_email` is an email-existence oracle.
- **R20 — `cancel_escrow` writes an illegal `payment_status='cancelling'`** the CHECK constraint rejects; path is currently unwired (no `src/` caller) but fails 100% the moment it is.

- **R21 — post-redirect confirmations are now silent (surfaced by the toast sweep).** Three flows had toast-only feedback on a channel that no longer renders, so they now complete with *zero* acknowledgement: returning from Stripe Connect onboarding (`?connect=success`, `PaymentTab.tsx`), returning from Pro subscription checkout (`?pro=success`, `UserProfile.tsx`), and the 30-minute inactivity sign-out (`useSessionTimeout.ts`), which dumps the user at `/login` with no explanation of why they were logged out. The dead branches were removed with the sweep; the *feedback gap* is the finding. Fixing it needs a surface decision (inline banner on the destination screen, not a toast) — reported, not fixed, on your call.

- **R22 — measured contrast misses, all brand tokens (Chrome, 1440, both themes; WCAG AA).** Computed against the worst gradient stop under the text, decorative `aria-hidden` numerals excluded, pseudo-element pills verified by screenshot before dismissal. Four patterns, each uniform site-wide, all needing a colour-token call, not a per-page edit:
  1. **Primary CTA ink-on-olive (dark): 4.33 vs 4.5.** `rgb(20,22,26)` on `rgb(122,128,77)` — every "Get Started"/"Post a Job"/submit button in dark mode is 0.17 under AA. One token nudge fixes every page.
  2. **Sienna accents on dark footer: 3.80 vs 4.5.** `rgb(212,103,53)` on `rgb(43,45,49)` — footer column headers ("Company"/"Legal"/"Follow") and the "· LA" wordmark suffix, every page.
  3. **Gold category label (light): 2.37 vs 4.5.** `rgb(196,142,49)` on `rgb(234,232,234)` — the Help Center "Payments & Escrow" uppercase label; worst offender measured.
  4. **Hero toggle unselected state: 3.19 light / 4.06 dark vs 4.5.** "I want to work" at 75% olivewood alpha.

### Open decisions (need your call — see pop-up)

- ~~**The ~230 suppressed toasts.**~~ **RESOLVED 2026-08-24.** Owner chose delete. 222 dead calls removed across 132 files (`93791628f`). Removing them orphaned the work that only fed them — empty `if/else` shells, a clipboard flag that only chose wording, and a per-login `profiles` round-trip that existed to greet by first name — all removed with them; net new lint debt zero. **Three were deliberately kept and the channel reopened for them** (`fc4b395bb`): a toast carrying an `action` is an affordance, not a confirmation (Undo-attachment, and the two "View" jumps), so `toastPolicy` now passes actionable toasts through and still swallows every actionless one. Pinned by `toastPolicy.test.ts`.
- ~~**lowercase "helper" across admin**~~ **RESOLVED 2026-08-24.** Owner: admins are users too. Swept to "Helpr" (`f4e8f1a5c`) across empty states, the IDV flag description, the formal-warning placeholder, the analytics funnel title and the dispute-split labels + `aria-label`. Internal identifiers (role strings, filter ids, CSV headers) deliberately left lowercase.
- **Document `<title>` conventions** mix "Dashboard — Helpr" vs "Complete your profile — Helpr" (Title vs sentence). Pick one.

---

## Deliberately NOT touched, and why

- **Every R-item above** — each touches money, legal, auth, or a product decision; the brief says flag, never silently reword/refactor. They are for your triage, not for a mechanical pass.
- **The visual / interaction / a11y lane** — not run this pass (see coverage). No screenshots taken, so per the standard nothing visual is claimed clean.
- **Eyebrows / subtitles** — retired (`display:none`); did not "restore" any.
- **`ForBusiness.tsx` local fee/seat duplication** — behind `BUSINESS_ENABLED=false`; dormant, reported not changed.
- **`statusLabels.ts`** — test-enforced; untouched.
- **Landing hero H1/subhead** — locked.

---

## Coverage manifest

| lane | who | status |
|---|---|---|
| **Language / copy / voice** | lead (foreground) | **DONE** — toasts, empty/error titles, "Couldn't" voice, button casing, canonical noun (src + edge). Applied list above. Open: suppressed toasts, admin "helper", doc titles (decisions). |
| **Money formulas** | opus sub-agent | **DONE (report)** — 4 seeds confirmed, ~15 recomputation sites, formatting-rule violations. R5/R6/R12–R16 above. Not applied (money = flag-not-fix). |
| **Client/edge parity** | opus sub-agent | **DONE (report)** — 15 parity tests classified (9 real, 3 inert), 21-row duplicate register. R18. |
| **Stripe / webhooks** | opus sub-agent | **DONE (report)** — 16 handlers, writer maps for 4 columns, dedupe sound. R3/R7/R8/R9. Two items VERIFY-LIVE (`charge.refunds` payload; `cancelling` constraint). |
| **Authorization / RLS** | opus sub-agent | **DONE (report), live-verified** — 93 tables, 174 definer fns, 10 buckets. R1/R2/R4/R10/R11/R19/R20. |
| **Visual / interaction / a11y** | — | **NOT RUN** — 57 routes × 4 widths × 2 themes + iOS sim not swept this pass. The single largest open lane. |

**Not reached, with reason:** the visual lane (browser pane + iOS sim) — deferred
to keep this pass to language + engineering-report; it is the recommended next
pass. Live-Stripe and live-mutation verification — excluded by the read-only
engineering brief; R-items flagged VERIFY-LIVE should be confirmed against
`pg_constraint` / a real webhook payload before code changes land.

**Release state:** typecheck + 1734 vitest green at HEAD; E2E fix pushed (CI
confirmation pending at time of writing). PR-ceremony-free per project rules.
