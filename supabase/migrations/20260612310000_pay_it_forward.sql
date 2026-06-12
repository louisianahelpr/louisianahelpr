-- ============================================================
-- TASK A: Pay It Forward credits
-- ============================================================
CREATE TABLE IF NOT EXISTS pif_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id),     -- null until redeemed
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN (
    'available', 'reserved', 'redeemed', 'expired'
  )),
  message text,                    -- personal note from donor
  category text,                   -- optional: "for yard work or cleaning"
  parish text,
  job_id uuid REFERENCES jobs(id), -- the job it was used on
  expires_at timestamptz DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);

ALTER TABLE pif_credits ENABLE ROW LEVEL SECURITY;

-- Anyone can see available credits (to know they exist and can be redeemed)
CREATE POLICY "Available credits are public" ON pif_credits
  FOR SELECT USING (status = 'available' OR auth.uid() = donor_id OR auth.uid() = recipient_id);

CREATE POLICY "Donors create credits" ON pif_credits
  FOR INSERT WITH CHECK (auth.uid() = donor_id);

-- Authenticated users can update credits they are redeeming (set recipient/status)
-- or donors can update their own credits (e.g. cancel before redemption)
CREATE POLICY "Redeem or donor update" ON pif_credits
  FOR UPDATE USING (
    auth.uid() = donor_id OR
    (status = 'available' AND recipient_id IS NULL)
  );

-- ============================================================
-- TASK B: Helper reliability stakes
-- ============================================================
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS stake_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS stake_status text DEFAULT 'none'
    CHECK (stake_status IN ('none', 'staked', 'returned', 'forfeited'));
