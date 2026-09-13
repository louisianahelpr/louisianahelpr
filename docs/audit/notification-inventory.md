# Notification inventory (terminal 7, 2026-09-12)

Every notification the app can produce, its trigger, recipient, channel(s),
template/copy source, deep link, and the preference that gates it. Derived from
the LIVE prod database (`information_schema.triggers`, `pg_get_functiondef`) and
the edge functions in `supabase/functions/`, not from memory. The paired
suite that exercises the test-account-reachable rows is
`e2e/journeys/notifications/notifications.spec.ts`.

## Channels and how they fan out

1. **In-app row** — `public.notifications` (RLS: a user reads only their own).
   Created either by a DB trigger (see table) or by the `create-notification`
   edge function (auth required; `type` allowlisted; `link` sanitised to a
   same-origin path).
2. **Push** — `notifications_fan_out_to_push` (AFTER INSERT on `notifications`)
   → `send-push-notification`. Gated by the push twin of the type→pref map.
3. **Email** — Resend, via `send-notification-email` / `process-email-queue`.
   Gated by the `email_*` column in `send-notification-email`'s `TYPE_MAP`.
   Every send logged to `email_send_log` (RLS: admin/service-role read only).

Push and email must gate on the same preference; the divergence history and the
type→column map live in `send-notification-email/index.ts`, guarded by
`src/test/notificationTypeRegistries.test.ts`.

## Notification-producing triggers (live, `information_schema.triggers`)

| Table | Trigger | Event | Function | Notification / recipient |
|---|---|---|---|---|
| applications | `on_application_change` | AFTER INSERT/UPDATE | `notify_on_application()` | Poster: new application on their job (`application`/`new_offers`). Link: the job. |
| applications | `on_application_viewed` | AFTER UPDATE | `notify_helper_application_viewed()` | Helper: poster viewed your application. |
| jobs | `on_job_status_change` | AFTER UPDATE | `notify_on_job_update()` | Party to the job: status changed (`job_update`/`work_status`). |
| jobs | `trg_notify_helper_on_direct_offer` | AFTER INSERT/UPDATE | `notify_helper_on_direct_offer()` | Targeted helper: you got a direct offer (`new_offers`). |
| jobs | `trg_notify_helpers_funded_insert/update` | AFTER INSERT/UPDATE | `notify_helpers_on_job_post()` | Nearby helpers: a new funded job matches you (`job_match`). |
| jobs | `trg_notify_payment_escrowed` | AFTER UPDATE | `notify_on_payment_escrowed()` | Poster/helper: payment is in escrow (`payment`/`financial_alerts`). |
| jobs | `trg_notify_poster_status` | AFTER UPDATE | `notify_poster_on_status_change()` | Poster: helper advanced the job. |
| jobs | `trg_notify_saved_searches_funded_insert/update` | AFTER INSERT/UPDATE | `notify_saved_searches_on_new_job()` | Saved-search owners: a job matched a saved search (`job_match`). |
| messages | `notify_message_recipient_tg` | AFTER INSERT | (message notify) | Recipient: new message (`message`/`email_messages`). Link: the thread. |
| reviews | `trg_notify_user_on_review` | AFTER INSERT | (review notify) | Reviewee: you received a review — but see the blind-period reveal (`review`/`email_reviews`). |
| tips | `trg_notify_helper_tip` | AFTER INSERT/UPDATE | `notify_helper_tip()` | Helper: you received a tip (`payment`/`financial_alerts`). |

Notification-side hygiene triggers (not senders): `suppress_exact_duplicate_notification`
(BEFORE INSERT, de-dupes), `trg_notifications_fill_job_id` (BEFORE INSERT).

## Scheduled / cron-produced notifications (edge functions)

| Function | Cadence | Recipient / notification |
|---|---|---|
| `expiring-jobs-push` | cron | Poster: your job expires soon (`expired`→`email_job_updates`). |
| `saved-helper-availability-push` | cron | Poster: a saved helper is now available. |
| `send-marketing-blast` | manual/admin | Marketing recipients (own opt-in column; NOT a `notifications.type`). |
| `daily_job_digest_cron` | daily | Digest email of matching jobs. |
| `review-nag-cron` | cron | Party with an unwritten review after a completed job. |

## Type → email preference column (from `send-notification-email` TYPE_MAP)

`new_offers`→`email_new_offers`, `transit_updates`→`email_transit_updates`,
`work_status`→`email_work_status`, `financial_alerts`→`email_financial_alerts`,
`application`→`email_job_applications`, `job_update`/`job_updates`/`expired`→`email_job_updates`,
`job_match`→`email_job_matches`, `info`/`success`→`email_work_status`,
`warning`/`system_alert`/`verified`/`admin_alert`→`email_system_alerts`,
`message`→`email_messages`, `payment`→`email_payments`, `review`→`email_reviews`.

## Which triggers the two test accounts can cause (covered by the spec)

- **New message** (`messages` INSERT) → recipient in-app row + `email_send_log`
  (category `messages`), link opens the thread. Preference: `email_messages`.
  ✅ reachable, both accounts, needs a funded job they both belong to.
- **New application** (`applications` INSERT to the poster's funded job) → poster
  in-app row, link opens the job. ✅ reachable.
- **Job status change** (`jobs` UPDATE via the lifecycle RPCs) → party in-app row.
  ✅ reachable within the funded lifecycle.
- **Payment escrowed** (`trg_notify_payment_escrowed`) → poster/helper.
  ✅ reachable when the lifecycle funds a job (Stripe test key only).
- **Review received** (`reviews` INSERT after a completed job) → reviewee, subject
  to the blind-period reveal. ✅ reachable at the end of the lifecycle.

## Not reachable with the two shared accounts (annotated `uncovered` in the spec)

- **Direct offer**, **saved-search match**, **job-match fan-out to nearby helpers**:
  need a third geographically-matched account or a saved search; creating them
  perturbs the shared accounts. Reported `uncovered` with the reason.
- **Tip received**: needs a completed job plus a real (test-mode) tip charge.
- **Cron notifications** (`expiring-jobs-push`, digest, review-nag): fire on the
  schedule; the spec asserts the trigger path, not the cron wakeup.
