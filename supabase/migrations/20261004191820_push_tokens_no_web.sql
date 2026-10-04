-- Q1252 (docs/OPEN.md): a 'web' push_tokens row was allowed by the CHECK,
-- user-insertable, and skipped by send-push-notification without being counted.
--
-- Read 2026-10-04: push_tokens_platform_check admits ios, android, web
-- (20260422213631); live rows: 1, platform ios, 0 web. The app registers only
-- 'ios' / 'android' (src/lib/nativePush.ts persistPushToken's platform type);
-- there is no web push sender anywhere (send-push-notification sends APNs
-- only). So a web row is a registration nothing can ever deliver to.
--
-- Fix, both ends:
--   1. The CHECK drops 'web', so the row cannot be written.
--   2. send-push-notification counts any platform it has no sender for under
--      result.other (same commit), so a skip is never silent again.
--
-- Replay-safe: the constraint is dropped and re-added by name. It is added NOT
-- VALID and validated only when no other-platform row exists, so a stray row on
-- a replayed database cannot fail the deploy (it is reported instead); new rows
-- are checked either way.
ALTER TABLE public.push_tokens DROP CONSTRAINT IF EXISTS push_tokens_platform_check;
ALTER TABLE public.push_tokens
  ADD CONSTRAINT push_tokens_platform_check CHECK (platform = ANY (ARRAY['ios'::text, 'android'::text])) NOT VALID;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_tokens WHERE platform NOT IN ('ios', 'android')) THEN
    RAISE NOTICE 'push_tokens: % row(s) on a platform with no sender left unvalidated',
      (SELECT count(*) FROM public.push_tokens WHERE platform NOT IN ('ios', 'android'));
  ELSE
    ALTER TABLE public.push_tokens VALIDATE CONSTRAINT push_tokens_platform_check;
  END IF;
END $$;
