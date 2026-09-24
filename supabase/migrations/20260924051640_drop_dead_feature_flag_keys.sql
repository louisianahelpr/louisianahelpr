-- S-006: four kill-switch keys sat in platform_settings.feature_flags reading
-- false while nothing reads them (no src/, edge function or pg_proc body names
-- them, measured 2026-09-24). Anyone reading prod config to answer "are
-- subscriptions on?" got false while subscriptions are sellable. Remove them.
-- Idempotent: `-` on an absent key is a no-op.
UPDATE public.platform_settings
SET feature_flags = feature_flags - ARRAY['boosts_enabled', 'referrals_enabled', 'subscriptions_enabled', 'ai_helpr_assistant']
WHERE feature_flags ?| ARRAY['boosts_enabled', 'referrals_enabled', 'subscriptions_enabled', 'ai_helpr_assistant'];
