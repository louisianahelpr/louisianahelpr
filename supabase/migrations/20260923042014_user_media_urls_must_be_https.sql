-- User-writable media URLs must be https (or a raster data: image) — never
-- `javascript:`, `vbscript:`, `data:text/html`, `http:`.
--
-- WHY. profiles.avatar_url, profiles.portfolio_urls and jobs.photos are
-- writable by their owner (column UPDATE granted to authenticated; RLS
-- `auth.uid() = user_id` / `= customer_id`; no CHECK, no validating trigger —
-- measured live 2026-09-23 via information_schema.column_privileges,
-- pg_policies and pg_trigger). The client rendered each of them as a raw
-- `<a href>`: portfolio_urls on every PUBLIC profile ("Recent work"),
-- jobs.photos on other users' Applied cards and the admin job dialog,
-- avatar_url / portfolio_urls on admin → People. React 18 renders a
-- `javascript:` href and the CSP allows 'unsafe-inline', so one PATCH to your
-- own row was stored XSS on whoever clicked. The client now routes every one of
-- those hrefs through safeDocumentUrl() (src/lib/storagePath.ts); this is the
-- server-side twin of that predicate, so a bad value cannot be stored at all.
--
-- The predicate is safeDocumentUrl's — `^https://\S+$`, or a raster
-- `data:image/(png|jpeg|gif|webp);base64,…` (52 seed profiles carry a 1x1 PNG
-- avatar; e2e fixtures write the same) — plus the bare Storage-path shape,
-- because supabase/functions/complete-signup writes portfolio uploads to
-- portfolio_urls as `<uid>/<file>` paths (the client never links a path: it
-- fails safeDocumentUrl and renders unlinked). Live counts before this migration
-- (2026-09-23): avatar_url 58 rows = 7 https + 51 raster data: (0 other);
-- portfolio_urls 0 elements; jobs.photos 61 elements, all https. So every
-- existing row passes.
--
-- Deploy safety: each constraint is added NOT VALID (enforced on every new
-- write immediately) and then VALIDATEd in its own sub-block; a row that fails
-- validation is reported as a WARNING instead of failing the deploy, and the
-- constraint still guards every future write.
--
-- Replay-safe: CREATE OR REPLACE for the functions; each constraint is added
-- only if absent and only if its table/column exists.

CREATE OR REPLACE FUNCTION public.is_safe_media_url(v text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT v IS NULL
      OR v ~* '^https://\S+$'
      OR v ~* '^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$'
      -- A bare Storage object path (`<uid>/<ts>-<rand>.pdf`): complete-signup
      -- stores portfolio uploads this way. No scheme, no colon, no leading
      -- slash, no whitespace — it can only ever resolve relative to our own
      -- origin, never as a script URL.
      OR v ~ '^[A-Za-z0-9_-][^\s:?#\\]*$'
$$;

CREATE OR REPLACE FUNCTION public.are_safe_media_urls(vs text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT vs IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(vs) AS u(v)
        WHERE v IS NULL OR NOT public.is_safe_media_url(v)
      )
$$;

-- Pure predicates, no data access. EXECUTE stays with the roles that write
-- these tables (a CHECK runs its function as the writing role).
REVOKE ALL ON FUNCTION public.is_safe_media_url(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.are_safe_media_urls(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_safe_media_url(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.are_safe_media_urls(text[]) TO authenticated, service_role;

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('profiles', 'avatar_url',     'profiles_avatar_url_safe',     'public.is_safe_media_url(avatar_url)'),
      ('profiles', 'portfolio_urls', 'profiles_portfolio_urls_safe', 'public.are_safe_media_urls(portfolio_urls)'),
      ('jobs',     'photos',         'jobs_photos_safe',             'public.are_safe_media_urls(photos)')
    ) AS t(tbl, col, con, expr)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col
       ) THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = spec.con AND conrelid = ('public.' || spec.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                     spec.tbl, spec.con, spec.expr);
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', spec.tbl, spec.con);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING '% has existing rows that fail %; new writes are still checked', spec.tbl, spec.con;
    END;
  END LOOP;
END
$$;
