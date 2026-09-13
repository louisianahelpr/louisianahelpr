# Notification inventory

Derived from `supabase/functions/`, `supabase/migrations/`, and `src/` — not
from memory. Every row below cites the file it came from. Regenerate by
re-running the greps in the "how this was built" section at the bottom
whenever a migration adds a type, since this is a snapshot, not a live query
(no DB credentials were available when this was written — see
`docs/OPEN.md` "Audit gaps").

## Channels

| Channel | Written by | Log table |
|---|---|---|
| In-app (`notifications` row) | DB triggers, mostly via `log_notification()` (RETURNS void — a null error only proves the call was made, not that the row exists) | `notification_logs` (`channel='in_app'`) |
| Email | `supabase/functions/send-notification-email/index.ts`, called from triggers/edge functions via `create-notification` or directly | `notification_logs` (`channel='email'`), denormalized `email_send_log` for Resend-level status |
| Push | `supabase/functions/send-push-notification/index.ts`, fanned out by the `fan_out_push_on_notification()` trigger (`20260903012715_notification_preferences_always_exist.sql`) | `notification_logs` (`channel='push'`) as of `20260901004926` (`log_push_notification` RPC, see `supabase/functions/_shared/notificationLog.ts`) |

## The type → preference → category registry

The single source of truth is `public.notification_type_pref_map`
(`type`, `pref_column`, `description`), first created in
`20260506140000_notification_type_pref_map_lookup.sql` and amended by later
migrations. `pref_column` is the **base** column name; email reads
`email_<pref_column>` and push reads `push_<pref_column>` (via
`fan_out_push_on_notification`), plus one master switch `push_enabled`.
`send-notification-email/index.ts`'s local `TYPE_MAP` is meant to mirror this
table exactly — `src/test/notificationTypeRegistries.test.ts` diffs them and
fails on drift.

| `notifications.type` | pref column (base) | category (admin log) | Trigger / producer | Recipient | Link target |
|---|---|---|---|---|---|
| `new_offers` | `new_offers` | `new_offers` | parish/saved-search fan-out on job becoming visible (`20260902015059_notify_helpers_fires_when_the_job_becomes_visible.sql`, `20260840718_helper_parish_fanout_falls_back_to_profile_parish.sql`) | Helper | `/browse?job=<id>` |
| `job_match` | `job_matches` (own column since `20260911201653_job_match_notification_preference.sql`; was `job_updates` before that) | `job_matches` | saved-search / instant match fan-out | Helper | `?job=<id>` |
| `application` | `job_applications` | `job_applications` | application created (deduped, `20260831203052_dedupe_application_notifications_and_fix_offer_links.sql`) | Poster | `/my-posts?job=<id>` (offer link) |
| `job_update` / `job_updates` | `job_updates` | `job_updates` | status changes (accept/decline/on-the-way/complete), decline notifies poster (`20260905023513_decline_notifies_the_poster.sql`) | Poster or Helper | `?job=<id>` |
| `expired` | `job_updates` | `job_updates` | `auto-expire-jobs` edge function / `expiring-jobs-push` | Poster | `?job=<id>` |
| `transit_updates` | `transit_updates` | `transit_updates` | on-the-way / tracker updates | Poster | `?job=<id>` |
| `work_status` | `work_status` | `work_status` | job lifecycle transitions not covered above | Poster/Helper | `?job=<id>` |
| `financial_alerts` | `financial_alerts` | `financial_alerts` | escrow funded/released, payout events | Poster/Helper | `/activity` or `?job=<id>` |
| `payment` | `payments` | `payments` | payment confirm/reminder edge functions | Poster/Helper | `?job=<id>` |
| `message` | `messages` | `messages` | new message (`20260510032410_message_notifications.sql`, sender name added `20260831170945_message_notification_includes_sender.sql`) | Either party | `/messages?job=<id>` |
| `review` | `reviews` | `reviews` | review posted, gated by reveal rules (`20260830234327_notify_user_on_review.sql`, `20260831162131_review_notification_respects_reveal.sql`); review nag lands where a review can be written (`20260902035709`) | Reviewed party | `?job=<id>` |
| `info` | `work_status` | `work_status` | legacy severity label — spans transit/new-offers/admin mail per the migration's own admission (`20260903012715`) | Either | varies |
| `success` | `work_status` | `work_status` | legacy severity label | Either | varies |
| `warning` | `system_alerts` | `system` | legacy severity label / system alerts | Either | varies |
| `system_alert` | `system_alerts` | `system` | system-level alerts | Either | varies |
| `verified` | `system_alerts` | `system` | credential/identity verified | Helper | `/profile` |
| `admin_alert` | `system_alerts` | `system` | operator-facing (dispute overdue, payout blocked, new signup) — retyped from `warning` in `20260903025724_admin_alert_notification_type.sql`; 81% of pre-fix `warning` volume was actually this | Admin | admin console |
| `promotion` | `promotions` | `promotions` | marketing blast (`send-marketing-blast`) — NOT a `notifications.type` CHECK value; email-only, called directly | Any subscribed user | marketing link |

Dispute/escalation-specific in-app rows (no dedicated type column change,
ride on `admin_alert`/`work_status`): dispute filed, escalated to admin
(`20260907034826_escalate_dispute_notifies_admins_server_side.sql`), fraud
flag raised on dispute velocity (`20260907045410`), reversed violation
(`20260905025756`), undelivered-revision auto-dispute
(`20260912023326_system_open_dispute_on_undelivered_revision.sql`).

## Master gates

- `notification_preferences.push_enabled` — global push kill switch, checked
  unconditionally in `fan_out_push_on_notification` regardless of category
  (`20260903012715`).
- Per-category `email_<col>` / `push_<col>` booleans, all default `true` —
  `20260903012715` also **self-heals** a missing `notification_preferences`
  row (materializes it with defaults) so a fresh account is never treated as
  "no preferences = no gate" (the old bug: 85% of accounts had no row and
  every gate was skipped).
- `notification_type_pref_map` miss → push still sends (fails open,
  deliberately, with a `RAISE WARNING`) because most unmapped types are
  operator alerts, per the migration's own comment.

## Edge functions in the send path

| Function | Role |
|---|---|
| `create-notification` | Writes the `notifications` row (in-app) and can be asked to also send a test email |
| `send-notification-email` | Renders `NotificationEmail` via react-email, checks `email_<col>` pref, calls Resend, logs to `notification_logs` |
| `send-push-notification` | Reads `push_tokens`, sends via APNs/FCM, deletes dead tokens (`token_deleted` log status), logs via `_shared/notificationLog.ts` |
| `send-account-status-email` | Approval/denial/ban/suspension emails — separate template family, not gated by the category map (account-status mail is not optional) |
| `send-marketing-blast` | `promotion` category, gated by `email_promotions` + global unsubscribe |
| `process-email-queue` | Drains a queue table for retried/delayed sends |
| `email-unsubscribe` | One-click unsubscribe handler — flips the relevant `email_*` column off |
| `email-tracking` | Resend webhook (opens/bounces) — writes delivery status back to `email_send_log` |
| `daily-match-digest`, `engagement-automations`, `expiring-jobs-push`, `payment-confirm-reminder` | Scheduled producers that call the two send functions above rather than writing `notifications` directly in all cases |
| `auth-email-hook` | Supabase Auth's own transactional mail (magic link, password reset) — outside the preference system entirely |
| `admin-test-push` | Lets an admin fire a test push at themselves — good harness for push payload-shape checks |

## Email templates (react-email, `supabase/functions/_shared/email-templates/`)

Not fully enumerated here — see that directory for the full template list.
`NotificationEmail` is the generic one used by `send-notification-email` for
every category above. Template rendering + logo asset checks are covered in
§3 of the task (screenshot pass), tracked separately in `docs/OPEN.md`.

## How this was built

```
grep -rn "log_notification(" supabase/migrations
grep -rln "INSERT INTO public.notifications" supabase/migrations
grep -rhoE "\('[a-z_]+',\s*'[a-z_]+'," supabase/migrations/*notification_type_pref_map*.sql \
  supabase/migrations/2026050614*.sql supabase/migrations/2026051003*.sql \
  supabase/migrations/2026061254*.sql supabase/migrations/2026090301*.sql \
  supabase/migrations/2026091120*.sql supabase/migrations/2026050418*.sql
sed -n '1,80p' supabase/functions/send-notification-email/index.ts   # TYPE_MAP
cat supabase/functions/_shared/notificationLog.ts                     # push logging
```

No live database was queried to build this table (no `.env` /
`SUPABASE_SERVICE_ROLE_KEY` in this worktree — see `docs/OPEN.md`). Everything
above is sourced from migration files and function source, which is
authoritative for *intended* behavior but was not cross-checked against
`notification_type_pref_map`'s actual live rows or `notification_logs` volume.
