-- Internal admin notes about users
CREATE TABLE public.admin_user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  note text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_user_notes_user_id ON public.admin_user_notes (user_id, created_at DESC);
CREATE INDEX idx_admin_user_notes_admin_id ON public.admin_user_notes (admin_id);

ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;

-- Only admins can read notes
CREATE POLICY "Admins can view all user notes"
  ON public.admin_user_notes
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Only admins can create notes, and they must mark themselves as the author
CREATE POLICY "Admins can create user notes"
  ON public.admin_user_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND admin_id = auth.uid()
  );

-- Admins can edit only the notes they wrote
CREATE POLICY "Admins can update their own notes"
  ON public.admin_user_notes
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND admin_id = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND admin_id = auth.uid()
  );

-- Any admin can delete a note (so co-admins can clean up)
CREATE POLICY "Admins can delete user notes"
  ON public.admin_user_notes
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Auto-update updated_at on edits
CREATE TRIGGER update_admin_user_notes_updated_at
  BEFORE UPDATE ON public.admin_user_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();