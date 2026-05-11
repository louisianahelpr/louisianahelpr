# Sentry alert rules — paste checklist

**Companion to `SENTRY_ALERT_RULES.md`.** That doc has the full why-and-how. This one is a strip-down to the exact field values in the order Sentry's New Alert form presents them, so you can do all 9 in ~5 minutes without scrolling.

**URL:** https://helpr-4m.sentry.io/projects/javascript/alerts/new/issue/
**Type:** Issue Alert (NOT Metric Alert) for every rule below.
**Project:** javascript (default — already set by URL).

For each rule, the fields are:

1. **Rule name**
2. **Environment** (always `production`)
3. **When** (trigger)
4. **If** (filter conditions)
5. **Then** (action — set to your P0 / P1 / P2 notification target)

---

## ☐ Rule 1 — P0 — schema-drift errors

```
Name:        P0 schema drift — column missing
Environment: production
When:        A new issue is created
             OR an existing issue regresses
If:          The event's message value contains "does not exist"
             AND the event's message value does not contain "relation"
Then:        Send a notification to → [P0 target]
```

## ☐ Rule 2 — P0 — notifications.type CHECK violation

```
Name:        P0 — notifications.type CHECK violation
Environment: production
When:        A new issue is created
If:          The event's message value contains "notifications_type_check"
Then:        Send a notification to → [P0 target]
```

## ☐ Rule 3 — P0 — invalid job state transition

```
Name:        P0 — invalid job state transition
Environment: production
When:        A new issue is created
If:          The event's message value contains "Invalid job status transition"
Then:        Send a notification to → [P0 target]
```

## ☐ Rule 4 — P0 — payout ledger desync (money on fire)

```
Name:        P0 — payout sent but ledger missing
Environment: production
When:        A new issue is created
If:          The event's message value contains "transfer sent but ledger write failed"
Then:        Send a notification to → [P0 target] WITH @channel ping in Slack
             ↑ only rule where @channel is justified
```

## ☐ Rule 5 — P0 — chat-push trigger silently broken

```
Name:        P0 — chat push notification trigger failed
Environment: production
When:        A new issue is created
If:          The event's message value contains "send-push-notification"
             AND the event's message value contains any of: "failed", "error", "timeout", "non-2xx"
Then:        Send a notification to → [P0 target]
```

## ☐ Rule 6 — P1 — edge function 5xx burst

```
Name:        P1 — edge function 5xx burst
Environment: production
When:        An issue is seen more than 5 times in 1 hour
If:          The event's tags.source value equals any of:
             "stripe-webhook", "stripe-connect", "release-payout",
             "send-push-notification", "process-email-queue", "complete-signup"
Then:        Send a notification to → [P1 target]
```

## ☐ Rule 7 — P1 — Stripe Connect onboarding spike

```
Name:        P1 — Stripe Connect onboarding errors
Environment: production
When:        An issue is seen more than 3 times in 15 minutes
If:          The event's message value contains any of:
             "stripe-connect", "Failed to start onboarding",
             "Failed to complete onboarding", "account_link expired"
Then:        Send a notification to → [P1 target]
```

## ☐ Rule 8 — P2 — Stripe webhook signature mismatch (digest)

```
Name:        WARN — Stripe webhook signature mismatch
Environment: production
When:        A new issue is created
If:          The event's message value contains any of:
             "Stripe webhook signature failed", "STRIPE_WEBHOOK_SECRET is not configured"
Then:        Send a notification to → [P2 target — digest only, no real-time push]
```

## ☐ Rule 9 — P2 — rate-limit hits (digest)

```
Name:        WARN — rate limit triggered
Environment: production
When:        An issue is seen more than 20 times in 1 hour
If:          The event's message value contains "Rate limit exceeded"
Then:        Send a notification to → [P2 target — digest only]
```

---

## After all 9 are saved

Run the synthetic-trigger SQL block from the bottom of `SENTRY_ALERT_RULES.md` against prod (Supabase Studio → SQL Editor). Verify each rule fires in Sentry → Alerts → recent within ~60s. Tag each synthetic event `synthetic-test` then resolve it.

## If you skip / defer any

The two highest-value to ship first if you're time-constrained:
- **Rule 1** (schema drift) — caught both P0s this month. The single most useful alert in the set.
- **Rule 5** (chat-push) — the silent-failure mode that hid for an unknown duration before the May-9 audit. Without it, the next regression also goes silent.
