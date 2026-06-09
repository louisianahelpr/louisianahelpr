-- Snooze support for thread mutes — adds a TTL column so a "mute" can
-- automatically expire after 1h / 8h / "until tomorrow 8am" instead of
-- only being a binary forever-toggle.
--
-- The old toggle (forever-only) was added in
-- 20260609100000_thread_mute.sql. This migration:
--   • Adds a nullable `mute_until` timestamptz column (NULL = "muted
--     forever", a future time = "muted until then").
--   • Updates the helpers (`is_thread_muted`, `get_muted_threads`,
--     `toggle_thread_mute`) to treat an expired snooze as un-muted.
--   • Adds a new `set_thread_snooze` RPC that mutes until a caller-
--     supplied future time. Returns the resolved `mute_until` so the
--     UI can render "Muted for 8h" without a follow-up read.
--   • Adds a tiny helper RPC `clear_thread_mute` so the unmute path
--     (whether toggled off or expired) is explicit.
--
-- Replay-safe: nothing here depends on objects defined in later
-- migrations, ALTER uses IF NOT EXISTS, and every function is
-- CREATE OR REPLACE. The CI grant-guard requires explicit GRANT
-- EXECUTE on every public function, so all four are re-granted.

-- ── 1. The column ──────────────────────────────────────────────────
ALTER TABLE public.thread_mutes
  ADD COLUMN IF NOT EXISTS mute_until timestamptz NULL;

-- Partial index — only keeps rows where the snooze is bounded so a
-- future "expire-and-clean" cron can scan the small subset cheaply.
CREATE INDEX IF NOT EXISTS thread_mutes_mute_until_idx
  ON public.thread_mutes (mute_until)
  WHERE mute_until IS NOT NULL;

-- ── 2. is_thread_muted — treats expired snooze as un-muted ─────────
CREATE OR REPLACE FUNCTION public.is_thread_muted(
  _user uuid,
  _job_id uuid,
  _other_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_mutes
    WHERE user_id = _user
      AND job_id = _job_id
      AND other_user_id = _other_user_id
      AND (mute_until IS NULL OR mute_until > now())
  );
$$;

-- ── 3. get_muted_threads — filter expired snoozes from the result ──
-- The prior migration declared a 2-column return shape; we now add a
-- third column (`mute_until`). Postgres can't change a function's
-- return-table shape via CREATE OR REPLACE, so drop first then re-
-- create. Replay-safe: the partial drop's prior privileges are re-
-- granted at the bottom of this file.
DROP FUNCTION IF EXISTS public.get_muted_threads(jsonb);
CREATE OR REPLACE FUNCTION public.get_muted_threads(_pairs jsonb)
RETURNS TABLE(job_id uuid, other_user_id uuid, mute_until timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.job_id, tm.other_user_id, tm.mute_until
  FROM public.thread_mutes tm
  JOIN jsonb_to_recordset(_pairs)
    AS p(job_id uuid, other_user_id uuid)
    ON p.job_id = tm.job_id AND p.other_user_id = tm.other_user_id
  WHERE tm.user_id = auth.uid()
    AND (tm.mute_until IS NULL OR tm.mute_until > now());
$$;

-- ── 4. toggle_thread_mute — backward compatible (forever-mute) ─────
-- Existing callers (older client builds) hit this without a duration.
-- A toggle from on → off clears any snooze too; a toggle from off → on
-- mutes forever (NULL mute_until). Returns the new muted bool.
CREATE OR REPLACE FUNCTION public.toggle_thread_mute(
  _job_id uuid,
  _other_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _deleted int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Treat expired snoozes as un-muted: clean them up here so the
  -- toggle's semantics stay consistent ("muted" means an unexpired
  -- row exists).
  DELETE FROM public.thread_mutes
  WHERE user_id = _uid
    AND job_id = _job_id
    AND other_user_id = _other_user_id
    AND (mute_until IS NULL OR mute_until > now());
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  IF _deleted > 0 THEN
    RETURN false;  -- was muted, now unmuted
  END IF;

  INSERT INTO public.thread_mutes (user_id, job_id, other_user_id, mute_until)
  VALUES (_uid, _job_id, _other_user_id, NULL)
  ON CONFLICT (user_id, job_id, other_user_id)
    DO UPDATE SET mute_until = NULL, muted_at = now();

  RETURN true;
END;
$$;

-- ── 5. set_thread_snooze — mute until a specific future timestamp ──
-- `NULL` _until means "mute forever" (same as toggle's forever path).
-- A past timestamp clears any existing mute and returns false.
-- Returns the resolved muted bool. The companion RPC below returns the
-- timestamp itself for callers that need to render "Muted for 8h".
CREATE OR REPLACE FUNCTION public.set_thread_snooze(
  _job_id uuid,
  _other_user_id uuid,
  _until timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Past timestamp → treat as an explicit unmute.
  IF _until IS NOT NULL AND _until <= now() THEN
    DELETE FROM public.thread_mutes
    WHERE user_id = _uid
      AND job_id = _job_id
      AND other_user_id = _other_user_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.thread_mutes (user_id, job_id, other_user_id, mute_until, muted_at)
  VALUES (_uid, _job_id, _other_user_id, _until, now())
  ON CONFLICT (user_id, job_id, other_user_id)
    DO UPDATE SET mute_until = EXCLUDED.mute_until, muted_at = now();

  RETURN _until;  -- NULL means forever, future ts means snoozed.
END;
$$;

-- ── 6. clear_thread_mute — explicit unmute (always returns false) ──
CREATE OR REPLACE FUNCTION public.clear_thread_mute(
  _job_id uuid,
  _other_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.thread_mutes
  WHERE user_id = _uid
    AND job_id = _job_id
    AND other_user_id = _other_user_id;

  RETURN false;
END;
$$;

-- ── 7. Explicit grants — required by CI grant-guard (PR #413) ──────
-- (is_thread_muted and toggle_thread_mute were granted in the prior
-- migration; CREATE OR REPLACE preserves prior privileges, but a
-- changed return shape on get_muted_threads drops the row, so re-grant
-- everything here defensively.)
REVOKE ALL ON FUNCTION public.is_thread_muted(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_thread_muted(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_muted_threads(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_muted_threads(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_thread_mute(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_thread_mute(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_thread_snooze(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_thread_snooze(uuid, uuid, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_thread_mute(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_thread_mute(uuid, uuid) TO authenticated;
