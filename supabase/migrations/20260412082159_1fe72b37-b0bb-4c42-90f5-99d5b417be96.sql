CREATE TABLE public.social_post_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  style TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  reviewed_by UUID
);

ALTER TABLE public.social_post_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage social post drafts"
ON public.social_post_drafts
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));