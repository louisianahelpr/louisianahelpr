ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;

-- Allow users to write their own acceptance timestamp; the prevent_self_escalation
-- trigger already protects sensitive fields, and accepted_terms_at is intentionally
-- user-writable. No additional policy changes needed since profiles already has
-- a "users can update own profile" policy.