-- Q1415 (f1) (lh-authz-rls re-review of f2644839e): ban_review_retained_floor counted an older match as "applied
-- during this review" when its retained_bans row's reapplied_at was stamped since the review opened. enforce_retained_ban
-- and enforce_retained_payment_ban stamp reapplied_at for ANY account that matches the row, so a pardoned match whose
-- retained row survived the unban (retained_via 'deletion') hardened this member's confirm or lift whenever someone ELSE
-- re-applied that row.
--
-- Fix: the match row carries its own stamp. ban_evasion_matches.auto_banned_at is set by a BEFORE trigger whenever a row
-- is inserted as a ban or flips auto_banned false -> true (enforce_retained_ban's ON CONFLICT ... DO UPDATE SET
-- auto_banned = true is the flip; every writer is covered without restating them). The floor reads
-- COALESCE(auto_banned_at, created_at) and drops the reapplied_at branch. No backfill: rows from before this read
-- created_at, as the floor's first branch always did (prod 11-03: 0 open ban reviews, 1 auto-banned match of 54).
--
-- ban_review_retained_floor restated verbatim from 20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql
-- (prod prosrc md5 b535583ba2415ebd4863efeb3ecf6d43, 2026-11-03); only the "applied during this review" clause changes.
-- Replay-safe. Proof: src/test/pglite/banReviewFloorReadsTheMatchStamp.pglite.mjs.

ALTER TABLE public.ban_evasion_matches ADD COLUMN IF NOT EXISTS auto_banned_at timestamptz;
COMMENT ON COLUMN public.ban_evasion_matches.auto_banned_at IS
  'Q1415 (f1): when this match became a ban (inserted auto_banned, or flipped from a doubt-check). Set by trg_stamp_ban_evasion_match_auto_banned; NULL on rows from before 2026-11-03 (read created_at).';

CREATE OR REPLACE FUNCTION public.stamp_ban_evasion_match_auto_banned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.auto_banned AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.auto_banned, false)) THEN
    NEW.auto_banned_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only the flip writes it; nothing else moves it.
    NEW.auto_banned_at := OLD.auto_banned_at;
  ELSE
    NEW.auto_banned_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.stamp_ban_evasion_match_auto_banned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_ban_evasion_match_auto_banned ON public.ban_evasion_matches;
CREATE TRIGGER trg_stamp_ban_evasion_match_auto_banned
  BEFORE INSERT OR UPDATE ON public.ban_evasion_matches
  FOR EACH ROW EXECUTE FUNCTION public.stamp_ban_evasion_match_auto_banned();

CREATE OR REPLACE FUNCTION public.ban_review_retained_floor(p_user_id uuid, p_since timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_m      record;
  v_status text := NULL;
  v_until  timestamptz := NULL;
BEGIN
  FOR v_m IN
    SELECT m.original_ban_status AS st, m.original_expires_at AS ex
      FROM public.ban_evasion_matches m
      JOIN public.retained_bans rb ON rb.id = m.retained_ban_id
     WHERE m.user_id = p_user_id
       AND m.auto_banned
       AND m.cleared_at IS NULL
       AND m.original_ban_status IN ('temp_banned', 'banned', 'permanently_banned')
       -- A live judgment: its retained row still exists and has not expired
       -- (an unban releases it; a match row outlives its retained row).
       AND (rb.expires_at IS NULL OR rb.expires_at > now())
       -- Applied during this review: THIS match became a ban since it opened
       -- (auto_banned_at, stamped on the match row by
       -- trg_stamp_ban_evasion_match_auto_banned; rows from before that column
       -- count from created_at). Q1415 (f1): never the retained row's
       -- reapplied_at, which any account matching that row stamps.
       AND COALESCE(m.auto_banned_at, m.created_at) >= p_since
       -- A suspension already over is spent.
       AND NOT (m.original_ban_status = 'temp_banned' AND m.original_expires_at IS NOT NULL AND m.original_expires_at <= now())
  LOOP
    IF v_status IS NULL OR public.ban_standing_rank(v_m.st) > public.ban_standing_rank(v_status) THEN
      v_status := v_m.st;
      v_until := v_m.ex;
    ELSIF v_status = 'temp_banned' AND v_m.st = 'temp_banned' AND v_until IS NOT NULL
          AND (v_m.ex IS NULL OR v_m.ex > v_until) THEN
      -- Between two suspensions the later end; one with no end outlasts any.
      v_until := v_m.ex;
    END IF;
  END LOOP;
  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('ban_status', v_status,
                            'suspended_until', CASE WHEN v_status = 'temp_banned' THEN v_until ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.ban_review_retained_floor(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ban_review_retained_floor(uuid, timestamptz) TO service_role;
