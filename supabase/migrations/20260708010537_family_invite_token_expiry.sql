-- Family invite tokens (care_relationships.invite_token) previously had NO
-- expiry — a token leaked into a chat log, an email archive, or a screenshot
-- could be redeemed months or years later. Add a 14-day TTL, backfill
-- existing rows, and let FamilyAcceptPage reject an expired token with a
-- clear "ask for a new invite" message instead of silently accepting.

ALTER TABLE public.care_relationships
  ADD COLUMN IF NOT EXISTS invite_token_expires_at timestamptz;

-- Backfill: any existing PENDING invite gets a 14-day window from its
-- creation time. Rows that are already active/revoked can keep NULL — the
-- expiry only gates the pending → active transition.
UPDATE public.care_relationships
  SET invite_token_expires_at = created_at + interval '14 days'
  WHERE invite_token_expires_at IS NULL
    AND status = 'pending';

-- New rows default to 14 days from creation; the app can still override at
-- insert time if the product ever wants shorter one-time links.
ALTER TABLE public.care_relationships
  ALTER COLUMN invite_token_expires_at SET DEFAULT (now() + interval '14 days');
