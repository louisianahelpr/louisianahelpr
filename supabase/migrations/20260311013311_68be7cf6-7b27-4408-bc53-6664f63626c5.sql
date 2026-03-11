
-- Add boost columns to jobs table
ALTER TABLE public.jobs ADD COLUMN boosted_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN boost_expires_at timestamptz;

-- Helper availability table
CREATE TABLE public.helper_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL,
  day_of_week integer,
  specific_date date,
  start_time time,
  end_time time,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.helper_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Helpers can manage their own availability"
  ON public.helper_availability FOR ALL
  TO authenticated
  USING (auth.uid() = helper_id)
  WITH CHECK (auth.uid() = helper_id);

CREATE POLICY "Anyone can view helper availability"
  ON public.helper_availability FOR SELECT
  TO authenticated
  USING (true);

-- Favorite helpers table
CREATE TABLE public.favorite_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  helper_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(customer_id, helper_id)
);

ALTER TABLE public.favorite_helpers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their favorites"
  ON public.favorite_helpers FOR ALL
  TO authenticated
  USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "Helpers can see who favorited them"
  ON public.favorite_helpers FOR SELECT
  TO authenticated
  USING (auth.uid() = helper_id);
