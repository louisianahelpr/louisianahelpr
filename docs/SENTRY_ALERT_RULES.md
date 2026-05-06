# Sentry alert rules — paste-ready specs

The Sentry MCP doesn't expose alert-rule creation, and the REST API
needs an API token I don't hold. Below are the rules to create
manually in the dashboard. Once these are in place, you'll get paged
on the failure modes that have actually bitten production.

## Where to create

https://helpr-4m.sentry.io/projects/javascript/alerts/new/issue/

## Rule 1: P0 — schema-drift errors

**Name:** `P0 schema drift — column missing`
**Project:** javascript
**Environment:** production
**When:** A new issue is created
**If:** The event's message value contains
  - `column "*" does not exist` (toggle "matches regex" or use partial-match: `does not exist`)
**Then:**
  - Send a notification to a Sentry team / on-call email
  - Optionally: Slack channel

**Why this matters:** The 2026-05-04 P0 was `column "p.role" does not exist`
and the 2026-05-05 trigger bug was `column "role" of relation "profiles"
does not exist`. Both were schema-drift issues where a trigger
referenced a column that had been dropped.

## Rule 2: P0 — notifications.type CHECK constraint violation

**Name:** `P0 — notifications.type CHECK violation`
**Environment:** production
**When:** A new issue is created
**If:** The event's message value contains
  - `violates check constraint "notifications_type_check"`
**Then:** Same notification target as Rule 1.

**Why:** The hidden P0 from 2026-05-03/04 was a check constraint
silently rejecting trigger-emitted notification types
(work_status, job_match, etc.) which broke `accepted → in_progress`
state transitions.

## Rule 3: P0 — invalid job state transition

**Name:** `P0 — invalid job state transition`
**Environment:** production
**When:** A new issue is created
**If:** The event's message value contains
  - `Invalid job status transition`
**Then:** Same notification target.

**Why:** The state-machine trigger raises this exception when an
unauthorized status flip is attempted. Indicates either a UI bug
sending a bad PATCH or a malicious tampering attempt.

## Rule 4: P0 — payout ledger desync

**Name:** `P0 — payout sent but ledger missing`
**Environment:** production
**When:** A new issue is created
**If:** The event's message value contains
  - `transfer sent but ledger write failed`
**Then:** Same notification target + page (this one is money-related).

**Why:** release-payout function logs this when Stripe successfully
sent a transfer but the payout_transfers ledger insert failed.
Money-on-fire scenario — can leak to a helper without an audit row.

## Rule 5: Stripe webhook signature mismatch (warn, not page)

**Name:** `WARN — Stripe webhook signature mismatch`
**Environment:** production
**When:** A new issue is created
**If:** The event's message value contains
  - `Stripe webhook signature failed`
  - OR `STRIPE_WEBHOOK_SECRET is not configured`
**Then:** Slack notification only (no page).

**Why:** stripe-webhook intentionally returns 200 on signature failure
to stop Stripe retries while emitting a loud Sentry/Slack alert.
This rule ensures someone sees it without paging.

## After creation

Test each rule by triggering a synthetic event through the
**Issues → Eyeball test** path (cowork has run these before — search
for `JAVASCRIPT-10/11/12` in the resolved issues list to see prior
synthetic triggers).
