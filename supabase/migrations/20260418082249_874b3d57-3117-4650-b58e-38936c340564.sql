-- Add UNIQUE constraint to user_roles to prevent duplicate role inserts
-- This closes the privilege escalation race condition flagged by security scan
ALTER TABLE public.user_roles
ADD CONSTRAINT user_roles_user_id_role_unique UNIQUE (user_id, role);