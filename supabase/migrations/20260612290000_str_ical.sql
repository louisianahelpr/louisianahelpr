-- STR calendar connections for Airbnb/VRBO iCal auto-job integration.
-- Each row represents one connected property calendar owned by a user.

CREATE TABLE IF NOT EXISTS str_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('airbnb', 'vrbo', 'booking_com', 'other')),
  ical_url text NOT NULL,
  property_name text,
  property_address text,
  auto_create_cleaning boolean NOT NULL DEFAULT true,
  cleaning_budget numeric(10,2) DEFAULT 80.00,
  cleaning_notes text,
  preferred_helper_id uuid REFERENCES auth.users(id),
  last_synced_at timestamptz,
  last_sync_error text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE str_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own STR connections" ON str_calendar_connections
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS str_connections_user_id_idx ON str_calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS str_connections_active_idx ON str_calendar_connections(is_active)
  WHERE is_active = true;

-- Track which checkout events have already been processed (avoid duplicate jobs).
-- Keyed on (connection_id, event_uid) — re-running the sync is idempotent.
CREATE TABLE IF NOT EXISTS str_processed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES str_calendar_connections(id) ON DELETE CASCADE,
  event_uid text NOT NULL,        -- iCal event UID
  checkout_date date NOT NULL,
  job_id uuid REFERENCES jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, event_uid)
);

ALTER TABLE str_processed_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own processed events" ON str_processed_events
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM str_calendar_connections WHERE id = connection_id
    )
  );

-- Flag auto-created STR jobs so the UI can surface them distinctly.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_auto_created boolean NOT NULL DEFAULT false;
