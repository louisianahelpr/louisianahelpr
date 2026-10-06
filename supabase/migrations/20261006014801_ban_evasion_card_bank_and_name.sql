-- Q1324: a banned person comes back with a new email and the same card, the
-- same bank account, or the same name.
--
-- WHAT WAS THERE (read live from prod, 2026-10-05). retained_bans keys a ban
-- on three values: email_sha256 (unsalted), phone_sha256 and identity_sha256
-- (salted with the Vault secret, ban_fingerprint()). enforce_retained_ban()
-- is called by handle_new_user (email), complete-signup (email + phone) and
-- stripe-idv-webhook (identity). Nothing looked at how the person PAYS or how
-- they are PAID, and nothing looked at their name. A new email plus a new
-- phone number walked straight past every key, with the same card in hand.
--
-- OWNER RULES (2026-10-05, final):
--   * card AND bank fingerprints AUTO-BAN, through the same mechanism as the
--     existing keys: profiles.ban_status + user_bans (the retained-ban
--     re-application, app.retained_ban_reapply) + a ban_evasion_attempt
--     fraud flag. banned_until is never set (banned users keep sign-in).
--   * a NAME match only raises an admin doubt-check record
--     (ban_evasion_matches, matched_on 'name'). It never bans anyone.
--   * only Stripe's own fingerprint values are used, and only their salted
--     hashes are stored: no card number, no bank account number, no name.
--
-- WHAT THIS ADDS.
--   1. public.payment_fingerprints: the live account's carrier, like
--      profiles.identity_sha256 is for the identity key. One row per
--      (person, 'card'|'bank', ban_fingerprint(kind, <Stripe fingerprint>)).
--      Written only by enforce_retained_payment_ban(), which the edge
--      functions call when a card or payout account reaches us:
--        - stripe-webhook checkout.session.completed (the card that paid)
--        - stripe-connect `status` and stripe-webhook account.updated (the
--          Connect account's external bank accounts / debit cards).
--      Server-only: RLS on with no policy, no client grant. FK to auth.users
--      ON DELETE CASCADE, so account deletion (auth.admin.deleteUser, after
--      retain_ban_on_deletion has copied the hashes) removes it.
--   2. retained_bans.card_sha256 / bank_sha256 (text[]) and name_sha256: what a
--      ban keeps after the account is gone. retain_ban_for_user() fills them
--      at ban time and at deletion, like phone_sha256 and identity_sha256.
--   3. enforce_retained_payment_ban(user, kind, stripe_fingerprint): records
--      the fingerprint, and if a live retained ban holds it, applies that ban
--      exactly as enforce_retained_ban does. An account that is already banned
--      is never re-banned at a different level (a permanent ban is never
--      softened into a suspension by a later match).
--   4. flag_possible_ban_evasion_by_name(): AFTER INSERT / UPDATE OF full_name
--      on profiles. A name whose salted, normalised hash matches a live
--      retained ban files ONE admin-only ban_evasion_matches row. It never
--      writes ban_status, and it never raises (a signup must not fail on it).
--
-- Every match excludes the retained row that belongs to the account itself
-- (same email hash), so a banned account is not "evading" its own ban.
--
-- REVISED after review (2026-10-05, same branch, not yet deployed):
--   * THIRD-PARTY DATA STAYS ADMIN-ONLY (lh-authz-rls). export_my_data hands a
--     person every fraud_flags row about them, so a match's details (the other
--     banned account's ban reason, date, retained-ban id) never go into
--     fraud_flags. They live in public.ban_evasion_matches, which admins read
--     and no client export touches. A NAME match writes no fraud_flags row at
--     all: its mere presence in an export would tell the person that the name
--     they typed belongs to a banned account.
--   * BAN NOW, ADMIN SETTLES (owner, 2026-10-05 ~22:00 CT). A card / bank
--     match still bans at once, but the account's jobs are NOT settled by
--     trg_settle_one_off_jobs_on_permanent_ban / trg_series_end_on_permanent_ban
--     (both skip while app.ban_settlement_review is set by this path only).
--     Instead: a public.ban_settlement_queue row, a payout hold (the account
--     cannot get paid; Q764 + Q1221 also freeze its Stripe auto-payouts), and
--     an admin decision. While open the account is 'banned' with no end date
--     (no expiry can lift it); the retained judgment is kept on the review.
--     admin_confirm_ban_settlement() applies it and runs the normal settlement
--     as of the ban; an ADMIN lift (admin-user-actions set_ban_status ->
--     lift_ban_settlement_review, open or confirmed) closes the review,
--     releases the hold and clears this account's matches so the same card
--     does not ban it again; nothing else may unban during an open review
--     (trg_refuse_unban_during_ban_review). An admin's own manual ban is
--     unchanged. admin_ban_settlement_reviews() lists every open review with
--     every job the settlement would act on (the same predicate), so no job is
--     left where no admin can see it.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS,
-- the Supabase-only helpers behind to_regprocedure. Applied 3x in PGlite by
-- src/test/pglite/banEvasionCardBankName.pglite.mjs.

-- ── 1. Name normalisation ───────────────────────────────────────────────────
--
-- Lower-case letters only, every run of anything else one space. NULL unless
-- there are at least two words and five letters: a lone first name ("John")
-- matches far too many strangers to be worth an admin's time.
CREATE OR REPLACE FUNCTION public.normalize_name_for_ban(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN n IS NULL OR n = '' THEN NULL
    WHEN array_length(regexp_split_to_array(n, ' '), 1) < 2 THEN NULL
    WHEN length(replace(n, ' ', '')) < 5 THEN NULL
    ELSE n
  END
  FROM (
    SELECT btrim(regexp_replace(lower(COALESCE(p_name, '')), '[^a-z]+', ' ', 'g')) AS n
  ) s;
$$;

COMMENT ON FUNCTION public.normalize_name_for_ban(text) IS
  'Q1324: lower-case letters with single spaces; NULL for fewer than two words '
  'or five letters. The canonical form hashed into retained_bans.name_sha256.';

REVOKE ALL ON FUNCTION public.normalize_name_for_ban(text) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.normalize_name_for_ban(text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_name_for_ban(text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 2. The live account's payment fingerprints ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_fingerprints (
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint_kind   text NOT NULL CHECK (fingerprint_kind IN ('card', 'bank')),
  fingerprint_sha256 text NOT NULL CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fingerprint_kind, fingerprint_sha256)
);

COMMENT ON TABLE public.payment_fingerprints IS
  'Q1324: ban_fingerprint(kind, <Stripe card/bank fingerprint>) for every card '
  'that paid and every payout account attached, per person. Salted hashes only, '
  'never card or account numbers. Copied into retained_bans when the person is '
  'banned. Server-only.';

CREATE INDEX IF NOT EXISTS payment_fingerprints_kind_hash_idx
  ON public.payment_fingerprints (fingerprint_kind, fingerprint_sha256);

ALTER TABLE public.payment_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_fingerprints FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.payment_fingerprints FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT ALL ON TABLE public.payment_fingerprints TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END;
$$;

-- ── 2b. Admin-only match records and the settlement review queue ──────────

CREATE TABLE IF NOT EXISTS public.ban_evasion_matches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_on           text NOT NULL CHECK (matched_on IN ('card', 'bank', 'name', 'email', 'phone', 'identity')),
  -- ban_fingerprint() of THIS account's own card / bank / name that matched.
  match_sha256         text,
  retained_ban_id      uuid,
  original_ban_status  text,
  original_reason      text,
  original_recorded_at timestamptz,
  original_expires_at  timestamptz,
  auto_banned          boolean NOT NULL DEFAULT false,
  resolved             boolean NOT NULL DEFAULT false,
  cleared_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ban_evasion_matches IS
  'Q1324: an account that matched a retained ban on card, bank or name, with the '
  'OTHER (banned) account''s ban details. Admin-only: never exported to the '
  'matched person (GDPR Art. 15(4): it is about someone else). cleared_at = an '
  'admin lifted the resulting ban, so this account is not re-banned on it.';

CREATE UNIQUE INDEX IF NOT EXISTS ban_evasion_matches_once
  ON public.ban_evasion_matches (user_id, matched_on, retained_ban_id);
CREATE INDEX IF NOT EXISTS ban_evasion_matches_open_idx
  ON public.ban_evasion_matches (created_at) WHERE NOT resolved;

ALTER TABLE public.ban_evasion_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ban_evasion_matches FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.ban_evasion_matches FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.ban_evasion_matches TO authenticated';
  EXECUTE 'GRANT ALL ON TABLE public.ban_evasion_matches TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;
DROP POLICY IF EXISTS ban_evasion_matches_admin_read ON public.ban_evasion_matches;
CREATE POLICY ban_evasion_matches_admin_read ON public.ban_evasion_matches
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
DROP POLICY IF EXISTS ban_evasion_matches_admin_resolve ON public.ban_evasion_matches;

CREATE TABLE IF NOT EXISTS public.ban_settlement_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_on  text NOT NULL CHECK (matched_on IN ('card', 'bank')),
  review_state text NOT NULL DEFAULT 'open' CHECK (review_state IN ('open', 'confirmed', 'lifted')),
  -- The retained judgment the match carried. While the review is open the
  -- account is 'banned' with no end date (it stays banned until an admin
  -- decides; no expiry can lift it); a confirm applies these.
  original_ban_status text,
  original_expires_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Last page for this review (ban-review-watch, 20261006030849).
  alerted_at  timestamptz
);

COMMENT ON TABLE public.ban_settlement_queue IS
  'Q1324 (owner 2026-10-05, "ban now, admin settles"): an account banned '
  'automatically on a card / bank match. Its jobs are not settled until an '
  'admin confirms (admin_confirm_ban_settlement) or lifts the ban.';

CREATE UNIQUE INDEX IF NOT EXISTS ban_settlement_reviews_one_open
  ON public.ban_settlement_queue (user_id) WHERE review_state = 'open';

ALTER TABLE public.ban_settlement_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ban_settlement_queue FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.ban_settlement_queue FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.ban_settlement_queue TO authenticated';
  EXECUTE 'GRANT ALL ON TABLE public.ban_settlement_queue TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;
DROP POLICY IF EXISTS ban_settlement_reviews_admin_read ON public.ban_settlement_queue;
CREATE POLICY ban_settlement_reviews_admin_read ON public.ban_settlement_queue
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END;
$$;

-- ── 3. What a ban keeps ─────────────────────────────────────────────────────

ALTER TABLE public.retained_bans
  ADD COLUMN IF NOT EXISTS card_sha256 text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS bank_sha256 text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS name_sha256 text;

COMMENT ON COLUMN public.retained_bans.card_sha256 IS
  'Q1324: ban_fingerprint(''card'', <Stripe card fingerprint>) of every card the '
  'banned account paid with. A match AUTO-BANS (enforce_retained_payment_ban).';
COMMENT ON COLUMN public.retained_bans.bank_sha256 IS
  'Q1324: ban_fingerprint(''bank'', <Stripe bank fingerprint>) of every payout '
  'bank account on the banned account''s Connect account. A match AUTO-BANS.';
COMMENT ON COLUMN public.retained_bans.name_sha256 IS
  'Q1324: ban_fingerprint(''name'', normalize_name_for_ban(full_name)). A match '
  'only files an admin-only ban_evasion_matches row; it never bans.';

CREATE INDEX IF NOT EXISTS retained_bans_card_sha256_idx ON public.retained_bans USING gin (card_sha256);
CREATE INDEX IF NOT EXISTS retained_bans_bank_sha256_idx ON public.retained_bans USING gin (bank_sha256);
CREATE INDEX IF NOT EXISTS retained_bans_name_sha256_idx
  ON public.retained_bans (name_sha256) WHERE name_sha256 IS NOT NULL;

-- ── 4. Retention copies every key ───────────────────────────────────────────
--
-- The live body (20260908002148, unchanged since; pg_get_functiondef
-- 2026-10-05) plus the three new keys. Both callers are unchanged: the
-- trg_retain_ban_on_ban trigger at ban time and retain_ban_on_deletion before
-- purge_user_data nulls the email.

CREATE OR REPLACE FUNCTION public.retain_ban_for_user(p_user_id uuid, p_via text DEFAULT 'ban')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email    text;
  v_phone    text;
  v_ident    text;
  v_name     text;
  v_status   text;
  v_until    timestamptz;
  v_ban      RECORD;
  v_reason   text;
  v_expires  timestamptz;
  v_phone_h  text;
  v_name_h   text;
  v_cards    text[];
  v_banks    text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'retain_ban_for_user: p_user_id is required';
  END IF;

  SELECT email, phone, identity_sha256, full_name, ban_status, auto_suspended_until
    INTO v_email, v_phone, v_ident, v_name, v_status, v_until
    FROM public.profiles
   WHERE user_id = p_user_id;

  -- Not banned, or already anonymised (email NULL): nothing to retain.
  -- final_warning is a warning, not a restriction.
  IF v_email IS NULL
     OR COALESCE(v_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
  THEN
    RETURN 0;
  END IF;

  SELECT ban_type, reason, expires_at
    INTO v_ban
    FROM public.user_bans
   WHERE user_id = p_user_id
     AND is_active
   ORDER BY created_at DESC
   LIMIT 1;

  v_reason := COALESCE(NULLIF(btrim(v_ban.reason), ''), 'A violation of our Platform Rules.');

  v_expires := CASE
    WHEN v_status = 'permanently_banned' THEN NULL
    ELSE COALESCE(v_until, v_ban.expires_at)
  END;

  -- An already-lapsed suspension is not retained at all.
  IF v_expires IS NOT NULL AND v_expires <= now() THEN
    RETURN 0;
  END IF;

  v_phone_h := public.ban_fingerprint('phone', public.normalize_phone_for_ban(v_phone));
  v_name_h  := public.ban_fingerprint('name', public.normalize_name_for_ban(v_name));

  -- Q1324: every card that paid and every payout account attached.
  SELECT COALESCE(array_agg(fingerprint_sha256 ORDER BY fingerprint_sha256)
                    FILTER (WHERE fingerprint_kind = 'card'), '{}'::text[]),
         COALESCE(array_agg(fingerprint_sha256 ORDER BY fingerprint_sha256)
                    FILTER (WHERE fingerprint_kind = 'bank'), '{}'::text[])
    INTO v_cards, v_banks
    FROM public.payment_fingerprints
   WHERE user_id = p_user_id;

  -- A phone or identity hash already claimed by a DIFFERENT retained row would
  -- violate the partial uniques and abort the caller; the newer judgment wins.
  -- (Cards, banks and names have no unique index: two banned accounts may
  -- share one, and either still matches.)
  IF v_phone_h IS NOT NULL THEN
    UPDATE public.retained_bans SET phone_sha256 = NULL
     WHERE phone_sha256 = v_phone_h
       AND email_sha256 IS DISTINCT FROM encode(sha256(lower(btrim(v_email))::bytea), 'hex');
  END IF;
  IF v_ident IS NOT NULL THEN
    UPDATE public.retained_bans SET identity_sha256 = NULL
     WHERE identity_sha256 = v_ident
       AND email_sha256 IS DISTINCT FROM encode(sha256(lower(btrim(v_email))::bytea), 'hex');
  END IF;

  INSERT INTO public.retained_bans (
    email_sha256, phone_sha256, identity_sha256, card_sha256, bank_sha256, name_sha256,
    ban_status, ban_type, reason, expires_at, retained_via
  )
  VALUES (
    encode(sha256(lower(btrim(v_email))::bytea), 'hex'),
    v_phone_h,
    v_ident,
    v_cards,
    v_banks,
    v_name_h,
    v_status,
    v_ban.ban_type,
    v_reason,
    v_expires,
    COALESCE(p_via, 'ban')
  )
  ON CONFLICT (email_sha256) DO UPDATE
     SET ban_status      = EXCLUDED.ban_status,
         ban_type        = EXCLUDED.ban_type,
         reason          = EXCLUDED.reason,
         expires_at      = EXCLUDED.expires_at,
         -- COALESCE / union, not EXCLUDED: a re-retention after the profile was
         -- anonymised must not erase a key an earlier retention captured.
         phone_sha256    = COALESCE(EXCLUDED.phone_sha256, public.retained_bans.phone_sha256),
         identity_sha256 = COALESCE(EXCLUDED.identity_sha256, public.retained_bans.identity_sha256),
         name_sha256     = COALESCE(EXCLUDED.name_sha256, public.retained_bans.name_sha256),
         card_sha256     = ARRAY(SELECT DISTINCT u FROM unnest(public.retained_bans.card_sha256 || EXCLUDED.card_sha256) u ORDER BY u),
         bank_sha256     = ARRAY(SELECT DISTINCT u FROM unnest(public.retained_bans.bank_sha256 || EXCLUDED.bank_sha256) u ORDER BY u),
         retained_via    = EXCLUDED.retained_via,
         retained_at     = now(),
         reapplied_at    = NULL;

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.retain_ban_for_user(uuid, text) IS
  'Records an active ban against salted hashes of the account email, phone, '
  'Stripe Identity fingerprint, payment cards, payout bank accounts and name, so '
  'it survives deletion and a fresh signup. Returns rows retained (0 or 1).';

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.retain_ban_for_user(uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.retain_ban_for_user(uuid, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 5. Card / bank enforcement (AUTO-BAN) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_retained_payment_ban(
  p_user_id            uuid,
  p_kind               text,
  p_stripe_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_h        text;
  v_email    text;
  v_status   text;
  v_own_h    text;
  v_row      RECORD;
  v_already  boolean;
  v_own_reason CONSTANT text :=
    'A payment method on this account is linked to an account closed for breaking our Platform Rules. '
    || 'Contact support if you think this is a mistake.';
BEGIN
  -- Caller errors are errors: an edge function that passes nothing must hear
  -- about it, not get a quiet "not banned".
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('card', 'bank') THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: kind must be card or bank, got %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_stripe_fingerprint IS NULL OR btrim(p_stripe_fingerprint) = '' THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: a Stripe fingerprint is required' USING ERRCODE = '22023';
  END IF;

  -- Raises if the Vault salt is missing (ban_fingerprint_salt), which the
  -- caller reports. Never an unsalted hash.
  v_h := public.ban_fingerprint(p_kind, p_stripe_fingerprint);

  SELECT email, ban_status INTO v_email, v_status
    FROM public.profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: no profile for %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payment_fingerprints (user_id, fingerprint_kind, fingerprint_sha256)
  VALUES (p_user_id, p_kind, v_h)
  ON CONFLICT (user_id, fingerprint_kind, fingerprint_sha256) DO UPDATE SET last_seen_at = now();

  v_already := COALESCE(v_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned');
  v_own_h := CASE WHEN v_email IS NULL OR btrim(v_email) = '' THEN NULL
                  ELSE encode(sha256(lower(btrim(v_email))::bytea), 'hex') END;

  -- A banned account that attaches a new card or bank: its own retained row
  -- picks the new key up, so the NEXT account to use it is caught.
  IF v_already THEN
    PERFORM public.retain_ban_for_user(p_user_id, 'ban');
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans rb
   WHERE ((p_kind = 'card' AND v_h = ANY (rb.card_sha256))
       OR (p_kind = 'bank' AND v_h = ANY (rb.bank_sha256)))
     AND rb.email_sha256 IS DISTINCT FROM v_own_h
     -- An admin looked at this account with this card / bank and lifted the
     -- ban: the same payment method does not ban it again (every retained
     -- row that holds it, including later accounts banned on it).
     AND NOT EXISTS (
       SELECT 1 FROM public.ban_evasion_matches m
        WHERE m.user_id = p_user_id AND m.matched_on = p_kind
          AND m.match_sha256 = v_h AND m.cleared_at IS NOT NULL
     )
   -- The OLDEST live retained ban on it: the account that first used this
   -- card / bank and was banned, not a later account banned only for it.
   ORDER BY (rb.expires_at IS NULL) DESC, rb.retained_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  -- A spent suspension is retired on sight, as on every other key.
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  -- Apply the retained judgment, exactly as enforce_retained_ban does, unless
  -- the account is already banned (never soften or re-date an existing ban).
  --
  -- user_bans BEFORE the profile write: the profile write fires
  -- trg_retain_ban_on_ban, whose retain_ban_for_user reads the newest active
  -- user_bans row for the reason this account's own retained row will carry.
  IF NOT v_already THEN
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

    -- The reason the person sees on /account-banned (and in their data
    -- export) is about THEM, never the other account's ban reason: a shared
    -- card or bank account may belong to someone else entirely.
    -- 'banned' with no end date while the review is open (authz review,
    -- 2026-10-05): a temporary judgment must not expire and lift the account
    -- (sweep_expired_auto_bans) before an admin has decided. The retained
    -- judgment itself is kept on the review and applied by the confirm.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           'banned',
           v_own_reason,
           p_user_id,
           NULL,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_own_reason
     );

    PERFORM set_config('app.retained_ban_reapply', 'off', true);

    INSERT INTO public.ban_settlement_queue (user_id, matched_on, original_ban_status, original_expires_at)
    VALUES (p_user_id, p_kind, v_row.ban_status, v_row.expires_at)
    ON CONFLICT (user_id) WHERE review_state = 'open' DO NOTHING;

    -- BAN NOW, ADMIN SETTLES (owner 2026-10-05): the profile write below fires
    -- the permanent-ban settlement triggers; this transaction-local flag makes
    -- them leave the jobs to the review instead of cancelling them.
    PERFORM set_config('app.ban_settlement_review', 'on', true);
    UPDATE public.profiles
       SET ban_status           = 'banned',
           auto_suspended_until = NULL
     WHERE user_id = p_user_id;
    PERFORM set_config('app.ban_settlement_review', 'off', true);

    -- Every admin hears of it now (the hourly ban-review-watch pages again
    -- once it has waited 24 hours).
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ban settlement review: an account was banned automatically',
             'It matched a banned account''s ' || p_kind || '. Its jobs and escrow are frozen until you confirm or lift the ban in the fraud console.',
             'admin_alert',
             '/admin?view=fraud'
        FROM public.user_roles ur
       WHERE ur.role = 'admin';
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Ban settlement review opened: account %s banned automatically on a %s match. Its jobs and escrow are frozen until an admin confirms or lifts it (docs/OPEN.md Q1324).', p_user_id, p_kind),
              jsonb_build_object('source', 'ban-settlement-review-opened', 'area', 'money'),
              jsonb_build_object('user_id', p_user_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_retained_payment_ban: review alert failed for %: %', p_user_id, SQLERRM;
    END;

    -- "Can't get paid": a payout hold stops every transfer to the account
    -- (Q764) and freezes its Stripe automatic payouts (Q1221). A hold an
    -- admin already placed is left as it is.
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (p_user_id,
            'Q1324: banned automatically (a banned account''s ' || p_kind || ' matched). Ban settlement review open.',
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
  END IF;

  -- The other account's ban details, for admins only (never exported).
  INSERT INTO public.ban_evasion_matches (
    user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
    original_recorded_at, original_expires_at, auto_banned
  )
  VALUES (p_user_id, p_kind, v_h, v_row.id, v_row.ban_status, v_row.reason,
          v_row.retained_at, v_row.expires_at, NOT v_already)
  ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;

  -- The fraud console notice. It holds nothing about the OTHER account: this
  -- row is exported to the person it is about (export_my_data).
  BEGIN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    SELECT
      p_user_id,
      'ban_evasion_attempt',
      format(
        'Payment method blocked: this account''s %s matched one retained from a banned account. %s '
        || 'Account email: %s.',
        p_kind,
        CASE WHEN v_already THEN 'It was already banned; its ban was left as it was.'
             ELSE 'It was banned automatically; its jobs wait for an admin decision.' END,
        COALESCE(v_email, '(unknown)')
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fraud_flags f
       WHERE f.user_id = p_user_id
         AND f.flag_type = 'ban_evasion_attempt'
         AND NOT f.resolved
         AND f.details LIKE 'Payment method blocked: this account''s ' || p_kind || ' matched%'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_retained_payment_ban: fraud flag failed for %: %', p_user_id, SQLERRM;
  END;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',         true,
    'matched_on',     p_kind,
    'already_banned', v_already,
    'ban_status',     v_row.ban_status,
    'expires_at',     v_row.expires_at,
    'retained_id',    v_row.id
  );
END;
$$;

COMMENT ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) IS
  'Q1324: records a card/bank Stripe fingerprint (salted) for the account and, '
  'when a live retained ban holds the same one, bans the account at once, holds '
  'its payouts and queues its jobs for an admin (ban_settlement_queue) instead '
  'of settling them; the other account''s details go to ban_evasion_matches '
  '(admin-only). Called by stripe-webhook and stripe-connect with the service role only.';

REVOKE ALL ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 6. Name match: an admin-only record, never a ban ───────────────────────

CREATE OR REPLACE FUNCTION public.flag_possible_ban_evasion_by_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_h     text;
  v_own_h text;
  v_row   RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.full_name IS NOT DISTINCT FROM OLD.full_name THEN
    RETURN NULL;
  END IF;
  -- Already banned: there is nothing for an admin to doubt-check.
  IF COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned') THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_h := public.ban_fingerprint('name', public.normalize_name_for_ban(NEW.full_name));
    IF v_h IS NULL THEN
      RETURN NULL;
    END IF;
    v_own_h := CASE WHEN NEW.email IS NULL OR btrim(NEW.email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(NEW.email))::bytea), 'hex') END;

    SELECT * INTO v_row
      FROM public.retained_bans
     WHERE name_sha256 = v_h
       AND (expires_at IS NULL OR expires_at > now())
       AND email_sha256 IS DISTINCT FROM v_own_h
     ORDER BY retained_at DESC
     LIMIT 1;

    IF FOUND THEN
      -- Admin-only (ban_evasion_matches), and NOT a fraud_flags row: that
      -- table is exported to the person, and a row appearing after they typed
      -- a name would tell them the name belongs to a banned account.
      INSERT INTO public.ban_evasion_matches (
        user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
        original_recorded_at, original_expires_at, auto_banned
      )
      VALUES (NEW.user_id, 'name', v_h, v_row.id, v_row.ban_status, v_row.reason,
              v_row.retained_at, v_row.expires_at, false)
      ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never fail the signup or the profile edit over a soft signal, but never
    -- skip it silently either: ops reads error_logs.
    RAISE WARNING 'flag_possible_ban_evasion_by_name: check failed for %: %', NEW.user_id, SQLERRM;
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Q1324 name doubt-check did not run for account %s: %s', NEW.user_id, SQLERRM),
        jsonb_build_object('source', 'flag_possible_ban_evasion_by_name', 'origin', 'server'),
        jsonb_build_object('user_id', NEW.user_id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'flag_possible_ban_evasion_by_name: error_logs write failed too: %', SQLERRM;
    END;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.flag_possible_ban_evasion_by_name() IS
  'Q1324: a profile whose normalised full name matches a live retained ban gets '
  'one admin-only ban_evasion_matches row (matched_on name) for a doubt check. '
  'Soft signal: never bans, never raises, never writes anything the person can export.';

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.flag_possible_ban_evasion_by_name() FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_possible_ban_evasion_by_name ON public.profiles;
CREATE TRIGGER trg_flag_possible_ban_evasion_by_name
  AFTER INSERT OR UPDATE OF full_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_possible_ban_evasion_by_name();

-- ── 8. Ban now, admin settles ───────────────────────────────────────────────
--
-- The two permanent-ban settlement triggers keep their live bodies
-- (20260927012042 / 20260927012808) and skip only while
-- app.ban_settlement_review is 'on', which enforce_retained_payment_ban sets
-- around its own profile write and nothing else does. Every other ban (an
-- admin's, the strike ladder's, a retained email / phone / identity match)
-- settles exactly as before.

CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_on_permanent_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Q1324: a fingerprint-match ban waits for an admin (ban_settlement_queue).
  IF COALESCE(current_setting('app.ban_settlement_review', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  -- Belt and braces: whatever settling throws, the ban itself stands.
  BEGIN
    PERFORM public.settle_one_off_jobs_for_banned_account(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ban settlement failed for %: %', NEW.user_id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_series_on_permanent_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Q1324: a fingerprint-match ban waits for an admin (ban_settlement_queue).
  -- charge-recurring-visits already skips a banned poster's series, so no
  -- visit is charged while it waits.
  IF COALESCE(current_setting('app.ban_settlement_review', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM public.end_series_for_banned_account(NEW.user_id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_one_off_jobs_on_permanent_ban() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_series_on_permanent_ban() FROM PUBLIC, anon, authenticated;

-- Every open review, with every job the settlement would act on. The job
-- predicate is settle_one_off_jobs_for_banned_account's own (20261005171601),
-- so nothing the confirm will settle is invisible before it (guard:
-- src/test/banEvasionCardBankName.test.ts).
CREATE OR REPLACE FUNCTION public.admin_ban_settlement_reviews()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'review_id', r.id,
             'user_id', r.user_id,
             'email', p.email,
             'full_name', p.full_name,
             'ban_status', p.ban_status,
             'matched_on', r.matched_on,
             'original_ban_status', r.original_ban_status,
             'original_expires_at', r.original_expires_at,
             'created_at', r.created_at,
             'matches', COALESCE((
               SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
                 FROM public.ban_evasion_matches m
                WHERE m.user_id = r.user_id AND m.cleared_at IS NULL), '[]'::jsonb),
             'jobs', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', j.id, 'title', j.title, 'status', j.status::text,
                        'payment_status', j.payment_status,
                        'role', CASE WHEN j.customer_id = r.user_id THEN 'poster' ELSE 'helpr' END)
                        ORDER BY j.created_at)
                 FROM public.jobs j
                WHERE (
                        (j.customer_id = r.user_id OR j.helper_id = r.user_id
                         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                                     WHERE g.job_id = j.id AND g.helper_id = r.user_id))
                        AND j.status::text NOT IN ('completed', 'cancelled')
                      )
                   OR (j.helper_id = r.user_id
                       AND j.status::text IN ('completed', 'cancelled')
                       AND j.payment_status IN ('escrow', 'payout_pending'))
                   OR (j.is_group_job IS TRUE
                       AND j.status::text IN ('completed', 'cancelled')
                       AND j.payment_status IN ('escrow', 'payout_pending')
                       AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                                    WHERE g.job_id = j.id AND g.helper_id = r.user_id)
                       AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                                        WHERE pt.job_id = j.id AND pt.helper_id = r.user_id AND pt.status = 'paid'))), '[]'::jsonb)
           ) ORDER BY r.created_at)
      FROM public.ban_settlement_queue r
      LEFT JOIN public.profiles p ON p.user_id = r.user_id
     WHERE r.review_state = 'open'), '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_ban_settlement_reviews() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban_settlement_reviews() TO authenticated, service_role;

-- The admin confirms the ban: the normal settlement runs now, exactly as it
-- would have at ban time. The payout hold stays (a banned account cannot get
-- paid); an admin releases it from the payout queue if work is owed.
CREATE OR REPLACE FUNCTION public.admin_confirm_ban_settlement(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_review record;
  v_final  text;
  v_status text;
  v_out    jsonb := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  -- FOR UPDATE: a second confirm (or a lift) waits, then finds no open review.
  SELECT r.id, r.created_at, r.original_ban_status, r.original_expires_at INTO v_review
    FROM public.ban_settlement_queue r
   WHERE r.user_id = p_user_id AND r.review_state = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_open_review' USING ERRCODE = 'P0002';
  END IF;

  -- Closed first: the freeze, the browse hiding and the claim refusal all
  -- key on an OPEN review, and the settlement below must be able to act.
  UPDATE public.ban_settlement_queue
     SET review_state = 'confirmed', decided_at = now(), decided_by = v_uid
   WHERE id = v_review.id;

  -- The retained judgment the match carried, now applied. The settlement
  -- triggers are told to stand aside (they would price as of now); the
  -- settlement then runs explicitly, as of the moment of the ban.
  v_final := COALESCE(v_review.original_ban_status, 'permanently_banned');
  PERFORM set_config('app.ban_settlement_review', 'on', true);
  UPDATE public.profiles p
     SET ban_status           = v_final,
         auto_suspended_until = CASE WHEN v_final = 'temp_banned' THEN v_review.original_expires_at ELSE NULL END
   WHERE p.user_id = p_user_id
     AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned');
  PERFORM set_config('app.ban_settlement_review', 'off', true);
  UPDATE public.user_bans b
     SET ban_type = v_final,
         expires_at = CASE WHEN v_final = 'temp_banned' THEN v_review.original_expires_at ELSE NULL END
   WHERE b.user_id = p_user_id AND b.is_active AND b.banned_by = p_user_id;
  SELECT p.ban_status INTO v_status FROM public.profiles p WHERE p.user_id = p_user_id;

  -- A temporary judgment never settled jobs (the triggers fire only for
  -- these two), so confirming one changes no job.
  IF v_status IN ('banned', 'permanently_banned') THEN
    PERFORM set_config('app.ban_settlement_as_of', v_review.created_at::text, true);
    v_out := public.settle_one_off_jobs_for_banned_account(p_user_id);
    PERFORM public.end_series_for_banned_account(p_user_id);
    PERFORM set_config('app.ban_settlement_as_of', '', true);
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_uid, 'ban_settlement_confirmed', p_user_id::text, 'user',
          jsonb_build_object('ban_status', v_status, 'as_of', v_review.created_at, 'settlement', v_out));
  RETURN jsonb_build_object('confirmed', true, 'ban_status', v_status, 'settlement', v_out);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_confirm_ban_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_ban_settlement(uuid) TO authenticated, service_role;

-- An admin marks a name match checked. The table takes no client write; this
-- records who checked it.
CREATE OR REPLACE FUNCTION public.admin_resolve_ban_evasion_match(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_user uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ban_evasion_matches m SET resolved = true
   WHERE m.id = p_match_id AND NOT m.resolved
  RETURNING m.user_id INTO v_user;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_uid, 'ban_evasion_match_checked', v_user::text, 'user', jsonb_build_object('match_id', p_match_id));
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_resolve_ban_evasion_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_ban_evasion_match(uuid) TO authenticated, service_role;

-- An ADMIN lifts the ban (authz review 2026-10-05: only an attributable admin
-- unban may close a review and clear a match; an expiry never does). Called
-- by admin-user-actions set_ban_status, with the admin it already verified,
-- for any move out of a ban. Works on an OPEN review and on a CONFIRMED one
-- (money review: a lift after a confirm must release the hold and clear the
-- match too). One transaction: the review closes as lifted, the card / bank
-- matches are cleared (the same payment method does not ban this account
-- again), the hold this path placed is released (its Stripe schedule comes
-- back, Q1221), and the account is unbanned. Jobs were never touched by an
-- open review, so they resume as they were.
CREATE OR REPLACE FUNCTION public.lift_ban_settlement_review(p_user_id uuid, p_admin_id uuid, p_ban_status text DEFAULT 'active')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_review record;
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_ban_status IS NULL OR p_ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    RAISE EXCEPTION 'lift_needs_an_unbanned_status' USING ERRCODE = '22023';
  END IF;

  SELECT r.id, r.review_state INTO v_review
    FROM public.ban_settlement_queue r
   WHERE r.user_id = p_user_id AND r.review_state IN ('open', 'confirmed')
   ORDER BY r.created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('lifted', false);
  END IF;

  UPDATE public.ban_settlement_queue
     SET review_state = 'lifted', decided_at = now(), decided_by = p_admin_id
   WHERE id = v_review.id;
  UPDATE public.ban_evasion_matches
     SET cleared_at = now(), resolved = true
   WHERE user_id = p_user_id AND matched_on IN ('card', 'bank') AND cleared_at IS NULL;
  -- A system hold an admin explicitly refused to release stays for that
  -- admin's decision (lh-money-escrow F3, 2026-10-06).
  DELETE FROM public.payout_holds h
   WHERE h.helper_id = p_user_id AND h.held_by IS NULL AND h.denied_by IS NULL
     AND h.reason LIKE 'Q1324: %';

  PERFORM set_config('app.ban_review_lift', 'on', true);
  UPDATE public.profiles
     SET ban_status = p_ban_status, auto_suspended_until = NULL
   WHERE user_id = p_user_id;
  PERFORM set_config('app.ban_review_lift', 'off', true);

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (p_admin_id, 'ban_settlement_lifted', p_user_id::text, 'user',
          jsonb_build_object('review_state_was', v_review.review_state, 'ban_status', p_ban_status));
  RETURN jsonb_build_object('lifted', true, 'review_state_was', v_review.review_state);
END;
$fn$;

REVOKE ALL ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lift_ban_settlement_review(uuid, uuid, text) TO service_role;

-- Nothing else may move an account out of a ban while its review is open: no
-- expiry (there is none to run), no stray SQL, no other admin tool.
CREATE OR REPLACE FUNCTION public.refuse_unban_during_ban_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF COALESCE(OLD.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     AND COALESCE(NEW.ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
     AND COALESCE(current_setting('app.ban_review_lift', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.ban_settlement_queue r
                  WHERE r.user_id = NEW.user_id AND r.review_state = 'open') THEN
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = '42501',
            HINT = 'This account is under a ban settlement review. Confirm or lift it in the fraud console.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refuse_unban_during_ban_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_close_ban_settlement_review_on_unban ON public.profiles;
DROP FUNCTION IF EXISTS public.close_ban_settlement_review_on_unban();
DROP TRIGGER IF EXISTS trg_refuse_unban_during_ban_review ON public.profiles;
CREATE TRIGGER trg_refuse_unban_during_ban_review
  BEFORE UPDATE OF ban_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_unban_during_ban_review();

-- ── 7. Backfill: the name key of bans that are live right now ──────────────
--
-- payment_fingerprints is new and empty, so cards and banks start from the next
-- payment / payout-account read. Names exist now: give every retained ban whose
-- banned account still exists its name key (1 row on prod, measured
-- 2026-10-05: 36 retained_bans, 1 with a live banned profile). A targeted
-- UPDATE rather than re-running retain_ban_for_user, which would reset
-- retained_at, the date admins read as "when the ban was recorded". No
-- exception handler: a missing Vault salt must fail this deploy loudly, not
-- write unsalted keys or skip them in silence.
UPDATE public.retained_bans rb
   SET name_sha256 = public.ban_fingerprint('name', public.normalize_name_for_ban(p.full_name))
  FROM public.profiles p
 WHERE rb.name_sha256 IS NULL
   AND p.email IS NOT NULL
   AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
   AND rb.email_sha256 = encode(sha256(lower(btrim(p.email))::bytea), 'hex')
   AND public.normalize_name_for_ban(p.full_name) IS NOT NULL;
