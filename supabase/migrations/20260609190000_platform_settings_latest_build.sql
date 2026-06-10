-- Soft update prompt: a non-blocking "a newer version is available" nudge
-- (src/hooks/useSoftUpdatePrompt.ts), distinct from the hard force-update
-- gate driven by min_supported_build. When latest_build exceeds the
-- installed build, the app shows a dismissible toast linking to the store.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS. The client reads it via the same
-- platform_settings select as min_supported_build and falls back silently
-- (treats as "no update") if the column/migration isn't deployed yet.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS latest_build INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_settings.latest_build IS
  'Newest CFBundleVersion / Android versionCode available in the stores. The soft update prompt (src/hooks/useSoftUpdatePrompt.ts) nudges users whose installed build is lower; 0 disables the nudge. Distinct from min_supported_build, which hard-blocks.';
