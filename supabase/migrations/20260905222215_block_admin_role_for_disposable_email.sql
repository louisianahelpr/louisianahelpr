-- PRODUCTION ADMIN WAS REACHABLE BY ANYONE WITH A BROWSER.
--
-- Found 2026-09-05: 10 of the 13 rows in `user_roles` with role='admin'
-- belonged to accounts at @mailinator.com. Mailinator is a PUBLIC inbox — its
-- messages are readable by anyone, with no login — and every one of those
-- accounts was email_confirmed with a password set. So the whole path to
-- production admin was:
--
--   1. open the login page, press "Forgot Password"
--   2. enter helpr-audit-rail01@mailinator.com  (or any of the other nine)
--   3. read the reset link in the public inbox
--   4. set a password, sign in — bans, dispute resolution, partial refunds,
--      payout freezes, every user's PII
--
-- No credential required at any step. The eleven grants were revoked when this
-- was found; prod admin is now exactly the two real owner accounts.
--
-- They accreted one audit at a time — helpr-audit-money, helpr-audit-rail01,
-- helpr-audit-referral01, helpr-audit-web3 and the rest are all throwaway
-- fixtures that someone made admin to test an admin screen and never revoked.
-- A one-time cleanup would be undone by the next audit that needs one, so the
-- rule belongs in the database.
--
-- Scope is deliberately narrow: this blocks the ADMIN role only, and only for
-- addresses at known disposable-inbox providers. Those domains exist precisely
-- so that anyone can read the mail, which is exactly the property that makes an
-- account-recovery flow a public door. Ordinary roles are untouched, so a
-- disposable address stays perfectly usable as a test CUSTOMER — which is what
-- the audit fixtures actually need.
--
-- This does NOT try to be a general anti-throwaway list. It is a targeted
-- privilege guard: matching one of these domains is sufficient evidence that an
-- account must not hold admin, and a miss (some domain not on the list) leaves
-- things exactly as they are today rather than making them worse.

CREATE OR REPLACE FUNCTION public.enforce_no_admin_for_disposable_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text;
  -- Public/disposable inboxes: mail sent here is readable without authenticating,
  -- so password recovery on such an account is not a private channel.
  disposable CONSTANT text[] := ARRAY[
    'mailinator.com',
    'guerrillamail.com',
    'yopmail.com',
    '10minutemail.com',
    'tempmail.com',
    'temp-mail.org',
    'throwawaymail.com',
    'sharklasers.com',
    'trashmail.com',
    'maildrop.cc'
  ];
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = NEW.user_id;

  -- No email on file is not evidence of anything; leave that judgement alone
  -- rather than inventing a refusal this trigger cannot justify.
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(disposable) AS d
    WHERE v_email LIKE '%@' || d
  ) THEN
    RAISE EXCEPTION
      'Refusing to grant admin to %, which is a public/disposable inbox: anyone can read its password-reset mail. Use a real, controlled address for admin accounts.',
      v_email
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_no_admin_for_disposable_email ON public.user_roles;
CREATE TRIGGER trg_no_admin_for_disposable_email
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_no_admin_for_disposable_email();
