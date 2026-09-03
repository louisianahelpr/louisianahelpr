-- N-011: give the operator alerts a type of their own.
--
-- `warning`, `info` and `success` are SEVERITY labels, not categories.
-- 20260903012715 mapped them so they stopped bypassing the preference gate
-- (they were three of the four unmapped types, 43.9% of all notifications),
-- but mapping a severity does not make it a category: `warning` was pointed at
-- `system_alerts` and `info`/`success` at `work_status`, so a user muting
-- "system alerts" also muted "Job cancelled", and a user muting work status
-- also muted "Subscription expired" and "New job offer".
--
-- Measured in prod 2026-09-03, `notifications` grouped by title and joined to
-- `user_roles`:
--
--     Escalated dispute overdue    234 rows   14 recipients   0 non-admin
--     New member joined            206 rows   14 recipients   0 non-admin
--     Email delivery failed        189 rows   12 recipients   0 non-admin
--     Dispute escalated             12 rows   12 recipients   0 non-admin
--     New member joined (emoji)      3 rows                   0 non-admin
--
-- 644 of the 791 severity-typed rows (81.4%) are operator mail addressed to
-- admins. They are not "warnings" the way "your job was cancelled" is a
-- warning; they are a different AUDIENCE. This migration gives them
-- `admin_alert`, and the call sites that produce them are retyped in the same
-- commit.
--
-- WHY `system_alerts` IS THE PREF COLUMN: an operator alert IS a
-- platform-level alert, it is the column `warning` already resolved to, and
-- every admin is also a user with that switch. Gating changes for nobody; the
-- point is that the user-facing rows stop sharing the gate.
--
-- REPLAY-SAFE: the CHECK is dropped and re-added, the map row upserts, and the
-- backfill's predicate selects nothing on a second run.

-- ---------------------------------------------------------------------------
-- 1. Widen the enforced type set.
--
--    This is the closed set Postgres actually enforces — the 17 values from
--    20260510032410 plus `admin_alert`. Five other registries mirror it
--    (create-notification's ALLOWED_TYPES, send-notification-email's TYPE_MAP,
--    notificationPanelHelpers' typeIcons, notification_type_pref_map, and the
--    prefs UI's row list). `src/test/notificationTypeRegistries.test.ts` parses
--    THIS constraint out of the migrations and diffs the others against it, so
--    none of them can silently fall behind again.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- Original 7
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    -- Discovered in trigger / edge function code
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified',
    'message',
    -- New: operator-facing mail, addressed to admins rather than to the person
    -- the job belongs to. Kept OUT of the severity labels so that muting a
    -- user category can never mute an operator alert, or vice versa.
    'admin_alert'
  ));

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
'Allowed notification.type values. Keep in sync with INSERT INTO public.notifications calls in supabase/migrations/**/.sql and supabase/functions/**/index.ts. src/test/notificationTypeRegistries.test.ts parses this constraint and fails if any mirroring registry drifts from it.';

-- ---------------------------------------------------------------------------
-- 2. Map it, so the fan-out gate has a column to read.
--
--    An unmapped type IS the fail-open case: fan_out_push_on_notification
--    RAISEs a WARNING and pushes WITHOUT a category check. Adding a type to
--    the CHECK without adding it here is exactly the drift that produced
--    N-004, so the two happen in one migration and the test above enforces it.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('admin_alert', 'system_alerts', 'Operator-facing alert addressed to admins (dispute overdue, payout blocked, new signup).')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 3. Backfill the history — narrowly.
--
--    644 rows already sit in admins' notification centres under `warning` and
--    `info`. Leaving them means the same alert renders with two different
--    icons depending on when it arrived, and — the reason that matters beyond
--    cosmetics — any future measurement of "how much of `warning` is operator
--    mail?" answers with the old number and re-derives the wrong conclusion.
--
--    The predicate is deliberately narrow: the title must be one this commit's
--    code now emits as `admin_alert`, AND the recipient must actually hold the
--    admin role. Both conditions were checked against prod and select ONLY
--    admin rows (0 non-admin across all of these titles). No ordinary user's
--    notification history is rewritten.
--
--    SAFE TO REPLAY, AND SAFE FULL STOP: `notifications_fan_out_to_push` is
--    AFTER **INSERT** only (verified with pg_get_triggerdef against prod), so
--    this UPDATE cannot re-fan 644 pushes at 14 admins. Checking that is the
--    reason this is an UPDATE rather than a deliberate no-op.
--
--    `user_roles` is created long before this file, so the reference is safe in
--    a from-scratch replay; the guard is here anyway because an empty rebuild
--    has no rows to match and the statement must still be a clean no-op.
-- ---------------------------------------------------------------------------
UPDATE public.notifications n
   SET type = 'admin_alert'
 WHERE n.type IN ('warning', 'info')
   AND n.title IN (
     'Escalated dispute overdue',
     'Dispute escalated',
     E'\U0001F6A8 Dispute escalated',
     'New member joined',
     E'\U0001F464 New member joined',
     'Email delivery failed',
     E'⚠️ Email delivery failed',
     'Payout blocked — charge not captured',
     'Payout blocked — exceeds captured amount',
     'Scheduled payout failed'
   )
   AND EXISTS (
     SELECT 1 FROM public.user_roles r
      WHERE r.user_id = n.user_id
        AND r.role = 'admin'
   );
