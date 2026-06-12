-- subscription_waitlist: captures pre-launch interest for paid tiers before
-- Stripe billing is fully wired. One row per (user, desired_tier) pair so
-- duplicate taps are silently ignored via the UNIQUE constraint.

CREATE TABLE IF NOT EXISTS subscription_waitlist (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  desired_tier text       NOT NULL CHECK (desired_tier IN ('pro', 'elite', 'business')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, desired_tier)
);

ALTER TABLE subscription_waitlist ENABLE ROW LEVEL SECURITY;

-- Users can manage only their own waitlist rows.
CREATE POLICY "Users manage own waitlist"
  ON subscription_waitlist
  FOR ALL
  USING (auth.uid() = user_id);
