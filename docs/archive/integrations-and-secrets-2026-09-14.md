> historical, superseded by docs/OPEN.md ([link](../OPEN.md)). Archived 2026-09-23 by Q165: its still-true findings not already queued are Q241, Q242, Q243; findings checked against the source at 9a0582ecf.

# Integrations and secrets inventory — 2026-09-14

Report only. Nothing was deleted, revoked or rotated, and no secret value was read or printed.
Evidence is a repo grep of each name across `src supabase/functions scripts .github api ios fastlane e2e`, compared with the live listing from each service.

**How each source was read**
- Supabase: `supabase secrets list` (names only) and `supabase functions list -o json` against linked ref `fncmgoasalhdgfwzhsqa`.
- GitHub: `gh secret list`, `gh variable list`, the `actions/variables` API, environments, hooks, deploy keys and workflow state.
- Slack: the Slack connector (channels, members, recent messages).
- Sentry: the Sentry connector (orgs, projects, every alert rule and its actions).
- Vercel: the Vercel connector (`list_teams`, `list_projects`, `get_project`).

**Not inspected (and why)**
- **Stripe:** the connector says "connection invalidated". The owner needs to reconnect it in claude.ai connector settings.
- **Supabase API keys (names/last-4):** the command was blocked by the permission classifier because it touches credentials.
- **Supabase auth providers and storage buckets (live):** these need the Management API token or the Supabase MCP, which asks for auth. The repo evidence is given below.
- **GitHub installed apps:** the `installation` endpoint needs a GitHub App JWT (401).
- **Sentry org integrations:** the connector has no tool for this.
- **Vercel env vars:** the connector has no tool for this, and the `vercel` CLI is not installed.

---

## Owner actions

Every REMOVE in the tables below, with the clicks to do it. Do them in this order.

### GitHub (github.com/louisianahelpr/louisianahelpr)
1. **Settings → Secrets and variables → Actions → Repository secrets.** Delete these two. Click the trash icon, then **Yes, remove this secret**.
   - `PLAYWRIGHT_TEST_HELPER_EMAIL`
   - `PLAYWRIGHT_TEST_HELPER_PASSWORD`
2. **Settings → Environments.** Delete these two. Open each one, then **Delete environment**, then confirm. They are leftovers from Vercel projects deleted in May, and their last deployments were 2026-05-19.
   - `Production – louisianahelpr-c4km`
   - `Production – louisianahelpr-zsau`
3. *Conditional:* delete `CRON_SECRET` only if you do NOT plan to re-enable **Actions → Edge Function Smoke Test** (it shows as `disabled_manually`). That workflow is the only thing that reads this GitHub copy. The Supabase copy of `CRON_SECRET` stays.

### Sentry (helpr-4m.sentry.io)
4. **Alerts → Alert Rules → project `javascript`.** Open each rule below, then **⋯ → Delete**, then confirm.
   - **"WARN — Stripe webhook signature mismatch"** (id 3390582). It can never fire: that message is only produced inside the `stripe-webhook` edge function, and no edge function has a Sentry SDK (`grep -ril sentry supabase/functions` returns 0). The same event already reaches Slack.
   - **"P1 — edge function 5xx burst"** (id 3413443). It can never fire: it filters on tag `source` ∈ {stripe-webhook, stripe-connect, release-payout, send-push-notification, process-email-queue}. Nothing sets those tags. The client's `source` tags are component names such as `GroupJobHelpers.load`, and grep finds 0 matches for those values in `src`.
   - **"P0 — chat push notification trigger failed"** (id 3413453). It is misnamed and duplicates the default rule. Its filter is ANY-of: message contains "failed" OR "error" OR "timeout" OR "non-2xx" OR "send-push-notification". That matches almost every new issue, so each new issue also emails you through the default `javascript` rule. Last triggered 2026-09-13.

### Supabase (supabase.com/dashboard/project/fncmgoasalhdgfwzhsqa)
5. **Edge Functions → Secrets.** Delete `APPLE_TEAM_ID`: tick it, then **Delete**. Its only reader is `helpr-pass-wallet`, which returns `not_configured` unless `PASS_CERT_PEM`, `PASS_KEY_PEM` and `PASS_WWDR_PEM` are all set. None of them are, and the function has no client call site.
6. **Launch day only, not now** (Stripe stays in sandbox until launch): after `scripts/e2e/stripe-sandbox-off.sh` switches `STRIPE_SECRET_KEY` to live, delete the 12 `STRIPE_PRICE_{BASIC,PRO,PLUS,ELITE}_{MONTHLY,ANNUAL,ONETIME}` secrets. `_shared/proTiers.ts` only honours them when the key starts with `sk_test_`, so with a live key they do nothing. Add this as a line on the launch checklist in `docs/OPEN.md`.

### Slack (louisianahelpr.slack.com)
7. **#new-channel** and **#social** have zero messages ever. In each channel, open the channel name, then **Settings → Archive channel**.
8. **Apps (sidebar) → Manage → Installed apps.** Look for any **Lovable** Slack connector app or an old **"Helpr Op"** app (bot `B0BS06KDYC8`, removed from #all-louisianahelpr on 2026-09-06) and remove it: **Remove app**. Nothing sends through the Lovable path: its `LOVABLE_API_KEY` is not set, and `SLACK_WEBHOOK_URL` takes priority anyway. The connector could not list installed apps, so this is a check-then-remove step.

### Third-party accounts with nothing wired to them (check, then remove)
9. **Checkr** and **Certificial.** `verification-webhook` reads `CHECKR_WEBHOOK_SECRET` and `CERTIFICIAL_WEBHOOK_SECRET`. Neither is set, and background checks are disabled (`src/components/profile/backgroundCheckDisabled.test.ts`). If either dashboard has an API key or a webhook pointing at `…/functions/v1/verification-webhook`: go to the dashboard, then **Developer / API keys**, and revoke the key and delete the webhook.
10. **Browserbase.** 0 references anywhere in the repo. If an account or API key exists: **Settings → API Keys → Revoke**.

---

## Alerts that go nowhere (or that nobody sees)

| Alert | Where it should go | What actually happens |
|---|---|---|
| `db-deploy`, `functions-deploy`, `deploy.yml` failure/success Slack posts | GitHub secret `SLACK_WEBHOOK` | **The secret is not set.** Each step is guarded by `env.SLACK_WEBHOOK != ''`, so it is skipped without a sound. A failed migration or function deploy sends nothing to Slack. (Note the name: the edge-function secret is `SLACK_WEBHOOK_URL` in Supabase, which is a different store.) |
| Admin push alerts (disputes, stuck dispute splits, new members, auto-cancel) | APNs push to the admin accounts | All 3 admin accounts (`7f65ef12…`, `76b07824…`, `68c11a39…`) have **no push token**, so each alert goes to Slack instead as "Admin alert undeliverable — no push token" (several times today in #ops-alerts). |
| Everything in **#ops-alerts** (private) | The owner | Members are `@admin` (admin@louisianahelpr.com) and the `helpr_ops` bot only. It is the only Slack destination, and it is noisy: at 10:53 PDT today the bot posted a "31 cron(s) are not running as scheduled" roll-up plus one message per dead cron. Unless the admin account has channel notifications on, this is the "never hear from" problem. |
| `marketing-token-health` (daily cron) | Slack | It posts ":rotating_light: Meta token health check could not run — META_PAGE_ACCESS_TOKEN is not set" (seen 2026-09-06). Auto-publish is off and none of the `META_*` secrets exist, so this is a critical-severity alert about a feature that was never configured. |
| 3 Sentry rules above (items 4a, 4b) | Email | They can never fire (see Owner actions). |
| GitHub repo variables `E2E_BASE_URL`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_PROJECT_REF` | Read by 16 places in e2e workflows | **0 repo variables exist.** The specs fall back to hard-coded prod values (e.g. `e2e/journeys/fixtures.ts:34`), so this is harmless today but not what the workflows claim. |

---

## Supabase — Edge Function secrets (41)

| name | where | used by | verdict |
|---|---|---|---|
| SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, SUPABASE_JWKS, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS | Supabase (platform-injected) | Nearly every function (URL/ANON/SERVICE_ROLE as the fallback after PUBLISHABLE_KEY/SECRET_KEY). The last four are not read by name. | KEEP (built-in, cannot be deleted) |
| PUBLISHABLE_KEY | Supabase | 30 functions, e.g. `admin-delete-user`, `check-pro-subscription` | KEEP |
| SECRET_KEY | Supabase | 60+ functions, `_shared/cron-auth.ts`, `_shared/rate-limit.ts` | KEEP |
| CRON_SECRET | Supabase | `_shared/cron-auth.ts`, cron-invoked functions, `slack-ops-alert` | KEEP |
| STRIPE_SECRET_KEY | Supabase | All Stripe functions (currently a sandbox key per standing order) | KEEP |
| STRIPE_WEBHOOK_SECRET | Supabase | `stripe-webhook` | KEEP |
| STRIPE_IDV_WEBHOOK_SECRET | Supabase | `stripe-idv-webhook`, `verification-webhook` | KEEP |
| STRIPE_PRICE_{BASIC,PRO,PLUS,ELITE}_{MONTHLY,ANNUAL,ONETIME} (12) | Supabase | `_shared/proTiers.ts` `ENV_KEY`, honoured only while the key is `sk_test_` | KEEP now → REMOVE on launch day (Owner action 6) |
| RELEASE_PAYOUT_AUTO | Supabase | `auto-release-payment`, `auto-resolve-disputes` (feature flag) | KEEP |
| RESEND_API_KEY | Supabase | `_shared/resend.ts`, `contact-support`, `notify-email-change`, `health-check`, admin email functions | KEEP |
| RESEND_WEBHOOK_SECRET | Supabase | `resend-webhook` | KEEP |
| SEND_EMAIL_HOOK_SECRET | Supabase | `auth-email-hook` (Supabase Auth send-email hook) | KEEP |
| SLACK_WEBHOOK_URL | Supabase | `_shared/slack-alerts.ts` → incoming webhook "Helpr Ops" (`B0C0U9VCM40`), bound to **#ops-alerts** since 2026-09-06 (earlier it was #all-louisianahelpr). Used by `stripe-webhook` handlers, `send-push-notification`, `instant-payout`, `subscription-reconciliation`, `verification-webhook`. | KEEP |
| SLACK_API_KEY | Supabase | `slack-ops-alert` function (bot `helpr_ops`, `chat.postMessage`), called by cron-watcher SQL and dispute triggers. Every `[cron-dead]`/`[cron-http]` post in #ops-alerts comes from this. | KEEP |
| SLACK_OPS_CHANNEL | Supabase | `slack-ops-alert` default channel (#ops-alerts) | KEEP |
| APNS_AUTH_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID | Supabase | `send-push-notification` | KEEP |
| APPLE_MAPKIT_KEY_ID, APPLE_MAPKIT_PRIVATE_KEY, APPLE_MAPKIT_TEAM_ID | Supabase | `mapkit-token` → `src/hooks/useMapKitJs.ts` | KEEP |
| GEMINI_API_KEY | Supabase | `ai-job-builder` ← `AiJobBuilder.tsx` ← `src/pages/postjob/EntryChoice.tsx` | KEEP |
| APPLE_TEAM_ID | Supabase | `helpr-pass-wallet` only (unconfigured scaffold, no client caller) | **REMOVE** |

**Read by code but not set** (FYI, not removals): `LOVABLE_API_KEY` (dead Slack transport 2), `META_APP_ID/APP_SECRET/IG_USER_ID/PAGE_ACCESS_TOKEN/PAGE_ID` (auto-poster not configured), `PASS_CERT_PEM/KEY_PEM/WWDR_PEM/TYPE_IDENTIFIER` (wallet), `CHECKR_WEBHOOK_SECRET`, `CERTIFICIAL_WEBHOOK_SECRET`, `FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT` (Android push; there is no `android/` dir), and optional settings `APNS_USE_SANDBOX`, `APP_URL`, `EMAIL_UNSUBSCRIBE_SECRET`, `HELPR_POSTAL_ADDRESS`, `MARKETING_CLAIM_LIMIT`, `SUPPORT_INBOX_EMAIL`. Report-only dead code: the Lovable gateway branch in `supabase/functions/_shared/slack-alerts.ts`.

## Supabase — edge functions, keys, auth, storage

| name | where | used by | verdict |
|---|---|---|---|
| 71 edge functions | Deployed (all ACTIVE) | 71 dirs in `supabase/functions`: an exact match, none deployed-only, none undeployed. `node scripts/check-dead-edge-functions.mjs`: "71 checked; 0 known-unreferenced, 0 new". | KEEP |
| `helpr-pass-wallet` | Deployed | Only its own test references it. It is unconfigured (no PASS_* certs). | KEEP for now (report; the owner decides whether the Wallet feature is dead) |
| `apple-app-store-notifications` | Deployed | Only `supabase/config.toml`; it is the endpoint Apple calls (IAP products exist, `asc-iap.yml` last ran 2026-09-07) | KEEP |
| API keys (publishable/secret) | Dashboard → Project Settings → API Keys | Not inspected (classifier blocked). Code uses one `PUBLISHABLE_KEY` and one `SECRET_KEY`. | Owner check: delete any extra secret key other than the one whose last-4 matches the `SECRET_KEY` secret |
| Auth providers | Dashboard → Authentication → Sign In / Providers | Client uses email, **Apple** and **Google** (`src/lib/socialLogin.ts`, `socialAuth.ts`). `config.toml` declares no `[auth.external.*]`. | Owner check: disable any provider other than Email/Apple/Google |
| Storage buckets (repo evidence) | Migrations + `storage.from()` | `job-photos` (6), `proof-photos` (7), `application-attachments` (1), `id-documents` (1), `avatars` (2), `user-documents` (1) | KEEP all six. Owner check: any live bucket not on this list is unused. |

## GitHub — Actions secrets (35), variables, environments, hooks, keys

| name | where | used by | verdict |
|---|---|---|---|
| SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF | Repo secrets | `db-deploy`, `functions-deploy`, `db-drift-detect`, `db-backup`, `prod-errors`, `press-every-control`, … | KEEP |
| BACKUP_PASSPHRASE | Repo secret | `db-backup.yml` (last run success 2026-09-14) | KEEP |
| VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_APPLE_MAPKIT_TOKEN | Repo secrets | `deploy`, `ios-beta`, `sentry-release`, `a11y-axe`, `bundle-size`, `test`, … | KEEP |
| VITE_SUPABASE_PROJECT_ID | Repo secret | `sentry-release.yml` | KEEP |
| SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT | Repo secrets | `sentry-release.yml` (success 2026-09-14), `ios-beta.yml` sourcemap upload | KEEP |
| STRIPE_TEST_SECRET_KEY | Repo secret (added today) | `stripe-webhook-guard.yml` → `scripts/check-stripe-webhook-events.mjs` (green 18:04 UTC today) | KEEP |
| ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_BASE64 | Repo secrets | `ios-beta`, `ios-metadata`, `asc-iap`, `deploy`; `scripts/asc/asc-client.mjs` | KEEP |
| ASC_TEAM_ID, DEVELOPER_TEAM_ID, FASTLANE_APPLE_ID | Repo secrets | `deploy`, `ios-metadata`, `ios-beta`, `fastlane/Appfile` | KEEP |
| IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64, IOS_DISTRIBUTION_CERTIFICATE_PASSWORD | Repo secrets | `ios-beta`, `deploy`, `fastlane/Fastfile` | KEEP |
| FASTLANE_PASSWORD, KEYCHAIN_PASSWORD | Repo secrets | `deploy.yml` only (the App Store `release` lane; last run 2026-04-26, file edited 2026-09-06) | KEEP (dormant; delete only if `deploy.yml` is retired in favour of `ios-beta.yml`) |
| PLAYWRIGHT_{POSTER,HELPER,ADMIN,INCOMPLETE}_{EMAIL,PASSWORD} | Repo secrets | `e2e-journeys`, `e2e-real-backend`, `press-every-control`, `prod-audit`, `a11y-webkit-prod`, `e2e-abuse-notifications` | KEEP |
| PLAYWRIGHT_TEST_USER_EMAIL/PASSWORD | Repo secrets | `e2e-real-backend.yml` → `e2e/auth.spec.ts`, `e2e/payment-lifecycle.spec.ts` | KEEP |
| PLAYWRIGHT_TEST_HELPER_EMAIL/PASSWORD | Repo secrets | **0 references** in workflows or code | **REMOVE** |
| CRON_SECRET | Repo secret | `edge-function-smoke.yml` only, which is `disabled_manually` | **REMOVE unless the smoke test is re-enabled** |
| *Referenced but not set:* SLACK_WEBHOOK | n/a | `db-deploy`, `functions-deploy`, `deploy` notify steps (silently skipped) | Gap (see alerts table) |
| *Referenced but not set:* ASC_KEY_CONTENT | n/a | Falls back to `ASC_KEY_BASE64` | Fine |
| *Referenced but not set:* PLAYWRIGHT_HELPER_SESSION, PLAYWRIGHT_POSTER_SESSION, PLAYWRIGHT_LIFECYCLE_JOB_ID | n/a | Optional inputs to `e2e-real-backend` | Fine |
| Repo variables | n/a | 0 exist; `vars.E2E_*` referenced 42 times, with fallbacks | Gap (harmless) |
| Environments `Preview`, `Production` | Created by the Vercel integration | Vercel deployments (latest 2026-09-14 / 2026-09-13) | KEEP |
| Environments `Production – louisianahelpr-c4km`, `Production – louisianahelpr-zsau` | Created 2026-05-19 | Deleted Vercel projects; no deployment since 2026-05-19; no env secrets | **REMOVE** |
| Repo webhooks | n/a | none | n/a |
| Deploy keys | n/a | none | n/a |

## Slack (workspace louisianahelpr)

| name | where | used by | verdict |
|---|---|---|---|
| #ops-alerts (private) | Channel, created 2026-09-06 | Destination for `SLACK_WEBHOOK_URL` and `SLACK_API_KEY`/`SLACK_OPS_CHANNEL`. Members: @admin, @helpr_ops. | KEEP (turn on notifications) |
| Incoming webhook "Helpr Ops" `B0C0U9VCM40` | #ops-alerts | `SLACK_WEBHOOK_URL` | KEEP |
| Bot app "Helpr Ops" (`helpr_ops`, `B0BUYH91D0F`) | Workspace | `SLACK_API_KEY` → `slack-ops-alert` | KEEP |
| Old webhook "Helpr Op" `B0BS06KDYC8` | Removed from #all-louisianahelpr 2026-09-06 | nothing | **REMOVE** if still under Installed apps (Owner action 8) |
| Lovable Slack connector (if installed) | Workspace | nothing (`LOVABLE_API_KEY` not set) | **REMOVE** if present |
| #all-louisianahelpr | Default channel | Alerts stopped 2026-09-06 when the webhook moved | KEEP (Slack default channel, cannot be archived) |
| #social | Channel, 2026-04-23 | 0 messages | **REMOVE** (archive) |
| #new-channel | Channel, 2026-04-23 | 0 messages | **REMOVE** (archive) |

## Sentry (org `helpr-4m`)

| name | where | used by | verdict |
|---|---|---|---|
| Project `javascript` | Only project | `src/lib/sentry.ts` DSN (hard-coded fallback; `VITE_SENTRY_DSN` is set nowhere) plus sourcemap upload via the `SENTRY_*` GH secrets | KEEP |
| Rule "javascript" (3324923) | Email → ActiveMembers | Every new issue; last fired 2026-09-13 | KEEP |
| "P0 — chat push notification trigger failed" (3413453) | Email → AllMembers | ANY-of "error"/"failed"/… matches almost every new issue; duplicates 3324923 | **REMOVE** |
| "P1 — edge function 5xx burst" (3413443) | Email | Tags nothing sets; edge functions have no Sentry SDK | **REMOVE** |
| "WARN — Stripe webhook signature mismatch" (3390582) | Email | Server-only message; already covered by Slack | **REMOVE** |
| "P1 — Stripe Connect onboarding errors" (3413444) | Email | Can fire from client invoke errors containing `stripe-connect` | KEEP |
| "WARN — rate limit triggered" (3413445) | Email | Can fire if the client reports `ai-job-builder`'s 429 text | KEEP |
| "P0 — payout sent but ledger missing" (3390525), "P0 — invalid job state transition" (3390482), "P0 — notifications.type CHECK violation" (3390451), "P0 schema drift — column missing" (3390432) | Email → ActiveMembers | Can fire only when the client reports the server's error text (never triggered) | KEEP (low value) |
| Metric alerts | n/a | none | n/a |
| Org integrations (Slack/GitHub/Vercel) | Sentry → Settings → Integrations | Not inspectable via connector | Owner check: nothing in the repo depends on a Sentry→Slack integration; remove one if installed with no alert rule using it |

## Vercel (team "Helpr", hobby)

| name | where | used by | verdict |
|---|---|---|---|
| Project `louisianahelpr` (`prj_pDcX…`) | Only project, linked to GitHub `louisianahelpr/louisianahelpr` | Web app, `api/share.ts` | KEEP |
| Domains `louisianahelpr-louisianahelprs-projects.vercel.app`, `…-git-main-…vercel.app` | Project | Vercel defaults (the connector did not return custom domains) | KEEP |
| Extra projects | n/a | none (the two deleted ones left only the GitHub environments above) | n/a |
| Env vars | Project settings | Not listable via connector; the build needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_APPLE_MAPKIT_TOKEN` (`.env.example`) | Owner check: any Vercel env var not in that list (e.g. `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` are optional) is unused |

Aside: `get_project` reports `live: false` and the latest production deployment `CANCELED` (2026-09-14). That is probably the deploy-budget guard, but it is worth a glance.

## Stripe (TEST mode)

| name | where | used by | verdict |
|---|---|---|---|
| Webhook endpoint → `stripe-webhook` | Stripe test dashboard | `STRIPE_WEBHOOK_SECRET`; `stripe-webhook-guard.yml` (duplicate-endpoint check, #1586) green at 18:04 UTC today | KEEP |
| Identity webhook → `stripe-idv-webhook` | Stripe | `STRIPE_IDV_WEBHOOK_SECRET` | KEEP |
| Connect settings | Stripe | `stripe-connect`, `release-payout`, `instant-payout` | Not inspected: Stripe connector invalidated |

## Other services

| name | where | used by | verdict |
|---|---|---|---|
| Resend | Supabase secrets `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`; auth send-email hook | 45 files; `_shared/resend.ts`, `process-email-queue`, `resend-webhook` | KEEP |
| PostHog | Key hard-coded in `src/lib/posthog.ts` (publishable `phc_`; `VITE_POSTHOG_KEY` set nowhere) | Client analytics | KEEP |
| Apple MapKit JS | `APPLE_MAPKIT_*` (Supabase), `VITE_APPLE_MAPKIT_TOKEN` (GH) | `mapkit-token`, `useMapKitJs.ts`, `CurrentLocationPill.tsx` | KEEP |
| Apple Push (APNs) | `APNS_*` (Supabase) | `send-push-notification` | KEEP |
| App Store Connect / fastlane | `ASC_*`, `FASTLANE_*`, `IOS_DISTRIBUTION_*` (GH); `fastlane/.env` (local) | `ios-beta`, `ios-metadata`, `asc-iap`, `deploy` | KEEP |
| Apple Wallet pass | `APPLE_TEAM_ID` only; PASS_* unset | `helpr-pass-wallet` (no caller) | **REMOVE** the secret (feature is report-only) |
| Sign in with Apple / Google | Supabase Auth providers + iOS entitlements | `src/lib/socialLogin.ts`, `socialAuth.ts`, `nativeInit.ts` | KEEP |
| Google Gemini | `GEMINI_API_KEY` | `ai-job-builder` | KEEP |
| Meta (Facebook/Instagram auto-poster) | No secrets set | `marketing-publish`, `marketing-token-health` (cron raises a critical "could not run" alert) | Not configured. No secret to remove; the alert is noise until configured. |
| Checkr / Certificial | No secrets set | `verification-webhook` (background checks disabled) | **REMOVE** any account API key/webhook if one exists |
| Firebase Cloud Messaging | No secrets set, no `android/` | `send-push-notification` FCM branch | Nothing to remove |
| Lovable connector gateway | `LOVABLE_API_KEY` unset | Dead branch in `_shared/slack-alerts.ts` | **REMOVE** any Lovable Slack connection; the code is report-only |
| Browserbase | none | 0 references | **REMOVE** any account key if one exists |
