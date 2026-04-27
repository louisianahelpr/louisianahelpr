-- Backfill: any customer who has verified their email but is still
-- stuck on approval_status='pending' should be auto-approved, matching
-- the behavior of the sync_email_verified trigger.
UPDATE public.profiles p
SET approval_status = 'approved'
FROM auth.users u
WHERE p.user_id = u.id
  AND p.role = 'customer'
  AND p.approval_status = 'pending'
  AND u.email_confirmed_at IS NOT NULL;