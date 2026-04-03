
-- Create parish tax rates table
CREATE TABLE public.parish_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_name text NOT NULL UNIQUE,
  state_rate numeric NOT NULL DEFAULT 5.00,
  local_rate numeric NOT NULL DEFAULT 0,
  total_rate numeric GENERATED ALWAYS AS (state_rate + local_rate) STORED,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.parish_tax_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read parish tax rates"
ON public.parish_tax_rates FOR SELECT USING (true);

CREATE POLICY "Admins can manage parish tax rates"
ON public.parish_tax_rates FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Add sales tax fields to jobs
ALTER TABLE public.jobs
  ADD COLUMN sales_tax_rate numeric DEFAULT 0,
  ADD COLUMN sales_tax_amount numeric DEFAULT 0;

-- Seed all 64 Louisiana parishes with approximate 2026 rates
INSERT INTO public.parish_tax_rates (parish_name, state_rate, local_rate) VALUES
('Acadia', 5.00, 5.50),
('Allen', 5.00, 5.00),
('Ascension', 5.00, 5.00),
('Assumption', 5.00, 5.75),
('Avoyelles', 5.00, 6.00),
('Beauregard', 5.00, 5.00),
('Bienville', 5.00, 5.50),
('Bossier', 5.00, 4.60),
('Caddo', 5.00, 4.85),
('Calcasieu', 5.00, 5.00),
('Caldwell', 5.00, 5.50),
('Cameron', 5.00, 5.00),
('Catahoula', 5.00, 6.00),
('Claiborne', 5.00, 5.00),
('Concordia', 5.00, 5.50),
('De Soto', 5.00, 5.00),
('East Baton Rouge', 5.00, 5.50),
('East Carroll', 5.00, 5.75),
('East Feliciana', 5.00, 5.50),
('Evangeline', 5.00, 5.50),
('Franklin', 5.00, 5.50),
('Grant', 5.00, 5.00),
('Iberia', 5.00, 5.50),
('Iberville', 5.00, 6.00),
('Jackson', 5.00, 5.50),
('Jefferson', 5.00, 4.75),
('Jefferson Davis', 5.00, 5.00),
('La Salle', 5.00, 5.50),
('Lafayette', 5.00, 4.50),
('Lafourche', 5.00, 4.75),
('Lincoln', 5.00, 5.00),
('Livingston', 5.00, 5.00),
('Madison', 5.00, 5.50),
('Morehouse', 5.00, 5.50),
('Natchitoches', 5.00, 5.50),
('Orleans', 5.00, 5.00),
('Ouachita', 5.00, 5.00),
('Plaquemines', 5.00, 4.75),
('Pointe Coupee', 5.00, 5.50),
('Rapides', 5.00, 5.25),
('Red River', 5.00, 5.50),
('Richland', 5.00, 5.50),
('Sabine', 5.00, 5.50),
('St. Bernard', 5.00, 5.00),
('St. Charles', 5.00, 4.75),
('St. Helena', 5.00, 6.00),
('St. James', 5.00, 5.50),
('St. John the Baptist', 5.00, 5.00),
('St. Landry', 5.00, 5.50),
('St. Martin', 5.00, 5.00),
('St. Mary', 5.00, 5.50),
('St. Tammany', 5.00, 5.00),
('Tangipahoa', 5.00, 5.00),
('Tensas', 5.00, 6.00),
('Terrebonne', 5.00, 4.50),
('Union', 5.00, 5.00),
('Vermilion', 5.00, 5.00),
('Vernon', 5.00, 5.00),
('Washington', 5.00, 5.50),
('Webster', 5.00, 5.00),
('West Baton Rouge', 5.00, 5.00),
('West Carroll', 5.00, 5.50),
('West Feliciana', 5.00, 5.50),
('Winn', 5.00, 5.50);
