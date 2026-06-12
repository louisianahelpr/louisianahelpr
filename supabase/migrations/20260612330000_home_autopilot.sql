-- Home maintenance reminders
-- Auto-created after a poster's job is marked completed; surfaces on Dashboard
-- when a category is due again (e.g. cleaning every 6 weeks).
CREATE TABLE IF NOT EXISTS home_maintenance_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  last_job_id uuid REFERENCES jobs(id),
  last_completed_date date,
  reminder_interval_days integer NOT NULL DEFAULT 42, -- 6 weeks default
  next_reminder_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE home_maintenance_reminders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'home_maintenance_reminders'
      AND policyname = 'Users manage own reminders'
  ) THEN
    CREATE POLICY "Users manage own reminders" ON home_maintenance_reminders
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reminders_user_id_idx ON home_maintenance_reminders(user_id);
CREATE INDEX IF NOT EXISTS reminders_next_date_idx ON home_maintenance_reminders(next_reminder_date)
  WHERE is_active = true;

-- The upsert in the client uses (user_id, category) as the conflict target.
-- A unique constraint is required for ON CONFLICT to work.
ALTER TABLE home_maintenance_reminders
  DROP CONSTRAINT IF EXISTS reminders_user_category_unique;
ALTER TABLE home_maintenance_reminders
  ADD CONSTRAINT reminders_user_category_unique UNIQUE (user_id, category);

-- Worker protection credits
-- Issued to helpers when: (1) poster cancels < 24h before job (late_cancel),
-- (2) payment dispute holds up payout (payment_guarantee).
CREATE TABLE IF NOT EXISTS worker_protection_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id),
  credit_type text NOT NULL CHECK (credit_type IN ('late_cancel', 'payment_guarantee', 'other')),
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'applied', 'expired')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '90 days')
);

ALTER TABLE worker_protection_credits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'worker_protection_credits'
      AND policyname = 'Helpers view own credits'
  ) THEN
    CREATE POLICY "Helpers view own credits" ON worker_protection_credits
      FOR SELECT USING (auth.uid() = helper_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS protection_credits_helper_id_idx ON worker_protection_credits(helper_id);
