-- The Email master switch gets its own column, the way the Push master
-- already has one.
--
-- THE BUG. `notification_preferences` has `push_enabled` but no email twin, so
-- the Email master on Profile → Notifications was *derived*: "on" meant "at
-- least one email_* column is true", and toggling it blanket-wrote the same
-- value to all eleven email_* columns. Turning it off therefore destroyed the
-- user's per-category choices, and turning it back on wrote `true` everywhere
-- rather than restoring them.
--
-- Measured on a QA account 2026-09-06: starting from
-- `email_messages=false, email_transit_updates=false, email_promotions=false`
-- (three explicit opt-outs), a master off → on cycle left all eleven columns
-- `true`. Someone who unticks Promotions, mutes email for a weekend, then
-- unmutes, is silently re-subscribed to marketing email. That is the one
-- category where accidentally re-consenting a person carries legal weight
-- (CAN-SPAM / GDPR), and nothing tells them it happened.
--
-- Push never had this problem because its master is a SEPARATE COLUMN checked
-- separately: `fan_out_push_on_notification` returns early on
-- `push_enabled IS NOT TRUE` *before* it looks up the per-type column, so the
-- eleven push category columns are never written by the master and are still
-- there when it comes back on. This migration gives email the same shape
-- rather than inventing a second mechanism.
--
-- Server-side on purpose: the restore has to survive a fresh device, a cleared
-- browser and a reinstall, and it is a consent record. Remembering the prior
-- mix in localStorage would lose it exactly when a user is most likely to
-- notice ("I reinstalled and now I'm getting marketing mail again").

-- ADD COLUMN and its backfill are one unit, gated on the column being absent,
-- so a replay is a complete no-op. A bare `ADD COLUMN IF NOT EXISTS` plus an
-- unconditional UPDATE would re-run the backfill on every replay and stamp
-- `email_enabled = false` onto an account that had since turned the master on
-- while leaving every category off — a state the user is entitled to hold.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'email_enabled'
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD COLUMN email_enabled boolean NOT NULL DEFAULT true;

    -- Backfill: preserve exactly what each existing account currently SEES,
    -- since the old master was derived as "at least one email_* column is
    -- true". An account whose email columns are all false is reading OFF today
    -- and must keep reading OFF; every other account is reading ON.
    --
    -- Deliberately does NOT touch the email_* columns themselves. An all-false
    -- row is ambiguous — it could be the destructive master, or eleven
    -- deliberate opt-outs — and "restore them to the defaults" would guess in
    -- the direction of re-subscribing someone to Promotions, which is the harm
    -- this migration exists to remove. Such a row keeps its stored values; the
    -- user turns back on whichever categories they want, the same as an
    -- account with `push_enabled` on and every push category off. (Measured
    -- 2026-09-06: 0 of 46 prod rows are in that state, so this is empty in
    -- practice — it exists for staging, for replays and for the future.)
    UPDATE public.notification_preferences
    SET email_enabled = false
    WHERE NOT (
      email_job_applications OR email_job_updates OR email_messages
      OR email_payments OR email_reviews OR email_promotions
      OR email_system_alerts OR email_new_offers OR email_transit_updates
      OR email_work_status OR email_financial_alerts
    );
  END IF;
END $$;

COMMENT ON COLUMN public.notification_preferences.email_enabled IS
  'Email master switch. Twin of push_enabled: gates every email_* category '
  'without overwriting any of them, so turning it off and on again restores '
  'the user''s per-category choices instead of resetting them to true. '
  'Enforced in send-notification-email alongside the per-type email_* column.';

-- No GRANT changes: `email_enabled` is a column on an existing table, and the
-- table's own grants and RLS policies (owner-row select/insert/update) already
-- cover it. Adding a column does not create a new privilege surface.
