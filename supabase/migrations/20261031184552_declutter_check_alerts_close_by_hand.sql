-- The check after posting's two admin alerts close by hand (#3892 CI red, adminQueueAlertsClose, 2026-10-31).
--
-- WHAT WAS WRONG: 20261031152545 (declutter_check_after_post) sends every admin "A sold Declutter listing failed its
-- check" (declutter_record_ai_check) and "A sold Declutter listing was never checked"
-- (declutter_hold_unchecked_listings). Neither title had a close rule or a manual row, so an admin with no push
-- token whose copy is mirrored to #ops-alerts would get a ledger item on 'companions', which can never close (Q355).
-- No queue answers them on its own: the alert's link is /admin?view=payouts with no member or order in it, and the
-- admin's answer (lift the seller's payout hold, or refund the buyer) is a decision, not a row that empties.
-- WHAT THIS DOES: restates admin_alert_manual_close() from its newest definition
-- (20260926035647_admin_notice_alerts_close_themselves.sql), verbatim but for the two added rows, so the ledger labels
-- both 'manual' (ops_alert_ledger_admin_manual) and a person closes them with evidence. Nothing else changes: the
-- trigger, admin_alert_close_rule() and admin_queue_still_pending() are untouched. Prefixes are lower case, as
-- ops_alert_normalise() returns them.
-- REPLAY-SAFETY: CREATE OR REPLACE of an IMMUTABLE SQL function; grants restated as they were.

CREATE OR REPLACE FUNCTION public.admin_alert_manual_close(p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM (VALUES
        ('cancellation fee transfer failed', 'manual'),
        -- 20261031152545: a sold listing the automatic check flagged, or never finished; the seller's payouts wait.
        ('a sold declutter listing failed its check', 'manual'),
        ('a sold declutter listing was never checked', 'manual')
      ) AS r(prefix, rule)
     WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%')
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_manual_close(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_manual_close(text) TO service_role;
