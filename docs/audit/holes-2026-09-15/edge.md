# Edge Functions & Webhooks — hole hunt, 2026-09-15

Lens: every function under `supabase/functions/` treated as a publicly reachable HTTP
endpoint. 71 deployed functions (72 dirs less `_shared`).

Method: full source read of every Tier 1 function, targeted read of Tier 2, plus **39
live probes against prod** with the anon key and zero-effect payloads (dead UUID
`00000000-0000-4000-8000-00000000dead`, amounts `0`). Every "PROVEN" claim below
corresponds to a request actually sent; the request and response are shown.

## 1. Coverage

### 1.1 Dead-function check

```
$ node scripts/check-dead-edge-functions.mjs
✓ 71 edge functions checked; 0 known-unreferenced, 0 new.
```

No orphaned deployed function. Checklist item 8 closes clean.

### 1.2 The gateway is not a gate — read this before the table

`VITE_SUPABASE_PUBLISHABLE_KEY` is a legacy JWT (`eyJhbGciOiJI…`). Supabase's
`verify_jwt = true` accepts **any** structurally valid JWT, including the anon key that
ships in the public client bundle and every signed-in user's token. So a `verify_jwt`
stanza never restricts *who* may call a function — it only filters non-JWT bearers.
Every genuine authorization decision in this project is the in-function check.
`config.toml` says as much for `release-payout`; it is true everywhere.

Consequence for this audit: source-derived auth posture had to be confirmed by probe,
because "gateway default true" looks like protection and is not. One row below
(`send-push-notification`) reads as ungated in source and is in fact service-role-only —
caught by the probe, not the read.

### 1.3 Auth posture — all 71 functions

`stanza` = `config.toml` `verify_jwt`. `in-function gate` = the real control.
`probe` = observed HTTP status for an unauthenticated/anon call.

| # | function | stanza | in-function gate | probe | method |
|---|---|---|---|---|---|
| 1 | admin-delete-user | (default true) | user-jwt + has_role(admin) | 401 | read+probe |
| 2 | admin-resend-verification | (default true) | user-jwt + admin | 401 | read+probe |
| 3 | admin-test-push | (default true) | user-jwt + admin | 401 | read+probe |
| 4 | admin-update-email | **true** | user-jwt + admin | 401 | read+probe |
| 5 | admin-user-actions | (default true) | user-jwt + admin | 401 | read+probe |
| 6 | ai-job-builder | (default true) | user-jwt + rate-limit | 401 | read+probe |
| 7 | apple-app-store-notifications | false | **none** (re-fetch from Apple) | 500 | read+probe |
| 8 | auth-email-hook | false | standardwebhooks signature | 401 | read+probe |
| 9 | auto-expire-jobs | false | cron secret | — | read |
| 10 | auto-release-payment | false | cron secret | 401 | read+probe |
| 11 | auto-resolve-disputes | false | cron secret | — | read |
| 12 | auto-tip-charge | false | cron secret | — | read |
| 13 | backfill-job-geocode | false | cron secret | — | read |
| 14 | brand-asset | false | **none** (static public logo) | 405 | read+probe |
| 15 | calculate-tax | false | **none** (public quote) | 400 | read+probe |
| 16 | cash-out-credits | (default true) | user-jwt + rate-limit | **500** | read+probe |
| 17 | charge-recurring-visits | false | cron secret | — | read |
| 18 | check-pro-subscription | (default true) | user-jwt | **200** | read+probe |
| 19 | claim-gift-card | (default true) | user-jwt + rate-limit | — | read |
| 20 | cleanup-abandoned-accounts | false | cron secret | — | read |
| 21 | cleanup-notifications | false | cron secret | — | read |
| 22 | complete-signup | false | user-jwt + rate-limit | 401 | read+probe |
| 23 | contact-support | false | public + rate-limit | 400 | read+probe |
| 24 | create-bgc-payment | (default true) | user-jwt + rate-limit | — | read |
| 25 | create-boost-payment | (default true) | user-jwt + rate-limit | — | read |
| 26 | create-gift-card-checkout | (default true) | user-jwt + rate-limit | — | read |
| 27 | create-notification | (default true) | user-jwt + self/admin/job-party | 401 | read+probe |
| 28 | create-payment | false | user-jwt + rate-limit | **500** | read+probe |
| 29 | create-pro-checkout | (default true) | user-jwt | — | read |
| 30 | daily-match-digest | (default true) | cron secret | 401 | read+probe |
| 31 | delete-own-account | (default true) | user-jwt + rate-limit | — | read |
| 32 | email-tracking | false | public pixel + token | 400 | read+probe |
| 33 | email-unsubscribe | false | HMAC token in link | 400 | read+probe |
| 34 | engagement-automations | false | cron secret | — | read |
| 35 | execute-dispute-split | (default true) | user-jwt + admin | 401 | read+probe |
| 36 | expire-subscriptions | false | cron secret | — | read |
| 37 | expiring-jobs-push | false | cron secret | — | read |
| 38 | health-check | false | cron secret / service / admin | 401 | read+probe |
| 39 | helpr-pass-wallet | (default true) | user-jwt + rate-limit | **500** | read+probe |
| 40 | instant-job-match | (default true) | cron secret OR user-jwt | — | read |
| 41 | instant-payout | (default true) | user-jwt + rate-limit | 401 | read+probe |
| 42 | mapkit-token | false | **none** (conditional origin lock) | **200** | read+probe |
| 43 | marketing-publish | false | cron secret + kill switch | 401 | read+probe |
| 44 | marketing-token-health | false | cron secret | — | read |
| 45 | money-reconciliation | false | cron secret | 401 | read+probe |
| 46 | notify-email-change | (default true) | user-jwt + rate-limit | — | read |
| 47 | pay-onboarding-fee | (default true) | user-jwt + rate-limit | — | read |
| 48 | payment-confirm-reminder | false | cron secret | — | read |
| 49 | pro-customer-portal | false | user-jwt | — | read |
| 50 | process-email-queue | false | cron secret | — | read |
| 51 | process-scheduled-payouts | false | cron secret | 401 | read+probe |
| 52 | release-payout | false | cron / service / admin JWT | 401 | read+probe |
| 53 | resend-webhook | false | `resend.webhooks.verify()` | 401 | read+probe |
| 54 | review-nag-cron | false | cron secret | — | read |
| 55 | saved-helper-availability-push | (default true) | cron secret | — | read |
| 56 | send-account-status-email | false | cron / service / admin | — | read |
| 57 | send-marketing-blast | (default true) | user-jwt + admin | — | read |
| 58 | send-notification-email | false | service-role bearer | 401 | read+probe |
| 59 | send-push-notification | false | service-role bearer (index.ts:388) | 401 | read+probe |
| 60 | slack-ops-alert | (default true) | cron secret | 401 | read+probe |
| 61 | str-ical-sync | (default true) | cron secret OR user-jwt | — | read |
| 62 | stripe-connect | false | user-jwt | — | read |
| 63 | stripe-idv-start | (default true) | user-jwt + rate-limit | — | read |
| 64 | stripe-idv-webhook | false | Stripe signature | 200 (`missing_signature_header`) | read+probe |
| 65 | stripe-payouts | (default true) | user-jwt | 401 | read+probe |
| 66 | stripe-webhook | false | Stripe signature | 200 (`missing_signature_header`) | read+probe |
| 67 | subscription-reconciliation | false | cron secret | — | read |
| 68 | verification-webhook | false | per-vendor HMAC / Stripe sig | 401 w/ vendor | read+probe |
| 69 | verify-apple-iap | (default true) | user-jwt | — | read |
| 70 | void-cancelled-payments | false | cron secret | 401 | read+probe |
| 71 | weekly-helper-report | false | cron secret | — | read |

### 1.4 Requires auth vs deliberately public

**Deliberately public, no caller identity (5):** `brand-asset`, `calculate-tax`,
`mapkit-token`, `email-tracking`, `email-unsubscribe`. Plus `contact-support`
(public by design, rate-limited). All six are justified in `config.toml` or in-file;
`mapkit-token` is EF-04 below.

**Public endpoint, authenticity by signature (5):** `stripe-webhook`,
`stripe-idv-webhook`, `verification-webhook`, `resend-webhook`, `auth-email-hook`.
All five verify before any side effect — confirmed by read AND probe.

**Public endpoint, authenticity by authoritative re-fetch (1):**
`apple-app-store-notifications` — deliberately does not rely on the JWS signature;
re-pulls the transaction from Apple. Documented at index.ts:7-19. Defensible; see EF-06.

**Service-role bearer only (2):** `send-notification-email`, `send-push-notification`.

**Cron-secret only (26):** the `auto-*`, `cleanup-*`, `expire-*`, `process-*`,
`*-reconciliation`, `*-cron`, `*-push`, `*-report`, `marketing-*`, `void-*`,
`engagement-automations`, `payment-confirm-reminder`, `backfill-job-geocode`,
`slack-ops-alert`, `daily-match-digest`, `saved-helper-availability-push`.

**Dual-mode, cron secret OR user JWT (4):** `health-check`, `instant-job-match`,
`str-ical-sync`, `release-payout`.

**User JWT required (22):** the remaining checkout/profile/account functions.

**Admin role required (7):** `admin-delete-user`, `admin-resend-verification`,
`admin-test-push`, `admin-update-email`, `admin-user-actions`, `execute-dispute-split`,
`send-marketing-blast`.

### 1.5 Tiering actually applied

- **Tier 1, full read (30):** all money/auth/admin/webhook functions named in the brief.
- **Tier 2, targeted read against the 8-point checklist (33).**
- **Tier 3, existence + reachability only (8):** `cleanup-notifications`,
  `expiring-jobs-push`, `weekly-helper-report`, `review-nag-cron`,
  `saved-helper-availability-push`, `backfill-job-geocode`, `marketing-token-health`,
  `email-tracking`. Cron-gated, non-money, no client-supplied identity.

### 1.6 Not covered, and why

- **No authenticated-session probes.** I hold only the anon key, so every probe is the
  unauthenticated case. Authorization *between* two signed-in users (e.g. can helper A
  drive `create-payment` on helper B's job) is asserted from source, never executed.
  EF-02 is PLAUSIBLE for exactly this reason.
- **No webhook replay tests.** Would require a valid provider signature.
- **`str_processed_events` dedupe not verified live** — no read-only SQL available.

## 2. Findings

Severity is CRIT/HIGH/MED/LOW. Status is PROVEN (executed something that
demonstrated it) or PLAUSIBLE (code-read only).

---

### EF-01 · MED · PROVEN · `check-pro-subscription` answers HTTP 200 "not subscribed" on *any* internal error, defeating the client's own guard

**Where:** `supabase/functions/check-pro-subscription/index.ts:291-305` (outer catch);
client consumer `src/hooks/useDashboardData.ts:541-557`.

**Repro (executed):**
```
POST $VITE_SUPABASE_URL/functions/v1/check-pro-subscription
Authorization: Bearer <anon key>   # no user session
→ HTTP 200
  {"subscribed":false,"tier":null,"fallback":true,"error":"Internal server error"}
```

A blanket `catch` converts every failure — Stripe unreachable, network blip, auth
hiccup — into `HTTP 200 {subscribed:false, tier:null}`. The surrounding code clearly
intends the opposite: the profile-read branch (`:56`) correctly returns **503**, and the
revoke-write branch (`:281-283`) deliberately preserves `profile.subscription_tier` on
failure. The outer catch overrides both for everything else.

The client guard is defeated by the status code specifically.
`useDashboardData.ts:546` reads:

```ts
// unwrap surfaces an edge-function failure as the query's error state
// instead of silently treating the user as a non-subscriber.
const data = unwrap(await supabase.functions.invoke("check-pro-subscription"));
return data?.subscribed ? (data.tier as string) : null;
```

`unwrap` only raises on a non-2xx. Because the server returns **200**, `unwrap` sees no
error, and line 547 maps the fallback body to `null` — the exact "silently treating the
user as a non-subscriber" outcome the comment says it prevents. A guard that reads as
implemented and is not.

**Impact:** during any Stripe/network blip a paying Pro/Elite member's membership chip
and early-access state silently drop to free, and nothing alerts because the call is a
200. Bounded to display: `useDashboardData.ts:551-553` notes the tier is "a label, not a
gate" and every money decision recomputes server-side. That cap is why this is MED and
not HIGH — but it is a paying customer being shown that they are not a member.

**Suggested fix:** in the outer catch, distinguish auth failure (401) from internal
failure (503) and stop emitting a subscription verdict on the error path; let the client
keep `placeholderData` (the profile column) rather than overwrite it with `null`.

**CI class check:** assert no edge function returns HTTP 200 from a `catch` block whose
body also carries an `error` key — a fail-open response shape, greppable across all 71.

---

### EF-02 · MED · PLAUSIBLE · `create-notification` lets any job counterparty send unlimited arbitrary-content Helpr-branded notifications, emails and push

**Where:** `supabase/functions/create-notification/index.ts:104-160` (authorization),
`:260-268` (email chain), `:296-308` (push fan-out). No `checkRateLimit` import —
confirmed: `grep -c checkRateLimit create-notification/index.ts` → `0`.

**Repro (not executed — would write a real row and send real mail to a real user, which
the prod rules forbid):**
1. Attacker signs up, applies to any job the victim posted. That alone satisfies the
   `myAppOnTheirJob` branch at `:147-152`.
2. Attacker `POST /functions/v1/create-notification` with their own valid JWT and
   `{user_id: <victim>, title: <arbitrary 200 chars>, message: <arbitrary 1000 chars>,
   type: "payment", link: "/profile?tab=payment"}`.
3. The function inserts the notification, then at `:261` calls `send-notification-email`
   **with the service-role key** — the attacker's copy is rendered into a Helpr-branded
   HTML email — and the insert trigger fans out a push.
4. Repeat without limit.

**Impact:** a phishing and harassment primitive. The attacker chooses the title, body and
`type` (`"payment"`, `"financial_alerts"` are on the allowlist at `:12-35`), and the
message is delivered over three channels wearing Helpr's brand. `sanitizeLink` (`:42-53`)
correctly confines the *link* to a same-origin path, but the 1000-char free-text body can
carry any URL as plain text in the email. With no rate limit this is also an email/push
bomb against a specific user.

The widened authorization at `:104-115` was a deliberate fix for a real bug (the old
self-or-admin rule 403'd every legitimate lifecycle notification), so the relationship
requirement is right. What is missing is that widening it turned an admin-only broadcast
primitive into a user-reachable one without adding a budget or constraining the copy.

**Suggested fix:** add `checkRateLimit` (this function is the only client-reachable
notification producer that lacks it while 18 siblings have it), and for non-admin callers
take the copy from a server-side template keyed by `type` rather than from the body.

**CI class check:** assert every edge function that both (a) accepts a body-supplied
`user_id` and (b) triggers an outbound email or push imports `checkRateLimit`.

---

### EF-03 · MED · PROVEN · Auth rejection returns HTTP 500 on three money endpoints, poisoning the one signal that says a charge broke

**Where:**
- `supabase/functions/cash-out-credits/index.ts:45` `throw new Error("Not authenticated")` → outer catch `:206-210` → `status: 500`
- `supabase/functions/create-payment/index.ts` — same shape
- `supabase/functions/helpr-pass-wallet/index.ts` — same shape

**Repro (executed):**
```
POST .../functions/v1/cash-out-credits   {"amount":0}   → HTTP 500 {"error":"Internal server error"}
POST .../functions/v1/create-payment     {"action":"escrow","jobId":"…dead"} → HTTP 500 {"error":"Not authenticated"}
POST .../functions/v1/helpr-pass-wallet  {}             → HTTP 500 {"error":"Not authenticated"}
```
Contrast the correct shape from siblings on the same probe run:
`instant-payout` → `401 {"error":"Not authenticated"}`, `stripe-payouts` → `401`,
`ai-job-builder` → `401`, `release-payout` → `401`.

**Impact:** two concrete harms, both on money paths.
1. **Observability.** CLAUDE.md's standing rule is that a money-path failure must be
   *noticed*. Every unauthenticated hit — bot scanning a public URL, a mobile client
   resuming on an expired session — now books a 500. The 500 rate on checkout and cash-out
   is therefore dominated by noise, so a real 500 is undetectable in it.
2. **Client behaviour.** A 500 conventionally means "retry"; a 401 means "re-authenticate".
   A user whose session expired mid-flow gets retry-shaped failure instead of a sign-in
   prompt.

Not a privilege escalation — the request is correctly refused in all three cases. This is
an error-propagation defect, which is checklist item 6.

**Suggested fix:** return 401 from the auth branch before the generic catch, matching
`instant-payout`.

**CI class check:** probe every edge function unauthenticated in the existing
`edge-function-smoke.yml` and assert the status is 401/403 — never 5xx. (Worth noting:
the smoke workflow runs daily but does not currently assert this, which is why three
functions drifted.)

---

### EF-04 · MED · PROVEN · `mapkit-token` mints unlimited origin-unrestricted Apple MapKit tokens to anonymous callers

**Where:** `supabase/functions/mapkit-token/index.ts` — `originClaimFor` returns null with
no `Origin` header, then `if (origin) payload.origin = origin`. `config.toml`
`[functions.mapkit-token] verify_jwt = false`.

**Repro (executed):**
```
POST .../functions/v1/mapkit-token   (no Origin header)
→ HTTP 200 {"token":"eyJhbGciOiJFUzI1NiIsImtpZCI6IjRRQThKOVRBOEsi…"}
```
Decoded payload of the token issued:
```json
{ "iss": "P85MCK558V", "iat": 1789447785, "exp": 1789451385 }
```
**No `origin` claim.** One hour of validity, usable from any domain, re-mintable on demand.

**Honest scoping:** `config.toml` already documents this carve-out (added 2026-09-10) and
explains why it exists — the native WebView is a `capacitor://` context Apple cannot match.
Not claiming the carve-out is undocumented. What is new here is (a) live proof that an
anonymous caller actually receives an unrestricted token, and (b) a consequence the config
comment does not weigh: it frames the risk purely as "works on any domain", not as **quota
and cost**.

**Impact:** the anon key is public by definition (it ships in the client bundle). Anyone can
mint MapKit JS tokens against developer team `P85MCK558V` without limit and without
attribution. Apple MapKit JS bills/limits on daily map-view quota; exhausting it takes maps
down for real users, and there is no rate limit on this endpoint to bound it.

**Suggested fix:** keep the no-Origin carve-out, but add `checkRateLimit` keyed on the
server-derived IP, and emit the native case as a distinct short-TTL token rather than an
unconstrained one.

**CI class check:** assert every `verify_jwt = false` function with no in-function auth
gate imports `checkRateLimit` — currently `mapkit-token`, `calculate-tax` and `brand-asset`
are the unauthenticated set, and only `contact-support` among the public ones is limited.

---

### EF-05 · LOW · PLAUSIBLE · A zero-row ledger update in `transfer.failed` / `transfer.canceled` is indistinguishable from success, silently skipping the unpaid-helper re-queue

**Where:** `supabase/functions/stripe-webhook/handlers/transferFailed.ts:21-30` and
`transferCanceled.ts:18-27`.

```ts
const { data: failedLedger, error: ledgerErr } = await supabase
  .from("payout_transfers")
  .update({ status: "failed", … })
  .eq("stripe_transfer_id", transfer.id)
  .select("job_id")
  .maybeSingle();
```

**Repro:** deliver a `transfer.failed` whose `stripe_transfer_id` has no matching
`payout_transfers` row (a transfer created outside `release-payout`, or one whose ledger
insert lost a race). The UPDATE matches zero rows → `{data: null, error: null}` →
`ledgerErr` is falsy, so the error branch is skipped → `failedLedger?.job_id` is undefined
→ the entire re-queue block at `:106-131` is skipped. The job stays in `released` with no
funds delivered and the payout cron never retries it.

This is precisely CLAUDE.md's "a null `error` is not a write" class. Both files handle the
*error* case immaculately (critical Slack page + throw) and the *zero-row* case not at all —
the one case the rule exists for.

**Impact bounded by:** the trailing `postSlackOpsAlert` at `transferFailed.ts:134` still
fires at severity `warning`, so a human does get a signal — it just does not say the ledger
row was missed, and it is a warning rather than the critical page every other branch here
raises. Hence LOW, not MED.

**Suggested fix:** treat `!failedLedger` as its own branch with a critical alert, mirroring
the `rollbackIdempotency` zero-row handling the same codebase already does correctly in
`stripe-webhook/index.ts:272-281`.

**CI class check:** lint rule — any `.update()`/`.delete()` with `.select(…)` must branch on
an empty result, not only on `error`. The pattern is already used correctly in 3 places, so
the rule has a positive control.

---

### EF-06 · LOW · PROVEN · `apple-app-store-notifications` returns 500 for a payload it can never process, inviting three days of Apple retries

**Where:** `supabase/functions/apple-app-store-notifications/index.ts:177-182`.

**Repro (executed):**
```
POST .../functions/v1/apple-app-store-notifications  {"signedPayload":"x"}
→ HTTP 500 {"ok":false,"error":"Internal server error"}
```

`decodeJwsPayload` throws on a malformed `signedPayload` and lands in the outer catch,
which 500s. The file's own contract at `:60-64` says the opposite: *"ALWAYS 200 on anything
we understood well enough to not want retried… Apple retries a non-2xx for up to three days
with increasing backoff."* A structurally invalid payload is the clearest possible case of
"will never succeed on retry", and it is the one case that gets a retry.

**Impact:** low in practice — real Apple traffic sends well-formed JWS. It matters because
the endpoint is unauthenticated, so anyone can cheaply push malformed payloads, and because
it makes genuine decode regressions look like transient faults.

**Suggested fix:** wrap `decodeJwsPayload` and `ack("malformed_payload")` on failure,
reserving the 500 for the genuine Apple-unreachable / DB-down cases the comment describes.

**CI class check:** assert each webhook's retry contract — a unit test per handler feeding a
malformed body and asserting the documented status (200-ack vs 5xx-retry) matches the file's
stated policy.

---

### EF-07 · LOW · PLAUSIBLE · Stripe webhook signing-secret prefix and exact length written to logs on every request

**Where:** `supabase/functions/stripe-webhook/index.ts:62` and `:151`.

```ts
console.log(`[STRIPE-WEBHOOK] 🔐 Webhook secret loaded (prefix: ${webhookSecret.slice(0, 8)}..., length: ${webhookSecret.length})`);
```

**Repro:** every invocation logs it; `:151` additionally logs the first 8 chars of *each*
configured secret on a verification failure.

**Impact:** genuinely small — `whsec_` is 6 of those 8 characters, so ~2 characters of
entropy leak, plus the exact length. It is still a signing secret partially written to a log
sink on every request, violating checklist item 3 ("secrets… never logged"), and the length
disclosure narrows an offline attack. Filed at LOW because exploitation is not realistic;
filed at all because the rule is absolute and the fix is free.

**Suggested fix:** log a boolean (`configured: true`) and the count of secrets, never bytes
of the secret.

**CI class check:** grep gate forbidding any `console.*` whose argument interpolates a
variable matching `/secret|key|token/i` with `.slice(` — catches the whole class.

## 3. Explicitly checked and clean

Recorded so a future pass does not re-derive these.

- **Signature before side effect:** all five signed webhooks verified before any DB write.
  `verification-webhook`'s `200 {"received":true}` on an unknown vendor is a deliberate
  no-op branch (`index.ts:82-89`), **not** an accepted forgery — re-probed with
  `x-vendor: checkr` + a bogus signature and got `401`.
- **`transfer.failed` / `transfer.canceled`:** both handled, both reset the false terminal
  `released` state, both refuse to re-queue a job carrying a live dispute
  (`_chargebackHold.ts`). Only the zero-row edge (EF-05) is open.
- **Client-supplied amounts:** `create-payment` escrow derives from `job.budget`
  (`index.ts:480`); the tip path validates `amount` as finite and bounded $1–$1,000
  (`:1044-1050`) and authorizes `user.id === job.customer_id` (`:1056`); the partial-refund
  path bounds `amountCents` against the job total (`:1870`).
- **Client-supplied user ids:** only 5 functions read one from the body; all 5 either
  require admin or, in `create-notification`, enforce a relationship check with a UUID pin.
- **Idempotency:** every one of the 14 charge/transfer-creating functions passes a Stripe
  `idempotencyKey`.
- **CORS:** every function sends `Access-Control-Allow-Origin: *`, and **no function sets
  `Access-Control-Allow-Credentials`**. With header-based auth the browser attaches nothing
  cross-origin, so the wildcard is not a CSRF or data-read vector. Deliberately not filed.
- **Admin attribution:** `execute-dispute-split` writes no `admin_audit_log` row, but does
  stamp `initiated_by_user_id: adminUserId` onto `payout_transfers` (`:1034`) and
  `payment_refunds` (`:794`). Attribution exists; not a finding.
- **Dead functions:** none.
