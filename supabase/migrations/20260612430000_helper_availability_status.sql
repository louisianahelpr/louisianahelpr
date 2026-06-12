-- "Available now" signal for helpers.
-- Stores an expiry timestamp: set to NOW() + 4h when toggled on,
-- cleared (NULL) when toggled off or when the time passes.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS available_until timestamptz;

-- Partial index so the poster's applicant view can efficiently check
-- which applicants are currently "available now".
CREATE INDEX IF NOT EXISTS profiles_available_until_idx
  ON profiles(available_until)
  WHERE available_until IS NOT NULL;

-- Helper toggles availability on (4-hour window)
CREATE OR REPLACE FUNCTION set_available_now(p_hours numeric DEFAULT 4)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_until timestamptz := now() + (p_hours || ' hours')::interval;
BEGIN
  UPDATE profiles SET available_until = v_until WHERE user_id = auth.uid();
  RETURN v_until;
END;
$$;
GRANT EXECUTE ON FUNCTION set_available_now(numeric) TO authenticated;

-- Helper clears availability
CREATE OR REPLACE FUNCTION clear_available_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET available_until = NULL WHERE user_id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION clear_available_now() TO authenticated;
