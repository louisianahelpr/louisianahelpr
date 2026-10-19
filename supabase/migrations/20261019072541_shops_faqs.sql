-- SH12 (shop profile kit, owner 2026-10-19 ~00:35Z): a shop's FAQs, its policies
-- card, and a stricter contact filter for everything a shop writes publicly.
--
-- Up to 10 question + answer pairs a shop owner writes once ("Do you deliver?",
-- "How far ahead should I order?") so buyers stop asking the same thing in
-- messages. Shown on the shop page (members) and on the public link page.
--
--   * public.shop_text_clean(text): NFKC-normalizes, then removes every
--     invisible character (the Unicode Cf class, variation selectors, CGJ,
--     Hangul fillers, braille blank) so "3\u200B3\u200B7...", a fullwidth or
--     circled number, or "sweet\u00ADbayou.com" cannot slip a number or link past
--     the checks. Used before CHECKING and before STORING (lead /code-review
--     #6, v2 #1).
--   * public.shop_contact_leak_reason(text): the app-wide contact_leak_reason
--     on the cleaned text, PLUS website links, bare domains, social handles
--     and "find us on <social>" (lead /code-review #2). Deliberately a SHOP
--     function, not a change to contact_leak_reason: that one also scans every
--     message (scan_message_content), job text and reviews, and has a client
--     twin held equal by src/lib/contactFilterParity.test.ts; widening it to
--     links would change messaging app-wide, which is not this slice's call.
--     It now also guards the shop name/about/area (reject_contact_leak_in_shop,
--     restated below to call it).
--   * public.shop_faqs: no client grants at all. Enforced on the TABLE, not
--     only in the RPC (lead #3): a BEFORE INSERT/UPDATE row trigger cleans
--     and checks each question and answer, and an AFTER statement trigger
--     checks the JOINED text of all of a shop's questions and answers, so a
--     phone number or email split across fields is caught too (lead #1).
--   * shops_set_my_faqs(jsonb): the caller's OWN shop only, behind the
--     'shops' switch and the owner gates every shop write runs
--     (shops_assert_owner_eligible); refused while Louisiana Helpr has the
--     shop hidden (shop_hidden, like item writes, lead #5); replaces the
--     whole list in one go; lengths checked.
--   * shops_shop_faqs(uuid) / shops_shop_policies(uuid): what a viewer may
--     see: the shop's owner, an admin (a hidden or paused shop too, lead #4),
--     or anyone while the shop passes shop_link_visible (the public page's
--     rule). Policies = the cancel preset and ready-tap choice a buyer
--     already reads in the order sheet before paying. NULL for every refusal.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS before each CREATE TRIGGER.

CREATE OR REPLACE FUNCTION public.shop_text_clean(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- NFKC first (fullwidth and circled digits, ligatures, compatibility
  -- letters become plain ones), then every invisible character removed: the
  -- whole Unicode Cf (format) class, the variation selectors, the combining
  -- grapheme joiner, the Hangul fillers and the braille blank. Postgres
  -- regexes have no \p{...} classes, so the class is spelled out; the guard
  -- src/test/shopFaqs.test.ts proves this list covers every code point the
  -- JS engine's Unicode data puts in \p{Cf} and \p{Variation_Selector}.
  SELECT regexp_replace(
    normalize(p_text, NFKC),
    '[\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F\U000E0100-\U000E01EF]',
    '', 'g');
$fn$;
REVOKE ALL ON FUNCTION public.shop_text_clean(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_text_clean(text) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_contact_leak_reason(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v text := public.shop_text_clean(p_text);
  v_reason text;
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN NULL;
  END IF;
  v_reason := public.contact_leak_reason(v);
  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;
  -- Words, not a list of every TLD: the common ones written plainly
  -- ("sweetbayou.com", "facebook.com/sweetbayou", "bit.ly/x"), and the three
  -- most common spelled out or spaced ("sweetbayou dot com", "sweetbayou . com").
  -- No spaces around the dot for the rest, so a sentence ("...St. Martin. Us
  -- too") never reads as a link; short TLDs that are also words (us, me, co)
  -- are left out for the same reason.
  IF v ~* '(https?://|\mwww\.)' THEN
    RETURN 'Website link detected';
  ELSIF v ~* '\m[a-z0-9][a-z0-9-]*\.(com|net|org|io|biz|info|shop|store|app|site|online|page|link|bio|tv|gg|ly|gl)\M'
     OR v ~* '\m[a-z0-9][a-z0-9-]*\s*(\.|\(dot\)|\[dot\]|\sdot\s)\s*(com|net|org)\M' THEN
    RETURN 'Website link detected';
  ELSIF v ~* '(^|[^a-z0-9._])@[a-z0-9_][a-z0-9._]+' THEN
    RETURN 'Social media handle detected';
  -- Platform names that are only ever platforms, anywhere; the ones that are
  -- also plain words (ig, snap, threads, tt) only in a social context ("find
  -- us on snap", "IG: name", "threads @name"), so "snap peas" and a sewing
  -- shop's "threads" stay fine.
  ELSIF v ~* '\m(instagram|insta|facebook|fb|tiktok|snapchat|twitter|linktree|youtube|pinterest)\M'
     OR v ~* '\mlinktr\.ee\M'
     OR v ~* '\m(on|at|via|follow|find|add|dm|message|my|our)\s+(us\s+on\s+|me\s+on\s+)?(ig|snap|threads|tt)\M'
     OR v ~* '\m(ig|snap|threads|tt)\s*[:@]' THEN
    RETURN 'Social media account mentioned';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_contact_leak_reason(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_contact_leak_reason(text) TO service_role;

-- The shop profile's own trigger (newest body 20261017061157) now uses the shop filter,
-- so the about field gets links and handles refused too. Same fields, same
-- trigger; only the check and its words change.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_shop()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
    v_reason := public.shop_contact_leak_reason(NEW.name); v_where := 'name';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.about IS DISTINCT FROM OLD.about) THEN
    v_reason := public.shop_contact_leak_reason(NEW.about); v_where := 'about';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.area_label IS DISTINCT FROM OLD.area_label) THEN
    v_reason := public.shop_contact_leak_reason(NEW.area_label); v_where := 'area';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep phone numbers, emails, websites and social accounts off your shop; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop() FROM PUBLIC, anon, authenticated;

-- Items get the same filter (lead v2 #4), restated from the newest body
-- (20261017061157); its words are re-checked ALSO when an item goes live, so a
-- draft written before this filter cannot be published unchecked.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_shop_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where text;
  v_going_live boolean := TG_OP = 'UPDATE' AND NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live';
BEGIN
  IF TG_OP = 'INSERT' OR v_going_live OR NEW.title IS DISTINCT FROM OLD.title THEN
    v_reason := public.shop_contact_leak_reason(NEW.title); v_where := 'title';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR v_going_live OR NEW.description IS DISTINCT FROM OLD.description) THEN
    v_reason := public.shop_contact_leak_reason(NEW.description); v_where := 'description';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep phone numbers, emails, websites and social accounts off your items; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_shop_item ON public.shop_items;
CREATE TRIGGER trg_reject_contact_leak_in_shop_item
  BEFORE INSERT OR UPDATE OF title, description, status ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_shop_item();

-- Backfill (lead v2 #5): text written before this filter is re-checked once.
-- Nothing is deleted. A shop that fails is HIDDEN with the reason (the admin
-- card shows it; unhide after the owner edits). An item that fails keeps its
-- words, gets the reason as its text flag (the admin queue shows it), and a
-- live one goes back to pending_review for an admin's OK. Measured on prod
-- 2026-10-19 08:1xZ: 0 shops, 0 items, so today this touches nothing.
-- Replay-safe: hidden shops are skipped; an item re-flagged gets the same flag.
DO $backfill$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT id, name, about, area_label FROM public.shops WHERE hidden_at IS NULL LOOP
    v := COALESCE(public.shop_contact_leak_reason(r.name), public.shop_contact_leak_reason(r.about),
                  public.shop_contact_leak_reason(r.area_label));
    IF v IS NOT NULL THEN
      UPDATE public.shops
         SET hidden_at = now(),
             hidden_reason = left('Hidden for review by the stricter Shops contact filter (SH12): ' || v
                                  || '. Check the name, about and area with the owner, then unhide.', 500)
       WHERE id = r.id;
    END IF;
  END LOOP;
  FOR r IN SELECT id, owner_id, status, title, description FROM public.shop_items
            WHERE status IN ('draft', 'pending_review', 'live') LOOP
    v := COALESCE(public.shop_contact_leak_reason(r.title), public.shop_contact_leak_reason(r.description));
    IF v IS NOT NULL THEN
      INSERT INTO public.shop_item_private (item_id, owner_id, text_flag_reason)
      VALUES (r.id, r.owner_id, left('Stricter Shops contact filter (SH12): ' || v, 300))
      ON CONFLICT (item_id) DO UPDATE SET text_flag_reason = EXCLUDED.text_flag_reason, updated_at = now();
      IF r.status = 'live' THEN
        UPDATE public.shop_items SET status = 'pending_review', submitted_at = now(), admin_approved_at = NULL
         WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
END;
$backfill$;

CREATE TABLE IF NOT EXISTS public.shop_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  question text NOT NULL CHECK (char_length(question) BETWEEN 3 AND 140),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, position)
);
ALTER TABLE public.shop_faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_faqs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_faqs TO service_role;
-- Q807: the new table refuses a write from a session whose email is not confirmed (writes come only through shops_set_my_faqs).
SELECT public.attach_unconfirmed_email_gate();

-- Each row: invisible characters stripped from what is STORED, then checked.
CREATE OR REPLACE FUNCTION public.shop_faq_clean_and_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
BEGIN
  NEW.question := btrim(public.shop_text_clean(NEW.question));
  NEW.answer := btrim(public.shop_text_clean(NEW.answer));
  v_reason := COALESCE(public.shop_contact_leak_reason(NEW.question), public.shop_contact_leak_reason(NEW.answer));
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in a question or answer. Keep phone numbers, emails, websites and social accounts off your shop; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_faq_clean_and_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_faq_clean_and_check ON public.shop_faqs;
CREATE TRIGGER trg_shop_faq_clean_and_check
  BEFORE INSERT OR UPDATE OF question, answer ON public.shop_faqs
  FOR EACH ROW EXECUTE FUNCTION public.shop_faq_clean_and_check();

-- All of a shop's questions and answers read together, in order: a number or
-- an email split across two fields ("...337-555-" / "1234 ...", "name@" /
-- "gmail.com") is one piece of contact. Joined with a space AND with nothing,
-- since either can be how the pieces were meant to be read.
CREATE OR REPLACE FUNCTION public.shop_faqs_check_joined()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_shop uuid;
  v_spaced text;
  v_tight text;
  v_q_spaced text;
  v_q_tight text;
  v_a_spaced text;
  v_a_tight text;
  v_reason text;
BEGIN
  FOR v_shop IN SELECT DISTINCT n.shop_id FROM new_rows n LOOP
    -- Everything in order, and the questions alone and the answers alone (so
    -- no words sit between the pieces), each with a space and with nothing.
    SELECT string_agg(f.question || ' ' || f.answer, ' ' ORDER BY f.position),
           string_agg(f.question || f.answer, '' ORDER BY f.position),
           string_agg(f.question, ' ' ORDER BY f.position),
           string_agg(f.question, '' ORDER BY f.position),
           string_agg(f.answer, ' ' ORDER BY f.position),
           string_agg(f.answer, '' ORDER BY f.position)
      INTO v_spaced, v_tight, v_q_spaced, v_q_tight, v_a_spaced, v_a_tight
      FROM public.shop_faqs f WHERE f.shop_id = v_shop;
    v_reason := COALESCE(public.shop_contact_leak_reason(v_spaced), public.shop_contact_leak_reason(v_tight),
                         public.shop_contact_leak_reason(v_q_spaced), public.shop_contact_leak_reason(v_q_tight),
                         public.shop_contact_leak_reason(v_a_spaced), public.shop_contact_leak_reason(v_a_tight));
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' across your questions and answers. Keep phone numbers, emails, websites and social accounts off your shop; Louisiana Helpr does not allow contact details in Shops.';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_faqs_check_joined() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_faqs_check_joined_ins ON public.shop_faqs;
CREATE TRIGGER trg_shop_faqs_check_joined_ins
  AFTER INSERT ON public.shop_faqs
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.shop_faqs_check_joined();
DROP TRIGGER IF EXISTS trg_shop_faqs_check_joined_upd ON public.shop_faqs;
CREATE TRIGGER trg_shop_faqs_check_joined_upd
  AFTER UPDATE ON public.shop_faqs
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.shop_faqs_check_joined();

CREATE OR REPLACE FUNCTION public.shops_set_my_faqs(p_faqs jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_hidden timestamptz;
  v_e jsonb;
  v_q text;
  v_a text;
  v_pos smallint := 0;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id, hidden_at INTO v_shop, v_hidden FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_hidden IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501', HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  IF p_faqs IS NULL OR jsonb_typeof(p_faqs) <> 'array' OR jsonb_array_length(p_faqs) > 10 THEN
    RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023', HINT = 'A shop can have up to 10 questions.';
  END IF;
  DELETE FROM public.shop_faqs WHERE shop_id = v_shop;
  FOR v_e IN SELECT e FROM jsonb_array_elements(p_faqs) e LOOP
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023';
    END IF;
    v_q := btrim(public.shop_text_clean(COALESCE(v_e ->> 'question', '')));
    v_a := btrim(public.shop_text_clean(COALESCE(v_e ->> 'answer', '')));
    IF char_length(v_q) NOT BETWEEN 3 AND 140 OR char_length(v_a) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'invalid_faqs' USING ERRCODE = '22023',
        HINT = 'Each question needs 3 to 140 characters and an answer of up to 600.';
    END IF;
    -- The contact checks (each field, and all of them joined) are the table's
    -- triggers: trg_shop_faq_clean_and_check and trg_shop_faqs_check_joined_ins.
    INSERT INTO public.shop_faqs (shop_id, position, question, answer) VALUES (v_shop, v_pos, v_q, v_a);
    v_pos := v_pos + 1;
  END LOOP;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN v_pos;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_my_faqs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_my_faqs(jsonb) TO authenticated, service_role;

-- Who may read a shop's FAQs and policies: its owner, an admin, or anyone
-- while the shop passes the public page's rule.
CREATE OR REPLACE FUNCTION public.shop_extras_readable(p_shop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF p_shop_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_uid IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid)
       OR COALESCE(public.has_role(v_uid, 'admin'::app_role), false)) THEN
    RETURN EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id);
  END IF;
  RETURN COALESCE(public.shop_link_visible(p_shop_id), false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_extras_readable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_extras_readable(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_shop_faqs(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.shop_extras_readable(p_shop_id) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('question', f.question, 'answer', f.answer) ORDER BY f.position)
      FROM public.shop_faqs f WHERE f.shop_id = p_shop_id), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_faqs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shops_shop_faqs(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_shop_policies(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.shop_extras_readable(p_shop_id) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT jsonb_build_object('cancel_policy', s.cancel_policy, 'ready_tap_cancel', s.ready_tap_cancel)
            FROM public.shops s WHERE s.id = p_shop_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_policies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shops_shop_policies(uuid) TO anon, authenticated, service_role;
