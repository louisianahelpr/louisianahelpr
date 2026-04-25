-- ============================================================
-- BUSINESSES
-- ============================================================
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_owner ON public.businesses(owner_id);

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BUSINESS MEMBERS
-- ============================================================
CREATE TYPE public.business_member_role AS ENUM ('owner', 'member');
CREATE TYPE public.business_member_status AS ENUM ('pending', 'active', 'removed');

CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid,
  invited_email text,
  role public.business_member_role NOT NULL DEFAULT 'member',
  status public.business_member_status NOT NULL DEFAULT 'pending',
  invited_by uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_members_business ON public.business_members(business_id);
CREATE INDEX idx_business_members_user ON public.business_members(user_id);
CREATE INDEX idx_business_members_email ON public.business_members(lower(invited_email));

-- Unique constraint: same user can't be in same business twice (active rows only)
CREATE UNIQUE INDEX uniq_business_member_user
  ON public.business_members(business_id, user_id)
  WHERE user_id IS NOT NULL AND status <> 'removed';

CREATE UNIQUE INDEX uniq_business_member_email
  ON public.business_members(business_id, lower(invited_email))
  WHERE invited_email IS NOT NULL AND status = 'pending';

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- JOBS: add business_id
-- ============================================================
ALTER TABLE public.jobs ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;
CREATE INDEX idx_jobs_business ON public.jobs(business_id) WHERE business_id IS NOT NULL;

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to avoid RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_business_member(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _business_id
      AND user_id = _user_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_business_owner(_business_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = _business_id AND owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_business_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id FROM public.business_members
  WHERE user_id = _user_id AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.get_pending_invite_for_email(_email text)
RETURNS TABLE(invite_id uuid, business_id uuid, business_name text, invited_by_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.id, bm.business_id, b.name, p.full_name
  FROM public.business_members bm
  JOIN public.businesses b ON b.id = bm.business_id
  LEFT JOIN public.profiles p ON p.user_id = bm.invited_by
  WHERE lower(bm.invited_email) = lower(_email)
    AND bm.status = 'pending'
  ORDER BY bm.invited_at DESC;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-add owner as a member row when business is created
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.business_members (business_id, user_id, role, status, joined_at, invited_by)
  VALUES (NEW.id, NEW.owner_id, 'owner', 'active', now(), NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_add_owner_as_member
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- Enforce 5-member limit (counts active + pending; owner counts as 1)
CREATE OR REPLACE FUNCTION public.enforce_business_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_count integer;
BEGIN
  -- Only enforce on inserts that aren't the owner row
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO member_count
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('active', 'pending');

  IF member_count >= 5 THEN
    RAISE EXCEPTION 'This business has reached the 5-member limit. Upgrade to add more members.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_business_member_limit
BEFORE INSERT ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_business_member_limit();

-- updated_at trigger for businesses
CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS POLICIES: businesses
-- ============================================================
CREATE POLICY "Members can view their business"
ON public.businesses FOR SELECT
USING (
  owner_id = auth.uid()
  OR public.is_business_member(id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Authenticated users can create a business"
ON public.businesses FOR INSERT
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can update their business"
ON public.businesses FOR UPDATE
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can delete their business"
ON public.businesses FOR DELETE
USING (owner_id = auth.uid());

-- ============================================================
-- RLS POLICIES: business_members
-- ============================================================
CREATE POLICY "Members can view their business roster"
ON public.business_members FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR (
    invited_email IS NOT NULL
    AND status = 'pending'
    AND lower(invited_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  )
);

CREATE POLICY "Owner can invite members"
ON public.business_members FOR INSERT
WITH CHECK (
  public.is_business_owner(business_id, auth.uid())
  OR (role = 'owner' AND user_id = auth.uid())
);

CREATE POLICY "Owner can update members; invitee can accept own invite"
ON public.business_members FOR UPDATE
USING (
  public.is_business_owner(business_id, auth.uid())
  OR (
    status = 'pending'
    AND invited_email IS NOT NULL
    AND lower(invited_email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  )
);

CREATE POLICY "Owner can remove members"
ON public.business_members FOR DELETE
USING (
  public.is_business_owner(business_id, auth.uid())
  AND role <> 'owner'
);

-- ============================================================
-- RLS POLICIES: jobs (business-aware additions)
-- ============================================================
CREATE POLICY "Business members can view team jobs"
ON public.jobs FOR SELECT
USING (
  business_id IS NOT NULL
  AND public.is_business_member(business_id, auth.uid())
);

CREATE POLICY "Business members can update team jobs"
ON public.jobs FOR UPDATE
USING (
  business_id IS NOT NULL
  AND public.is_business_member(business_id, auth.uid())
);