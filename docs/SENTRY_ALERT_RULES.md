# Sentry alert rules — paste-ready specs

The Sentry MCP doesn't expose alert-rule creation, and the REST API
needs an API token I don't hold. Below are the rules to create
manually in the dashboard. Once these are in place, you'll get paged
on the failure modes that have actually bitten production.

## Where to create

https://helpr-4m.sentry.io/projects/javascript/alerts/new/issue/

Select **Issue Alert** (not Metric Alert) for everything below — these
fire on individual error events, not on aggregate metrics.

## Severity ladder

| Tier | Definition | Notification target |
|---|---|---|
| **P0 — page** | Money on fire, all users blocked, or silent data corruption. | On-call email + Slack channel (with `@channel`). |
| **P1 — alert** | Significant user-facing break for a sub-segment, or single-user data loss. | Slack channel (no `@channel`). |
| **P2 — digest** | Background noise worth reading weekly but not at 2am. | Sentry's weekly digest only. No real-time push. |

Configure the notification targets ONCE in Sentry → Settings →
Notifications, then point each rule at the right tier.

---

## Rule 1: P0 — schema-drift errors

**Name:** `P0 schema drift — column missing`
**Project:** javascript
**Environment:** production
**When:** A new issue is created OR an existing issue regresses (re-opens)
**If:** The event's `message` value
  - `contains` `does not exist`
  - AND `does not contain` `relation` (filters out "table missing" — different bug)
**Then:** P0 target.

**Why:** The 2026-05-04 P0 was `column "p.role" does not exist` and the
2026-05-09 trigger drift was `column p.role does not exist` (same root
cause, different migration). Both blocked job posting site-wide. The
"does not contain relation" tail filters out "relation public.X does not
exist" which is a different bug class (typo in a one-off script vs.
schema drift breaking a trigger).

---

## Rule 2: P0 — notifications.type CHECK violation

**Name:** `P0 — notifications.type CHECK violation`
**Environment:** production
**When:** A new issue is created
**If:** The event's `message` value `contains` `notifications_type_check`
**Then:** P0 target.

**Why:** The hidden P0 from 2026-05-03/04 was a check constraint
silently rejecting trigger-emitted notification types
(`work_status`, `job_match`, etc.) which broke `accepted → in_progress`
state transitions. Any future addition of a new notification type
without updating the constraint reproduces this exactly.

---

## Rule 3: P0 — invalid job state transition

**Name:** `P0 — invalid job state transition`
**Environment:** production
**When:** A new issue is created
**If:** The event's `message` value `contains` `Invalid job status transition`
**Then:** P0 target.

**Why:** The state-machine trigger raises this exception when an
unauthorized status flip is attempted. Indicates either a UI bug
sending a bad PATCH or a malicious tampering attempt — both worth
investigating immediately.

---

## Rule 4: P0 — payout ledger desync (money on fire)

**Name:** `P0 — payout sent but ledger missing`
**Environment:** production
**When:** A new issue is created
**If:** The event's `message` value `contains` `transfer sent but ledger write failed`
**Then:** P0 target. Add `@channel` ping in Slack — this is the only
rule where it's justified.

**Why:** `release-payout` logs this when Stripe successfully sent a
transfer but the `payout_transfers` ledger insert failed. Money-on-fire
scenario — can leak to a helper without an audit row, which means
reconciliation will silently undercount until manually reconciled.

---

## Rule 5: P0 — chat-push trigger silently broken (NEW 2026-05-09)

**Name:** `P0 — chat push notification trigger failed`
**Environment:** production
**When:** A new issue is created
**If:** The event's `message` value
  - `contains` `send-push-notification`
  - AND `contains` any of: `failed`, `error`, `timeout`, `non-2xx`
**Then:** P0 target.

**Why:** The May-09 post-mortem found `notify_helpers_on_message_post`
(and its 460000/480000 hotfixes) was unapplied to prod for an unknown
length of time — every chat message was failing to push silently. The
trigger doesn't surface in user UI, so the only way to detect it next
time is at the function-execution layer. Pattern fires on either
trigger-emitted exceptions or `send-push-notification` edge function
non-2xx replies.

---

## Rule 6: P1 — edge function 5xx burst (NEW 2026-05-09)

**Name:** `P1 — edge function 5xx burst`
**Environment:** production
**When:** An issue is seen more than `5 times` in `1 hour`
**If:** The event's `tags.source` `equals` any of the edge-function
tags (`stripe-webhook`, `stripe-connect`, `release-payout`,
`send-push-notification`, `process-email-queue`, `complete-signup`).
**Then:** P1 target.

**Why:** Single-shot edge function errors happen and self-heal (network
flake, Stripe API hiccup). A *burst* — 5 in an hour — usually means
the function is broken for a real reason: bad deploy, expired secret,
upstream API outage. Burst threshold avoids paging on noise.

---

## Rule 7: P1 — Stripe Connect onboarding abandonment spike (NEW 2026-05-09)

**Name:** `P1 — Stripe Connect onboarding errors`
**Environment:** production
**When:** An issue is seen more than `3 times` in `15 minutes`
**If:** The event's `message` value `contains` any of:
  - `stripe-connect`
  - `Failed to start onboarding`
  - `Failed to complete onboarding`
  - `account_link expired`
**Then:** P1 target.

**Why:** Helprs who can't finish Stripe Connect can't accept jobs and
silently churn. A handful of failures is noise; a spike inside 15 min
usually means a Stripe API regression or a config mismatch (e.g.,
return_url misconfigured after a deploy).

---

## Rule 8: P2 — Stripe webhook signature mismatch (digest only)

**Name:** `WARN — Stripe webhook signature mismatch`
**Environment:** production
**When:** A new issue is created
**If:** The event's `message` value `contains` any of:
  - `Stripe webhook signature failed`
  - `STRIPE_WEBHOOK_SECRET is not configured`
**Then:** P2 target.

**Why:** `stripe-webhook` intentionally returns 200 on signature
failure to stop Stripe retries while emitting a loud Sentry alert.
P2 because the retry suppression is the actual fix — the alert is
just for "did someone misconfigure the secret again."

---

## Rule 9: P2 — rate-limit hits (digest only)

**Name:** `WARN — rate limit triggered`
**Environment:** production
**When:** An issue is seen more than `20 times` in `1 hour`
**If:** The event's `message` value `contains` `Rate limit exceeded`
**Then:** P2 target.

**Why:** Rate limits firing under normal load = working as intended.
A *spike* (20+/hour) suggests either a credential-stuffing attack
worth investigating, or a legit user hitting limits we should
loosen. Digest is fine — not 2am-page worthy.

---

## After creation

Test each rule by:

1. **Synthetic trigger** — open a Supabase Studio SQL Editor and run
   one of these to fire the matching error in prod (each is harmless,
   just emits a log line):

   ```sql
   -- Rule 1 (does not exist)
   SELECT raise_exception('column "p.role" does not exist (synthetic test)');

   -- Rule 2 (notifications check)
   INSERT INTO public.notifications (user_id, type, title, message)
   VALUES ((SELECT id FROM auth.users LIMIT 1), 'definitely_not_a_real_type', 'test', 'test');

   -- Rule 3 (invalid state)
   -- Pick a job in 'completed' state, try to set back to 'open':
   UPDATE public.jobs SET status='open' WHERE status='completed' LIMIT 1;
   ```

2. **Verify the alert fired** in Sentry → Alerts → recent
   notifications (within ~60s).

3. **Resolve the synthetic event** in Sentry so it doesn't pollute
   the dashboard. Tag it `synthetic-test` first so future audits know.

## Tagging convention

Every alert rule above queries `event.message`. Sentry's UI lets you
combine that with `event.tags.<key>`. Useful tags Helpr already emits:

- `tags.source` — which function/component reported the error
  (`stripe-webhook`, `PayoutSetupForm.status`, etc.)
- `tags.user.id` — affected user (don't include in alert filters since
  it'd flood; useful for issue-detail triage)
- `tags.environment` — `production` vs `preview` vs `development`. All
  rules above filter to `production`; alerts on preview deploys would
  be noise from intentional break-test pushes.

## Maintenance

Re-audit this doc whenever:
- A new edge function ships (add to Rule 6's allowed sources)
- A new error class becomes "the thing that takes us down" — promote
  it from a P2/P1 to its own P0 rule
- An alert fires too often — either fix the underlying noise, or
  raise the threshold. **Don't ignore a noisy alert.** A muted alert
  is worse than no alert.
