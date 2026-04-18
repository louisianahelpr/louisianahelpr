-- User-to-user blocking table
CREATE TABLE public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_user_blocks_blocker ON public.user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view blocks involving them"
  ON public.user_blocks FOR SELECT
  TO authenticated
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

CREATE POLICY "Users can create their own blocks"
  ON public.user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can remove their own blocks"
  ON public.user_blocks FOR DELETE
  TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "Admins can view all blocks"
  ON public.user_blocks FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Bidirectional check: are two users blocked in either direction?
CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _user_a AND blocked_id = _user_b)
       OR (blocker_id = _user_b AND blocked_id = _user_a)
  );
$$;