-- log_notification is a SECURITY DEFINER write that was granted to `authenticated`,
-- which let any logged-in user write notification_logs rows for ANY user id.
--
-- The table's own RLS says the opposite in as many words:
--   policy "Only service role can insert notification logs" — cmd INSERT, roles {service_role}
-- A definer function granted to `authenticated` bypasses that policy entirely, so the
-- policy was decorative for anyone holding a session.
--
-- Proven on prod 2026-09-03 (rolled back): a non-admin called
--   log_notification(<victim uuid>,'forged_category','email','delivered','FORGED SUBJECT',null,null,'msg_forged')
-- and one row landed against the victim's user_id, with the victim's real email
-- stamped into recipient_email by the function's own lookup. The attacker could not
-- read it back (no non-admin SELECT policy), so this is log FORGERY, not disclosure:
-- it corrupts the delivery audit trail admins use to answer "did that email send?",
-- and it is unrate-limited row growth.
--
-- Safe to revoke: the only callers are service-role edge functions
-- (supabase/functions/_shared/notificationLog.ts and
-- supabase/functions/send-notification-email/index.ts). No src/ caller exists —
-- the sole hit is the generated types.ts entry, which is not a call.
--
-- NOTE for anyone changing this function later: adding a parameter creates an
-- OVERLOAD rather than replacing it, and the old signature keeps this grant. Drop
-- the old signature explicitly, or this revoke silently stops covering the live one.

DO $$
BEGIN
  IF to_regprocedure(
       'public.log_notification(uuid,text,text,text,text,uuid,text,text)'
     ) IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION
      public.log_notification(uuid,text,text,text,text,uuid,text,text)
      FROM authenticated;
    -- anon never held it; revoked defensively so a future default-grant cannot
    -- reintroduce the hole through the other client role.
    REVOKE EXECUTE ON FUNCTION
      public.log_notification(uuid,text,text,text,text,uuid,text,text)
      FROM anon;
  END IF;
END $$;
