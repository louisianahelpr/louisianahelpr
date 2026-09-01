-- Push notifications become observable, and the last business-approval
-- residue is confirmed gone.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `log_push_notification` — the missing half of the notification log.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `notification_logs` has carried a `channel` column since 20260418215317, and
-- exactly two of its three values have ever been written: `in_app` (from the
-- DB triggers, via `log_notification`) and `email` (from
-- send-notification-email). Measured against prod today (fncmgoasalhdgfwzhsqa,
-- 2026-09-01):
--
--     channel='in_app'  137 rows
--     channel='email'    53 rows
--     channel='push'      0 rows        <-- never once, for the life of the app
--
-- Nothing in the repo writes a push row: send-push-notification `console.warn`s
-- an APNs/FCM rejection into the edge-function log and returns a JSON body that
-- nobody stores. So the admin Notification Logs screen would have read "no
-- pushes" just as convincingly the day push started working as it did for the
-- two years it did not — which is a large part of why the broken APNs token
-- hand-off (AppDelegate) hid for the entire life of the project. "Zero push
-- rows" was never evidence of anything, because zero was the only value the
-- column could take.
--
-- WHY A SEPARATE FUNCTION RATHER THAN REUSING `log_notification`.
-- Two reasons, and the second is the load-bearing one:
--
--   * `channel` is hardcoded to 'push' here, so a push outcome cannot be
--     mislabelled as in_app by a caller that forgets an argument. The existing
--     helper takes `_channel` as free text.
--   * `log_notification` RETURNS void. A void return cannot distinguish "the
--     row was written" from "the call was made" — the exact failure shape
--     CLAUDE.md names as the most common serious bug class in this codebase
--     ("a null `error` does NOT mean the write happened"). This one RETURNS
--     the inserted `id`, so the edge-function caller can assert a real row came
--     back instead of trusting a null error. That is the server-side twin of
--     `unwrapMutation()`'s `.select("id")`.
--
-- The `_status` vocabulary is the existing one (`sent` / `failed` /
-- `skipped` / `suppressed`) plus one new value, `token_deleted`, written once
-- per push token that APNs/FCM rejected as permanently dead (HTTP 410, or 400
-- `BadDeviceToken`) and that send-push-notification therefore DELETEd. A user
-- silently losing their registration is the single most valuable thing in this
-- log: it is invisible everywhere else, it explains "push stopped working for
-- me" completely, and until now the only trace it left was a line in an edge
-- function log that expires. `notification_logs.status` is plain `text` with no
-- CHECK constraint, so the new value needs no schema change; the admin UI maps
-- it explicitly (AdminNotificationLogs.tsx).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Business-approval residue — verified finished, guarded against replay.
-- ─────────────────────────────────────────────────────────────────────────────
-- See the block above section 2 below.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. log_push_notification
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_push_notification(
  _user_id uuid,
  _category text,
  _status text,
  _subject text DEFAULT NULL,
  _job_id uuid DEFAULT NULL,
  _error text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  -- Same denormalisation `log_notification` does: the log is read by an admin
  -- looking for "what did we send THIS person", and joining profiles at read
  -- time would miss a deleted account.
  SELECT email INTO v_email FROM public.profiles WHERE user_id = _user_id;

  INSERT INTO public.notification_logs (
    user_id, recipient_email, category, channel, status, subject, job_id, error_message
  ) VALUES (
    _user_id, v_email, _category, 'push', _status, _subject, _job_id, _error
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Server-only, exactly like `log_notification` (see
-- 20260505225000_security_revoke_log_notification_check_dispute_velocity.sql).
-- The only caller is send-push-notification, which holds service_role. A
-- client that could call this could forge delivery evidence.
REVOKE ALL ON FUNCTION public.log_push_notification(uuid, text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_push_notification(uuid, text, text, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.log_push_notification(uuid, text, text, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_push_notification(uuid, text, text, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.log_push_notification(uuid, text, text, text, uuid, text) IS
  'Write one notification_logs row with channel=''push'' and return its id. Service-role only; called by supabase/functions/send-push-notification. Returns the id so the caller can prove the row was written rather than trusting a null error.';

-- The read path is already covered: notification_logs has an admin SELECT
-- policy ("Admins view all notification logs", 20260418215317) and a
-- service_role SELECT policy (20260426223249). Nothing about channel='push'
-- needs a new policy — it is the same table.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Business-approval residue: confirm finished, keep the guard.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT WAS REPORTED: `notify_business_approvers` and
-- `review_business_verification` still write notification links to
-- '/business/team?tab=approvals' and '/business-team', routes that have never
-- existed in App.tsx, for a feature whose tables (`businesses`,
-- `business_members`) were dropped by 20260828011811.
--
-- WHAT IS ACTUALLY TRUE ON PROD TODAY (2026-09-01, fncmgoasalhdgfwzhsqa):
--
--   * `review_business_verification`  — GONE. Dropped by
--     20260828004538_remove_business_seats_dead_backend.sql. Absent from the
--     live PostgREST schema (`GET /rest/v1/` OpenAPI enumerates 135 RPCs; it is
--     not among them).
--   * `notify_business_approvers` + `trg_notify_business_approvers` — GONE.
--     Dropped by 20260828011811 and re-asserted by
--     20260831232522_retire_business_approval_residue.sql. Also absent from the
--     live schema.
--   * notifications with `link LIKE '/business%'` — 0 rows
--     (`?select=id&link=like./business*` with `count=exact` → `*/0`).
--   * No `business*` table is exposed at all.
--
-- So there is nothing left to drop and nothing to migrate. The header of
-- 20260831232514_notification_links_land_on_the_right_spot.sql, which says both
-- functions are "knowingly left alone", was already stale when it shipped
-- earlier the same day — recorded here rather than by rewriting a migration
-- that has already run.
--
-- What this section DOES add is the missing standing guard. That file's verify
-- block warns about '/warnings', '/admin/users/', '/admin/jobs/', '/activity'
-- and bare '/my-posts' | '/my-jobs' links — but not about '/business', the very
-- shape it had just decided to tolerate. A restore from a pre-2026-08-28
-- backup replays every migration in order and would land on a database where
-- these functions exist again; the drops below make that converge, and the
-- warning below makes a reintroduction visible in the db-deploy log.
--
-- All of it is a no-op on current prod. Every statement is IF EXISTS.

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_notify_business_approvers ON public.jobs';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.notify_business_approvers();
DROP FUNCTION IF EXISTS public.review_business_verification(uuid, text, text);

-- Sweep any '/business%' notification a replayed older definition may have
-- written before the drops above ran. 0 rows on prod today.
DO $$
DECLARE
  v_deleted integer;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE link LIKE '/business%';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      RAISE NOTICE 'push_notification_observability: deleted % dead /business notification(s)', v_deleted;
    END IF;
  END IF;
END
$$;

-- Standing guard. A WARNING, not a failure — same call the sibling verify block
-- made: naming the function in the deploy log is the useful outcome, blocking a
-- whole db-deploy on a link string is not.
DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosrc AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prosrc ~ 'INSERT INTO (public\.)?notifications'
  LOOP
    IF r.body ~ $dead$'/business$dead$ THEN
      RAISE WARNING 'public.% writes a notification link to /business… — that feature and its routes were removed (20260828011811)', r.proname;
    END IF;
  END LOOP;
END
$verify$;
