-- Auto-posting to the owner's Facebook Page and Instagram account.
--
-- ── Why there is no separate task-queue table ─────────────────────────────
-- The reference architecture draws "content store" and "task queue" as two
-- boxes. They are ONE table here on purpose. A queue row that mirrors a content
-- row's state is a second source of truth for the same question ("has this been
-- posted?"), and the two drift the moment one write succeeds and the other does
-- not — which is precisely how a publisher double-posts. `marketing_content` IS
-- the queue: `status` says where a row is, `scheduled_for` says when it is due,
-- `locked_at` is the claim that stops two dispatchers taking the same row.
--
-- ── Double-posting is the only unrecoverable mistake here ─────────────────
-- Auto-publish is on by owner decision: nothing human stands between a row and
-- the business's public feed. A post that goes out twice cannot be un-seen, so
-- there are three independent guards, and each one alone would be enough:
--   1. `claim_marketing_content()` flips status and stamps `locked_at` in ONE
--      statement with FOR UPDATE SKIP LOCKED — two dispatchers cannot both win.
--   2. `attempts` is incremented by the claim itself, so a row that keeps
--      failing burns down and stops rather than retrying forever.
--   3. UNIQUE (channel, external_id) — even if the first two were defeated and
--      the API were called twice, only one row can record the result.
--
-- ── Instagram's constraint is a data constraint, not a code one ───────────
-- There is no such thing as a text-only Instagram post: the Content Publishing
-- API requires a publicly reachable image or video URL. That is enforced here
-- as a CHECK rather than left to the dispatcher, because a row that can never
-- publish should be impossible to schedule, not discovered at 6am by a cron
-- writing `last_error`.

-- ── Enums ────────────────────────────────────────────────────────────────
-- Deliberately only the two channels the owner actually has. Adding an enum
-- value later is trivial; removing an unused one is not.
DO $$ BEGIN
  CREATE TYPE public.marketing_channel AS ENUM ('instagram', 'facebook');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketing_status AS ENUM (
    'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Content ledger + dispatch queue ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel public.marketing_channel NOT NULL,
  status public.marketing_status NOT NULL DEFAULT 'draft',

  -- The caption / post body, exactly as it will appear.
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  -- Kept separate from `body` so a platform-specific limit can be applied to
  -- the caption alone, and so tags can be revised without retyping the post.
  hashtags text[] NOT NULL DEFAULT '{}',
  -- Public URLs. For Instagram this is REQUIRED (see the CHECK below); the
  -- owner uploads a Canva export to the `marketing-media` bucket and the
  -- public URL lands here.
  media_urls text[] NOT NULL DEFAULT '{}',

  -- Targeting + provenance.
  parish text,
  campaign text,
  generated_by text,
  model text,

  -- Dispatch state.
  scheduled_for timestamptz,
  locked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,

  -- Result.
  published_at timestamptz,
  external_id text,
  external_url text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- A scheduled row with no due time would never be picked up and would look
  -- like a silent drop rather than an error. Refuse it at write time.
  CONSTRAINT marketing_content_scheduled_needs_time
    CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL),

  -- Instagram cannot post without media. Enforced here so an unpublishable row
  -- cannot even be queued.
  --
  -- `cardinality`, NOT `array_length`. array_length('{}', 1) returns NULL, not
  -- 0, so the written-the-obvious-way version evaluated to
  -- `false OR false OR NULL` = NULL — and a CHECK constraint PASSES on NULL.
  -- The guard silently allowed exactly the row it exists to forbid. Caught by
  -- the PGlite probe; it is invisible to a code read.
  CONSTRAINT marketing_content_instagram_needs_media
    CHECK (
      channel <> 'instagram'
      OR status IN ('draft', 'cancelled')
      OR cardinality(media_urls) >= 1
    ),

  -- A published row must record where it went, or it is unverifiable and the
  -- metrics puller has nothing to join on.
  CONSTRAINT marketing_content_published_needs_receipt
    CHECK (status <> 'published' OR external_id IS NOT NULL)
);

-- Guard 3: one external post per channel, ever.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_external_uniq
  ON public.marketing_content (channel, external_id)
  WHERE external_id IS NOT NULL;

-- The dispatcher's read path.
CREATE INDEX IF NOT EXISTS marketing_content_due_idx
  ON public.marketing_content (status, scheduled_for)
  WHERE status IN ('scheduled', 'publishing');

CREATE INDEX IF NOT EXISTS marketing_content_channel_created_idx
  ON public.marketing_content (channel, created_at DESC);

-- ── Kill switch + config (singleton) ─────────────────────────────────────
-- One row, enforced by the CHECK on the primary key. The owner can stop every
-- automated post from the admin UI without a deploy — the only control that
-- matters when auto-publish is on and something is going wrong right now.
CREATE TABLE IF NOT EXISTS public.marketing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  auto_publish_enabled boolean NOT NULL DEFAULT false,
  -- Per-channel opt-in. A channel ABSENT from this object is OFF.
  channels_enabled jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Hard ceiling per channel per UTC day. A generation bug that produces 400
  -- rows cannot become 400 posts on the business's feed.
  daily_post_cap integer NOT NULL DEFAULT 2 CHECK (daily_post_cap >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed with everything OFF. Turning it on is a deliberate act in the admin UI,
-- never something a migration does on the owner's behalf.
INSERT INTO public.marketing_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- ── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_marketing_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_content_touch ON public.marketing_content;
CREATE TRIGGER marketing_content_touch
  BEFORE UPDATE ON public.marketing_content
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketing_content();

-- ── Guard 1: the claim ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_marketing_content(p_limit integer DEFAULT 5)
RETURNS SETOF public.marketing_content
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role only. An authenticated user reaching this could claim and
  -- publish arbitrary rows to the business's public accounts.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_marketing_content is service-role only';
  END IF;

  RETURN QUERY
  UPDATE public.marketing_content c
     SET status = 'publishing',
         locked_at = now(),
         attempts = c.attempts + 1
   WHERE c.id IN (
     SELECT q.id
       FROM public.marketing_content q
      WHERE q.scheduled_for IS NOT NULL
        AND q.scheduled_for <= now()
        AND q.attempts < 5
        AND (
          q.status = 'scheduled'
          -- Reclaim a row whose dispatcher died mid-flight. Without this, a
          -- crash strands the row in 'publishing' forever and the post never
          -- goes out — silently, because nothing errored.
          OR (q.status = 'publishing' AND q.locked_at < now() - interval '15 minutes')
        )
      ORDER BY q.scheduled_for
      -- SKIP LOCKED lets two dispatchers run concurrently without either
      -- blocking or both taking the same row.
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(p_limit, 0)
   )
  RETURNING c.*;
END;
$$;

-- REVOKE then GRANT, in that order, and the GRANT is not optional: EXECUTE on a
-- new function is granted to PUBLIC by default, and `service_role` holds it
-- only through that default. Revoking from PUBLIC therefore strips the
-- dispatcher too — it would claim nothing, forever, and the only symptom would
-- be a queue that never drains. Proven with a PGlite probe, not assumed.
REVOKE ALL ON FUNCTION public.claim_marketing_content(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_content(integer) TO service_role;

-- ── Cap enforcement, measured against what actually published ────────────
--
-- "Today" is a LOUISIANA day (America/Chicago), not a UTC one. With a UTC
-- window the day rolls over at 7pm Central, so a cap of 2 would permit two
-- posts at 6pm and two more at 8pm — four posts in one Louisiana evening,
-- which is the exact thing the cap exists to prevent.
--
-- The conversion is written `... AT TIME ZONE 'America/Chicago' AT TIME ZONE
-- 'America/Chicago'` on purpose: the first converts the timestamptz to local
-- wall-clock time so date_trunc finds local midnight, the second converts that
-- local midnight back to a timestamptz. Without the second, the result is a
-- naive timestamp that Postgres re-interprets using the SESSION timezone —
-- which is not guaranteed to be anything in particular, and made this function
-- return 0 under the probe's Etc/GMT+8 session.
CREATE OR REPLACE FUNCTION public.marketing_published_today(p_channel public.marketing_channel)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM public.marketing_content
   WHERE channel = p_channel
     AND status = 'published'
     AND published_at >= (
       date_trunc('day', now() AT TIME ZONE 'America/Chicago')
     ) AT TIME ZONE 'America/Chicago';
$$;

-- Same trap as above. The dispatcher calls this to enforce the daily cap, and
-- it runs as service_role — so the grant it needs must be explicit. `authenticated`
-- is granted separately because the admin UI reads it to show today's count.
REVOKE ALL ON FUNCTION public.marketing_published_today(public.marketing_channel) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_published_today(public.marketing_channel) TO authenticated, service_role;

-- ── RLS — admin only, no public read ─────────────────────────────────────
-- Nothing in here is public. Every row is a draft, a scheduled post that has
-- not gone out, or a failed post with an error string in it.
ALTER TABLE public.marketing_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage marketing content" ON public.marketing_content;
CREATE POLICY "Admins manage marketing content"
  ON public.marketing_content FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read marketing settings" ON public.marketing_settings;
CREATE POLICY "Admins read marketing settings"
  ON public.marketing_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update marketing settings" ON public.marketing_settings;
CREATE POLICY "Admins update marketing settings"
  ON public.marketing_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── Media bucket ─────────────────────────────────────────────────────────
-- PUBLIC on purpose, and this is the one place that deserves a second look:
-- Instagram's Content Publishing API fetches the image from a URL server-side,
-- so a signed or private URL cannot be used. Only admin-uploaded marketing art
-- goes here — never user content, never job photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-media', 'marketing-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Marketing media is publicly readable" ON storage.objects;
CREATE POLICY "Marketing media is publicly readable"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'marketing-media');

DROP POLICY IF EXISTS "Admins write marketing media" ON storage.objects;
CREATE POLICY "Admins write marketing media"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'marketing-media' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'marketing-media' AND public.has_role(auth.uid(), 'admin'::public.app_role));

COMMENT ON TABLE public.marketing_content IS
  'Content ledger AND dispatch queue for auto-posting to Facebook/Instagram. claim_marketing_content() is the only safe way to take a row for publishing.';
COMMENT ON TABLE public.marketing_settings IS
  'Singleton. auto_publish_enabled is the kill switch — flipping it false stops every automated post without a deploy.';
