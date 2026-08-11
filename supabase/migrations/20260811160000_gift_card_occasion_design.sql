-- Gift cards: remember the occasion and the card design the sender chose.
--
-- The gift form was three fields — email, amount, note — so sending one felt
-- like a bank transfer. Occasions give the gift a reason and designs give the
-- recipient something to open. Both are chosen by the sender, so both have to
-- survive to the moment the recipient sees the card.
--
-- Deliberately plain `text`, not enums. These are presentation values owned by
-- the client catalogue (src/pages/payItForward/giftCardDesigns.ts); a new
-- design should be a front-end deploy, not a migration plus an enum ALTER.
-- The client resolves an unknown id back to the default design rather than
-- failing, so retiring one can never break an already-sent card.
--
-- Both nullable with no default: every gift sent before this migration
-- legitimately has no occasion, and back-filling one would invent intent the
-- sender never expressed.

ALTER TABLE public.pif_credits
  ADD COLUMN IF NOT EXISTS occasion  text,
  ADD COLUMN IF NOT EXISTS design_id text;

-- Bounded so neither column can be used as free storage by a crafted client
-- call. Long enough for any id the catalogue will realistically mint.
-- NOT VALID: validating would scan the whole table for rows that are all NULL
-- anyway, and the constraint still applies to every new and updated row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pif_credits_occasion_len' AND conrelid = 'public.pif_credits'::regclass
  ) THEN
    ALTER TABLE public.pif_credits
      ADD CONSTRAINT pif_credits_occasion_len
      CHECK (occasion IS NULL OR length(occasion) <= 48) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pif_credits_design_len' AND conrelid = 'public.pif_credits'::regclass
  ) THEN
    ALTER TABLE public.pif_credits
      ADD CONSTRAINT pif_credits_design_len
      CHECK (design_id IS NULL OR length(design_id) <= 48) NOT VALID;
  END IF;
END
$$;
