-- F260q (owner 11-11 "Spanish EVERYTHING now"; lead 11-11: save the member's language server-side).
--
-- The member's language lived only on the device (safeStorage "helpr_lang", src/lib/i18n/language.ts), so nothing
-- the server writes (emails, texts, the OS push banner) could follow it. profiles.language holds it:
--   * 'en' or 'es' only (CHECK), NOT NULL, default 'en' (every existing row reads English, as today).
--   * The member writes their OWN row only: a column-level GRANT UPDATE (language) to authenticated, under the existing
--     row policy "Users can update their own safe fields" (auth.uid() = user_id). anon holds nothing on it.
--   * The client writes it when a signed-in member picks a language (src/lib/i18n/saveLanguage.ts).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; the CHECK added only when absent; GRANT is idempotent.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_language_check'
                   AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check CHECK (language IN ('en', 'es'));
  END IF;
END
$$;

COMMENT ON COLUMN public.profiles.language IS
  'F260q: the member''s app language (en | es), written by the member (column grant) when they pick one; server-written emails and push titles may read it.';

GRANT UPDATE (language) ON public.profiles TO authenticated;
