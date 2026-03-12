
-- ============================================================
-- 1. FIX CRITICAL: Users can self-approve/unban via profile update
-- Add column restrictions by splitting the update policy
-- ============================================================

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

-- Users can only update safe fields on their own profile
-- We use a WITH CHECK that ensures controlled fields haven't changed
CREATE POLICY "Users can update their own safe fields"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
);

-- Create a trigger to prevent users from modifying controlled fields
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the updater is NOT an admin, prevent changes to controlled fields
  IF NOT has_role(auth.uid(), 'admin') THEN
    NEW.approval_status := OLD.approval_status;
    NEW.ban_status := OLD.ban_status;
    NEW.role := OLD.role;
    NEW.stripe_account_id := OLD.stripe_account_id;
    NEW.denial_reason := OLD.denial_reason;
    NEW.denial_email_count := OLD.denial_email_count;
    NEW.last_denial_email_at := OLD.last_denial_email_at;
    NEW.approval_email_count := OLD.approval_email_count;
    NEW.last_approval_email_at := OLD.last_approval_email_at;
    NEW.drip_step := OLD.drip_step;
    NEW.last_drip_at := OLD.last_drip_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_prevent_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_escalation();

-- ============================================================
-- 2. FIX: Reviews publicly readable — restrict to authenticated
-- ============================================================

DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;

CREATE POLICY "Reviews are viewable by authenticated users"
ON public.reviews
FOR SELECT
TO authenticated
USING (true);
