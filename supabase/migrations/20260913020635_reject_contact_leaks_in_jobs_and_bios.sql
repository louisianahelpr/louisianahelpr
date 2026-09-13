-- Two contact-smuggling gaps (terminal 7, 2026-09-12; owner said YES to both).
--
-- 1. contact_leak_reason(text)'s email pattern only matched a single-label
--    domain (`[a-z0-9]+\.[a-z]{2,}`), so `jane@my-domain.com` — or anything
--    with a hyphen or a subdomain — sailed through the SERVER gate that
--    scan_message_content and scan_application_contact_info rely on. The
--    client scanner (src/lib/messageScanner.ts) already caught it, which only
--    matters for people who use the app; a direct REST sender never saw it.
--    The domain now matches the client: `[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}`.
--    Every other pattern is byte-for-byte the live definition read via
--    pg_get_functiondef on 2026-09-12 (contactFilterParity.test.ts replicates
--    it in JS and will fail if the two drift).
--
-- 2. Nothing scanned job titles/descriptions or profile bios at all, so a
--    phone number or "venmo me" in a JOB POST or a BIO was stored verbatim and
--    shown to every browser. Messages are hidden-and-struck; a post or a bio
--    has no recipient to hide it from, so the decision is to REJECT the write
--    outright with a check_violation and a message the app can show verbatim.
--    Universal: no is_seed or role exemption — the E2E/seed writers were
--    changed to letter-prefixed base36 run ids instead, so their own titles
--    stop looking like phone numbers. Fires only when the scanned column
--    actually changes, so an unrelated UPDATE (status, payment) on an old
--    row that already contains a leak is not blocked. The ~60 pre-existing
--    flagged rows (all seed/E2E) are left alone; see docs/OPEN.md.
--
-- REPLAY-SAFETY: everything is CREATE OR REPLACE / DROP TRIGGER IF EXISTS,
-- guarded on the tables existing, so it applies cleanly any number of times.

CREATE OR REPLACE FUNCTION public.contact_leak_reason(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;

  v_norm := translate(p_text, '０１２３４５６７８９', '0123456789');

  IF v_norm ~* '[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    RETURN 'Phone number detected';
  ELSIF p_text ~* '[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' THEN
    RETURN 'Email address detected';
  ELSIF p_text ~* '\mvenmo\M|\mcashapp\M|\mcash app\M|\mzelle\M|\mpaypal\M|\mapple\s*pay\M|\mgoogle\s*pay\M|\mcrypto\M|\mbitcoin\M|\mbtc\M|\meth\M' THEN
    RETURN 'Off-platform payment service mentioned';
  ELSIF p_text ~* '\mpay me direct\M|\moff the app\M|\moutside the app\M|\mskip the fee\M|\mavoid the fee\M|\mcash only\M|\min cash\M|\mtext me\M|\mcall me\M|\mwhatsapp\M|\mtelegram\M|\mdm me\M|\mhit me up\M|\mcontact me at\M|\mreach me at\M|\msend money to\M|\mpay outside\M' THEN
    RETURN 'Off-platform payment intent detected';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;

-- Jobs: title + description. Rejects, never hides.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    v_reason := public.contact_leak_reason(NEW.title);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job title. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description THEN
    v_reason := public.contact_leak_reason(NEW.description);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job description. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Profiles: bio.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.bio IS DISTINCT FROM OLD.bio THEN
    v_reason := public.contact_leak_reason(NEW.bio);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in your bio. Keep contact details and payment off your profile; hiring and payment happen in the app.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_job ON public.jobs;
    CREATE TRIGGER trg_reject_contact_leak_in_job
      BEFORE INSERT OR UPDATE OF title, description ON public.jobs
      FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_job();
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_profile ON public.profiles;
    CREATE TRIGGER trg_reject_contact_leak_in_profile
      BEFORE INSERT OR UPDATE OF bio ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_profile();
  END IF;
END $$;
