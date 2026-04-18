
-- 1. Add parish + zip to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS parish text,
  ADD COLUMN IF NOT EXISTS zip_code text;

-- 2. Add parish + zip to jobs (lock tax jurisdiction at creation)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS parish text,
  ADD COLUMN IF NOT EXISTS zip_code text;

-- 3. Create LA zip → parish lookup table
CREATE TABLE IF NOT EXISTS public.louisiana_zip_parishes (
  zip_code text PRIMARY KEY,
  parish text NOT NULL,
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.louisiana_zip_parishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read zip parishes"
  ON public.louisiana_zip_parishes FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage zip parishes"
  ON public.louisiana_zip_parishes FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_la_zip_parishes_parish ON public.louisiana_zip_parishes(parish);

-- 4. Lookup function (zip → parish)
CREATE OR REPLACE FUNCTION public.get_parish_for_zip(p_zip text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT parish
  FROM public.louisiana_zip_parishes
  WHERE zip_code = LEFT(REGEXP_REPLACE(COALESCE(p_zip, ''), '[^0-9]', '', 'g'), 5)
  LIMIT 1;
$$;

-- 5. Seed Louisiana zip → parish mapping (primary zips per parish)
INSERT INTO public.louisiana_zip_parishes (zip_code, parish, city) VALUES
  -- Orleans
  ('70112','Orleans','New Orleans'),('70113','Orleans','New Orleans'),('70114','Orleans','New Orleans'),
  ('70115','Orleans','New Orleans'),('70116','Orleans','New Orleans'),('70117','Orleans','New Orleans'),
  ('70118','Orleans','New Orleans'),('70119','Orleans','New Orleans'),('70122','Orleans','New Orleans'),
  ('70124','Orleans','New Orleans'),('70125','Orleans','New Orleans'),('70126','Orleans','New Orleans'),
  ('70127','Orleans','New Orleans'),('70128','Orleans','New Orleans'),('70129','Orleans','New Orleans'),
  ('70130','Orleans','New Orleans'),('70131','Orleans','New Orleans'),
  -- Jefferson
  ('70001','Jefferson','Metairie'),('70002','Jefferson','Metairie'),('70003','Jefferson','Metairie'),
  ('70005','Jefferson','Metairie'),('70006','Jefferson','Metairie'),('70053','Jefferson','Gretna'),
  ('70056','Jefferson','Gretna'),('70058','Jefferson','Harvey'),('70062','Jefferson','Kenner'),
  ('70065','Jefferson','Kenner'),('70072','Jefferson','Marrero'),('70094','Jefferson','Westwego'),
  -- East Baton Rouge
  ('70801','East Baton Rouge','Baton Rouge'),('70802','East Baton Rouge','Baton Rouge'),
  ('70805','East Baton Rouge','Baton Rouge'),('70806','East Baton Rouge','Baton Rouge'),
  ('70808','East Baton Rouge','Baton Rouge'),('70809','East Baton Rouge','Baton Rouge'),
  ('70810','East Baton Rouge','Baton Rouge'),('70811','East Baton Rouge','Baton Rouge'),
  ('70812','East Baton Rouge','Baton Rouge'),('70814','East Baton Rouge','Baton Rouge'),
  ('70815','East Baton Rouge','Baton Rouge'),('70816','East Baton Rouge','Baton Rouge'),
  ('70817','East Baton Rouge','Baton Rouge'),('70818','East Baton Rouge','Baton Rouge'),
  ('70819','East Baton Rouge','Baton Rouge'),('70820','East Baton Rouge','Baton Rouge'),
  -- Caddo
  ('71101','Caddo','Shreveport'),('71103','Caddo','Shreveport'),('71104','Caddo','Shreveport'),
  ('71105','Caddo','Shreveport'),('71106','Caddo','Shreveport'),('71107','Caddo','Shreveport'),
  ('71108','Caddo','Shreveport'),('71109','Caddo','Shreveport'),('71118','Caddo','Shreveport'),
  ('71119','Caddo','Shreveport'),('71129','Caddo','Shreveport'),
  -- Calcasieu
  ('70601','Calcasieu','Lake Charles'),('70605','Calcasieu','Lake Charles'),('70607','Calcasieu','Lake Charles'),
  ('70611','Calcasieu','Lake Charles'),('70615','Calcasieu','Lake Charles'),('70633','Calcasieu','DeQuincy'),
  ('70663','Calcasieu','Sulphur'),('70665','Calcasieu','Sulphur'),
  -- Lafayette
  ('70501','Lafayette','Lafayette'),('70503','Lafayette','Lafayette'),('70506','Lafayette','Lafayette'),
  ('70507','Lafayette','Lafayette'),('70508','Lafayette','Lafayette'),('70520','Lafayette','Carencro'),
  ('70592','Lafayette','Youngsville'),('70583','Lafayette','Scott'),
  -- Ouachita
  ('71201','Ouachita','Monroe'),('71202','Ouachita','Monroe'),('71203','Ouachita','Monroe'),
  ('71291','Ouachita','West Monroe'),('71292','Ouachita','West Monroe'),
  -- St. Tammany
  ('70433','St. Tammany','Covington'),('70435','St. Tammany','Covington'),('70437','St. Tammany','Folsom'),
  ('70445','St. Tammany','Lacombe'),('70447','St. Tammany','Madisonville'),('70448','St. Tammany','Mandeville'),
  ('70458','St. Tammany','Slidell'),('70460','St. Tammany','Slidell'),('70461','St. Tammany','Slidell'),
  ('70471','St. Tammany','Mandeville'),
  -- Tangipahoa
  ('70401','Tangipahoa','Hammond'),('70403','Tangipahoa','Hammond'),('70422','Tangipahoa','Amite'),
  ('70442','Tangipahoa','Kentwood'),('70443','Tangipahoa','Loranger'),('70454','Tangipahoa','Ponchatoula'),
  -- Livingston
  ('70449','Livingston','Maurepas'),('70462','Livingston','Springfield'),('70706','Livingston','Denham Springs'),
  ('70726','Livingston','Denham Springs'),('70727','Livingston','Denham Springs'),('70744','Livingston','Holden'),
  ('70754','Livingston','Livingston'),('70785','Livingston','Walker'),
  -- Ascension
  ('70346','Ascension','Donaldsonville'),('70737','Ascension','Gonzales'),('70738','Ascension','Geismar'),
  ('70769','Ascension','Prairieville'),('70778','Ascension','Sorrento'),
  -- Bossier
  ('71006','Bossier','Benton'),('71037','Bossier','Haughton'),('71111','Bossier','Bossier City'),
  ('71112','Bossier','Bossier City'),('71113','Bossier','Bossier City'),
  -- Rapides
  ('71301','Rapides','Alexandria'),('71302','Rapides','Alexandria'),('71303','Rapides','Alexandria'),
  ('71360','Rapides','Pineville'),('71361','Rapides','Pineville'),
  -- Terrebonne
  ('70301','Terrebonne','Thibodaux'),('70360','Terrebonne','Houma'),('70363','Terrebonne','Houma'),
  ('70364','Terrebonne','Houma'),
  -- Lafourche
  ('70354','Lafourche','Galliano'),('70357','Lafourche','Golden Meadow'),('70374','Lafourche','Lockport'),
  ('70394','Lafourche','Raceland'),
  -- St. Bernard
  ('70032','St. Bernard','Arabi'),('70043','St. Bernard','Chalmette'),('70075','St. Bernard','Meraux'),
  ('70085','St. Bernard','Violet'),('70092','St. Bernard','Saint Bernard'),
  -- Plaquemines
  ('70037','Plaquemines','Belle Chasse'),('70083','Plaquemines','Port Sulphur'),('70091','Plaquemines','Venice'),
  -- Iberia
  ('70544','Iberia','Jeanerette'),('70560','Iberia','New Iberia'),('70563','Iberia','New Iberia'),
  -- St. Mary
  ('70380','St. Mary','Morgan City'),('70381','St. Mary','Berwick'),('70538','St. Mary','Franklin'),
  -- Vermilion
  ('70510','Vermilion','Abbeville'),('70548','Vermilion','Kaplan'),('70592','Vermilion','Maurice'),
  -- Acadia
  ('70526','Acadia','Crowley'),('70578','Acadia','Rayne'),('70534','Acadia','Estherwood'),
  -- St. Landry
  ('70512','St. Landry','Arnaudville'),('70535','St. Landry','Eunice'),('70570','St. Landry','Opelousas'),
  ('70571','St. Landry','Opelousas'),
  -- Avoyelles
  ('71302','Avoyelles','Bunkie'),('71322','Avoyelles','Bunkie'),('71351','Avoyelles','Marksville'),
  -- Natchitoches
  ('71457','Natchitoches','Natchitoches'),('71469','Natchitoches','Robeline'),
  -- Vernon
  ('71446','Vernon','Leesville'),('71459','Vernon','Fort Polk'),('71496','Vernon','Leesville'),
  -- Beauregard
  ('70634','Beauregard','DeRidder'),('70638','Beauregard','Singer'),
  -- Allen
  ('70648','Allen','Kinder'),('70651','Allen','Mittie'),('70656','Allen','Pitkin'),
  -- Jefferson Davis
  ('70546','Jefferson Davis','Jennings'),('70549','Jefferson Davis','Lake Arthur'),('70591','Jefferson Davis','Welsh'),
  -- Cameron
  ('70631','Cameron','Cameron'),('70643','Cameron','Grand Chenier'),('70645','Cameron','Hackberry'),
  -- Evangeline
  ('70554','Evangeline','Mamou'),('70576','Evangeline','Ville Platte'),('70586','Evangeline','Ville Platte'),
  -- St. Martin
  ('70517','St. Martin','Breaux Bridge'),('70518','St. Martin','Cade'),('70582','St. Martin','St. Martinville'),
  -- St. James
  ('70030','St. James','Convent'),('70049','St. James','Grand Bayou'),('70086','St. James','Vacherie'),
  -- St. John the Baptist
  ('70051','St. John the Baptist','Edgard'),('70068','St. John the Baptist','LaPlace'),('70084','St. John the Baptist','Reserve'),
  -- St. Charles
  ('70039','St. Charles','Hahnville'),('70047','St. Charles','Destrehan'),('70057','St. Charles','Hahnville'),('70070','St. Charles','Luling'),('70079','St. Charles','New Sarpy'),
  -- Iberville
  ('70764','Iberville','Plaquemine'),('70788','Iberville','White Castle'),
  -- West Baton Rouge
  ('70767','West Baton Rouge','Port Allen'),('70788','West Baton Rouge','Brusly'),
  -- Pointe Coupee
  ('70732','Pointe Coupee','Batchelor'),('70760','Pointe Coupee','New Roads'),
  -- East Feliciana
  ('70722','East Feliciana','Clinton'),('70748','East Feliciana','Jackson'),
  -- West Feliciana
  ('70775','West Feliciana','St. Francisville'),
  -- Washington
  ('70427','Washington','Bogalusa'),('70438','Washington','Franklinton'),('70444','Washington','Mount Hermon'),
  -- St. Helena
  ('70441','St. Helena','Greensburg'),('70453','St. Helena','Pine Grove'),
  -- Assumption
  ('70339','Assumption','Pierre Part'),('70341','Assumption','Belle Rose'),('70390','Assumption','Napoleonville'),
  -- Concordia
  ('71334','Concordia','Ferriday'),('71373','Concordia','Vidalia'),
  -- Catahoula
  ('71316','Catahoula','Acme'),('71343','Catahoula','Jonesville'),('71368','Catahoula','Sicily Island'),
  -- LaSalle
  ('71342','LaSalle','Jena'),('71366','LaSalle','Olla'),('71377','LaSalle','Tullos'),
  -- Grant
  ('71411','Grant','Bentley'),('71467','Grant','Pollock'),('71473','Grant','Verda'),
  -- Winn
  ('71410','Winn','Atlanta'),('71474','Winn','Sikes'),('71483','Winn','Winnfield'),
  -- Caldwell
  ('71418','Caldwell','Columbia'),('71435','Caldwell','Grayson'),
  -- Franklin
  ('71243','Franklin','Crowville'),('71286','Franklin','Wisner'),('71295','Franklin','Winnsboro'),
  -- Tensas
  ('71366','Tensas','Newellton'),('71375','Tensas','St. Joseph'),
  -- Madison
  ('71232','Madison','Delhi'),('71282','Madison','Tallulah'),
  -- East Carroll
  ('71254','East Carroll','Lake Providence'),
  -- West Carroll
  ('71261','West Carroll','Oak Grove'),('71263','West Carroll','Pioneer'),
  -- Morehouse
  ('71220','Morehouse','Bastrop'),('71225','Morehouse','Bonita'),('71229','Morehouse','Collinston'),
  -- Richland
  ('71259','Richland','Mangham'),('71269','Richland','Rayville'),
  -- Union
  ('71223','Union','Bernice'),('71241','Union','Farmerville'),('71277','Union','Spearsville'),
  -- Lincoln
  ('71245','Lincoln','Grambling'),('71270','Lincoln','Ruston'),('71272','Lincoln','Ruston'),
  -- Jackson
  ('71251','Jackson','Jonesboro'),('71275','Jackson','Quitman'),
  -- Bienville
  ('71008','Bienville','Bienville'),('71018','Bienville','Castor'),('71027','Bienville','Gibsland'),
  -- Claiborne
  ('71024','Claiborne','Athens'),('71040','Claiborne','Homer'),('71055','Claiborne','Lisbon'),
  -- Webster
  ('71016','Webster','Cotton Valley'),('71055','Webster','Minden'),('71064','Webster','Sarepta'),('71073','Webster','Springhill'),
  -- DeSoto
  ('71019','DeSoto','Grand Cane'),('71033','DeSoto','Keithville'),('71046','DeSoto','Logansport'),('71052','DeSoto','Mansfield'),
  -- Red River
  ('71019','Red River','Coushatta'),('71068','Red River','Ringgold'),
  -- Sabine
  ('71429','Sabine','Florien'),('71449','Sabine','Many'),('71469','Sabine','Robeline'),
  -- Concordia / Catahoula extras already done
  -- La Salle extras already done
  ('70058','Jefferson','Harvey')
ON CONFLICT (zip_code) DO NOTHING;
