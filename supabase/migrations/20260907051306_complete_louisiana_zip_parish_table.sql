-- Complete the Louisiana ZIP→parish table (252 rows → 720) and give every ZIP a
-- centroid.
--
-- ZIP is the location mechanism that works for EVERY member, which is what
-- makes this table load-bearing rather than merely useful.
--
-- `profiles.latitude/longitude` are alive and getting their first real writer
-- (device geolocation, 20260907051731) — an earlier plan to drop them as
-- writerless was reversed mid-flight and never landed. But a device fix exists
-- only for members who grant the permission, and parish does not depend on one
-- at all: `get_ranked_open_jobs` ranks on parish and the helper job-match
-- fan-out matches on `p.parish = NEW.parish`. So a ZIP this table does not hold
-- resolves to a NULL parish, and a NULL parish is a member no fan-out reaches
-- and no ranking favours — however good their GPS is. The centroids added below
-- are the fallback tier for the members who decline, not a replacement for the
-- real fix.
--
-- The table was a SAMPLE, and nobody had noticed because a sample looks exactly
-- like a complete table from the inside: all 64 parishes were present, so every
-- coverage check that counted parishes passed. It held 252 of Louisiana's 720
-- ZIP codes — 35%. Nearly two thirds of the state resolved to no parish at all.
--
-- Proof it was already biting: the owner's own account carries
-- `zip_code = '70528'` (Delcambre) with `parish = NULL`, because 70528 was one
-- of the 468. 70528 sits in the 705xx band where the old table held 30 entries
-- and skipped the rest — the gap is not at the edges of the state, it is
-- everywhere.
--
-- The companion migration (20260907053228) makes `profiles.parish` DERIVED from
-- this table by a trigger, so it can never again be silently skipped. This file
-- is the data that trigger depends on; it is only as good as this table.
--
-- ══ Where the 720 ZIPs come from ═══════════════════════════════════════════
--
-- GeoNames US postal dataset (https://download.geonames.org/export/zip/US.zip),
-- rows with state = LA: 719 ZIPs across all 64 parishes, spanning 70001–71497
-- with no LA-prefix ZIP filed under another state and no LA row outside that
-- band. Its `admin name2` is the USPS-assigned county for each ZIP's delivery
-- city, normalised here to the house spellings ("De Soto" → DeSoto,
-- "La Salle" → LaSalle, " Parish" suffix stripped) — the same 64 strings
-- `src/lib/parishes.ts` already holds.
--
-- Plus one row GeoNames does not supply: 71749 (Junction City). The town
-- straddles the Arkansas line, so GeoNames files the ZIP under Union County,
-- ARKANSAS — but the US Census 2020 ZCTA-to-county relationship file shows a
-- Union Parish, Louisiana part, and a Louisiana resident of Junction City
-- types 71749. Filed under Union. 719 + 1 = 720.
--
-- ══ Accuracy, which matters more here than completeness ════════════════════
--
-- A missing ZIP fails loudly (the signup guard warns, and the trigger's third
-- rung logs); a WRONG one silently ranks someone into the wrong community
-- forever. So every row was cross-checked against a second, independent source:
-- the US Census 2020 ZCTA-to-County relationship file
-- (tab20_zcta520_county20_natl.txt, county GEOID prefix 22).
--
-- 541 of the 720 have a Census ZCTA at all — the other 179 are PO-box-only and
-- unique/firm ZIPs, which have no ZCTA by construction and therefore no Census
-- opinion to disagree with. Of those 541, 150 span more than one parish (a ZIP
-- is a postal delivery route, not a civic boundary), and on 527 the two sources
-- agree outright.
--
-- That leaves **14 straddling ZIPs where USPS and the Census land-area
-- plurality point at different parishes.** Resolved by the convention the
-- 2026-09-04 pass already set: follow the parish the named town's POPULATION is
-- in, not the parish holding the most rural acreage, because a jobs app matches
-- people and not fields. In all 14 the USPS/GeoNames answer is the one the town
-- actually sits in. Listed so the next reader does not re-open them, with the
-- Census land-area plurality in brackets:
--
--   70343  Bourg        Terrebonne   [Lafourche 50.6% — a near tie]
--   70380  Morgan City  St. Mary     [Assumption 39.0%]
--   70515  Basile       Evangeline   [Acadia 56.8%]
--   70528  Delcambre    Vermilion    [Iberia 88.1%] ← see note below
--   70535  Eunice       St. Landry   [Acadia 52.7%]
--   70630  Bell City    Calcasieu    [Cameron 57.3%]
--   70637  Dry Creek    Beauregard   [Allen 52.0%]
--   71031  Goldonna     Natchitoches [Winn 54.8%]
--   71070  Saline       Bienville    [Natchitoches 69.6%]
--   71232  Delhi        Richland     [Madison 46.2%]
--   71280  Sterlington  Ouachita     [Union 72.6%]
--   71326  Clayton      Concordia    [Catahoula 73.7%]
--   71438  Hineston     Rapides      [Vernon 70.3%]
--   71479  Tullos       LaSalle      [Winn 68.9%]
--
-- **70528 (Delcambre) is the one row worth a second opinion, and it is the
-- owner's own.** Delcambre is genuinely an incorporated town in TWO parishes.
-- USPS assigns the ZIP to Vermilion, the Vermilion Parish Chamber and Tourist
-- Commission both claim the town, and the schools sit on the Vermilion side —
-- but the town's primary coordinates fall in Iberia, Iberia Parish School
-- System runs those schools, and the ZCTA's land area is 88% Iberia. Vermilion
-- is chosen for consistency with USPS and with every other row in this table.
-- If the owner's address is physically east of Bayou Carlin, this single row
-- should be flipped to Iberia — a one-line UPDATE, stated here rather than
-- buried, because guessing quietly on a straddler is the failure mode this
-- comment exists to prevent.
--
-- ══ The centroids, and what they are NOT ═══════════════════════════════════
--
-- `latitude`/`longitude` are added here as the FALLBACK location tier for
-- anyone who declines device geolocation. Two sources, because no single one
-- covers every ZIP:
--
--   540 rows — US Census 2024 ZCTA Gazetteer (2024_Gaz_zcta_national.txt),
--              columns INTPTLAT / INTPTLONG.
--   180 rows — GeoNames, for the PO-box-only and unique ZIPs that have no ZCTA
--              and therefore no gazetteer row at all. There the point is the
--              delivery office.
--
-- **INTPTLAT/INTPTLONG is the GEOMETRIC INTERNAL POINT — a point guaranteed to
-- fall inside the ZCTA polygon. It is NOT population-weighted.** The Census
-- publishes centers of population for counties and tracts, but not for ZCTAs,
-- so a population-weighted ZIP centroid does not exist in public data. This
-- matters exactly where it was predicted to: measured against the GeoNames
-- post-office point on the 539 ZIPs both sources cover, the two differ by a
-- median of 2.3 km — but p99 is 18.4 km and the maximum is 33.1 km (70753
-- Lettsworth), and the divergence tracks ZCTA land area almost perfectly. Every
-- one of the ten worst is a rural ZIP of 78–538 square miles, where the
-- geometric middle of the polygon is nowhere near the town. If a later design
-- wants "where the people are" rather than "the middle of the shape", the
-- GeoNames point is the better input and this is the note that says so.
--
-- One centroid falls outside Louisiana's bounding box, and it is correct:
-- 71749 (Junction City) sits at 33.0719 N, about a kilometre north of the
-- 33.0083 state line, because the town centre — and hence the ZCTA's internal
-- point — is on the Arkansas side. The parish assignment (Union, LA) is
-- deliberate; see above. For radius arithmetic a kilometre of offset is
-- immaterial, and inventing a point south of the line would be a fabrication.
--
-- **These coordinates are explicitly NOT precise, and must never be copied onto
-- `profiles`.** A centroid puts every account in a ZIP on one identical point.
-- That is right for "jobs within 25 miles" and catastrophic for anything
-- sub-mile. The design decision is that centroids live HERE and are joined at
-- read time; `profiles.latitude/longitude` mean "a real device fix" and nothing
-- else. The column comments below restate this so it cannot be misread from the
-- schema alone.

ALTER TABLE public.louisiana_zip_parishes
  ADD COLUMN IF NOT EXISTS latitude  numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

INSERT INTO public.louisiana_zip_parishes (zip_code, parish, city, latitude, longitude) VALUES
  ('70001','Jefferson','Metairie',29.982705,-90.169068),
  ('70002','Jefferson','Metairie',30.010189,-90.162617),
  ('70003','Jefferson','Metairie',30.001164,-90.209724),
  ('70004','Jefferson','Metairie',29.9841,-90.1529),
  ('70005','Jefferson','Metairie',29.999416,-90.134065),
  ('70006','Jefferson','Metairie',30.014032,-90.191345),
  ('70009','Jefferson','Metairie',29.9841,-90.1529),
  ('70010','Jefferson','Metairie',29.9841,-90.1529),
  ('70011','Jefferson','Metairie',29.9841,-90.1529),
  ('70030','St. Charles','Des Allemands',29.819197,-90.43971),
  ('70031','St. Charles','Ama',29.943492,-90.295565),
  ('70032','St. Bernard','Arabi',29.95038,-89.996001),
  ('70033','Jefferson','Metairie',29.9841,-90.1529),
  ('70036','Jefferson','Barataria',29.684562,-90.131823),
  ('70037','Plaquemines','Belle Chasse',29.715894,-90.035359),
  ('70038','Plaquemines','Boothville',29.331064,-89.400699),
  ('70039','St. Charles','Boutte',29.877209,-90.377249),
  ('70040','Plaquemines','Braithwaite',29.740211,-89.922596),
  ('70041','Plaquemines','Buras',29.333868,-89.467526),
  ('70043','St. Bernard','Chalmette',29.956176,-89.964417),
  ('70044','St. Bernard','Chalmette',29.9676,-89.9514),
  ('70047','St. Charles','Destrehan',29.972092,-90.354156),
  ('70049','St. John the Baptist','Edgard',30.030039,-90.562201),
  ('70050','Plaquemines','Empire',29.38336,-89.595672),
  ('70051','St. John the Baptist','Garyville',30.073542,-90.642768),
  ('70052','St. James','Gramercy',30.070157,-90.687348),
  ('70053','Jefferson','Gretna',29.917069,-90.052204),
  ('70054','Jefferson','Gretna',29.9146,-90.054),
  ('70055','Jefferson','Metairie',29.9841,-90.1529),
  ('70056','Jefferson','Gretna',29.887441,-90.027304),
  ('70057','St. Charles','Hahnville',29.962198,-90.464199),
  ('70058','Jefferson','Harvey',29.868874,-90.064872),
  ('70059','Jefferson','Harvey',29.9035,-90.0773),
  ('70060','Jefferson','Metairie',29.9841,-90.1529),
  ('70062','Jefferson','Kenner',29.991669,-90.257984),
  ('70063','Jefferson','Kenner',29.9941,-90.2417),
  ('70064','Jefferson','Kenner',29.9941,-90.2417),
  ('70065','Jefferson','Kenner',30.026672,-90.25345),
  ('70067','Jefferson','Lafitte',29.710879,-90.096784),
  ('70068','St. John the Baptist','LaPlace',30.156347,-90.436783),
  ('70069','St. John the Baptist','LaPlace',30.0912,-90.4832),
  ('70070','St. Charles','Luling',29.829842,-90.310627),
  ('70071','St. James','Lutcher',30.05192,-90.703341),
  ('70072','Jefferson','Marrero',29.809263,-90.138308),
  ('70073','Jefferson','Marrero',29.8994,-90.1004),
  ('70075','St. Bernard','Meraux',29.927459,-89.91921),
  ('70076','St. John the Baptist','Mount Airy',30.054467,-90.64973),
  ('70078','St. Charles','New Sarpy',29.9817,-90.3859),
  ('70079','St. Charles','Norco',30.002153,-90.412317),
  ('70080','St. Charles','Paradis',29.871092,-90.421812),
  ('70081','Plaquemines','Pilottown',29.1816,-89.2576),
  ('70082','Plaquemines','Pointe A La Hache',29.571513,-89.752824),
  ('70083','Plaquemines','Port Sulphur',29.511914,-89.843736),
  ('70084','St. John the Baptist','Reserve',30.072724,-90.573197),
  ('70085','St. Bernard','St. Bernard',29.818077,-89.759469),
  ('70086','St. James','St. James',30.036193,-90.865406),
  ('70087','St. Charles','St. Rose',29.994018,-90.320832),
  ('70090','St. James','Vacherie',29.969253,-90.701136),
  ('70091','Plaquemines','Venice',29.16749,-89.216283),
  ('70092','St. Bernard','Violet',29.899112,-89.895936),
  ('70093','Plaquemines','Belle Chasse',29.8549,-89.9906),
  ('70094','Jefferson','Westwego',29.915778,-90.207605),
  ('70096','Jefferson','Westwego',29.906,-90.1423),
  ('70097','Jefferson','Kenner',29.9565,-90.2635),
  ('70112','Orleans','New Orleans',29.95609,-90.07735),
  ('70113','Orleans','New Orleans',29.942292,-90.083732),
  ('70114','Orleans','New Orleans',29.937445,-90.032322),
  ('70115','Orleans','New Orleans',29.92393,-90.102484),
  ('70116','Orleans','New Orleans',29.96744,-90.064783),
  ('70117','Orleans','New Orleans',29.968157,-90.029962),
  ('70118','Orleans','New Orleans',29.944708,-90.125674),
  ('70119','Orleans','New Orleans',29.975752,-90.087845),
  ('70121','Jefferson','New Orleans',29.961736,-90.159183),
  ('70122','Orleans','New Orleans',30.008505,-90.064718),
  ('70123','Jefferson','New Orleans',29.949989,-90.205559),
  ('70124','Orleans','New Orleans',30.007379,-90.103919),
  ('70125','Orleans','New Orleans',29.951928,-90.10335),
  ('70126','Orleans','New Orleans',30.019485,-90.017565),
  ('70127','Orleans','New Orleans',30.028404,-89.9742),
  ('70128','Orleans','New Orleans',30.044717,-89.951375),
  ('70129','Orleans','New Orleans',30.080851,-89.813366),
  ('70130','Orleans','New Orleans',29.936406,-90.069932),
  ('70131','Orleans','New Orleans',29.906333,-89.95834),
  ('70139','Orleans','New Orleans',29.95023,-90.070995),
  ('70141','Jefferson','New Orleans',29.9546,-90.0751),
  ('70142','Orleans','New Orleans',29.9546,-90.0751),
  ('70143','Orleans','New Orleans',29.9546,-90.0751),
  ('70145','Orleans','New Orleans',29.9546,-90.0751),
  ('70146','Orleans','New Orleans',29.9546,-90.0751),
  ('70148','Orleans','New Orleans',30.02732,-90.067597),
  ('70150','Orleans','New Orleans',29.9546,-90.0751),
  ('70151','Orleans','New Orleans',29.9546,-90.0751),
  ('70152','Orleans','New Orleans',29.9546,-90.0751),
  ('70153','Orleans','New Orleans',29.9546,-90.0751),
  ('70154','Orleans','New Orleans',29.9546,-90.0751),
  ('70156','Orleans','New Orleans',29.9546,-90.0751),
  ('70157','Orleans','New Orleans',29.9546,-90.0751),
  ('70158','Orleans','New Orleans',29.9229,-90.0709),
  ('70159','Orleans','New Orleans',29.9546,-90.0751),
  ('70160','Orleans','New Orleans',29.9546,-90.0751),
  ('70161','Orleans','New Orleans',29.9546,-90.0751),
  ('70162','Orleans','New Orleans',29.9546,-90.0751),
  ('70163','Orleans','New Orleans',29.949981,-90.075462),
  ('70164','Orleans','New Orleans',29.9546,-90.0751),
  ('70165','Orleans','New Orleans',29.9546,-90.0751),
  ('70166','Orleans','New Orleans',29.9546,-90.0751),
  ('70167','Orleans','New Orleans',29.9546,-90.0751),
  ('70170','Orleans','New Orleans',29.9546,-90.0751),
  ('70172','Orleans','New Orleans',29.9546,-90.0751),
  ('70174','Orleans','New Orleans',29.9546,-90.0751),
  ('70175','Orleans','New Orleans',29.9546,-90.0751),
  ('70176','Orleans','New Orleans',29.9546,-90.0751),
  ('70177','Orleans','New Orleans',29.9546,-90.0751),
  ('70178','Orleans','New Orleans',29.9546,-90.0751),
  ('70179','Orleans','New Orleans',29.9546,-90.0751),
  ('70181','Jefferson','New Orleans',29.6779,-90.0901),
  ('70182','Orleans','New Orleans',29.9546,-90.0751),
  ('70183','Jefferson','New Orleans',29.9546,-90.0751),
  ('70184','Orleans','New Orleans',29.9546,-90.0751),
  ('70185','Orleans','New Orleans',29.9546,-90.0751),
  ('70186','Orleans','New Orleans',29.9546,-90.0751),
  ('70187','Orleans','New Orleans',29.9546,-90.0751),
  ('70189','Orleans','New Orleans',29.9546,-90.0751),
  ('70190','Orleans','New Orleans',29.9546,-90.0751),
  ('70195','Orleans','New Orleans',29.9546,-90.0751),
  ('70301','Lafourche','Thibodaux',29.808328,-90.750267),
  ('70302','Lafourche','Thibodaux',29.7958,-90.8229),
  ('70310','Lafourche','Thibodaux',29.790543,-90.802982),
  ('70339','Assumption','Pierre Part',29.904627,-91.184723),
  ('70340','St. Mary','Amelia',29.669742,-91.104288),
  ('70341','Assumption','Belle Rose',30.02649,-91.083333),
  ('70342','St. Mary','Berwick',29.693147,-91.23834),
  ('70343','Terrebonne','Bourg',29.548398,-90.557239),
  ('70344','Terrebonne','Chauvin',29.401184,-90.633055),
  ('70345','Lafourche','Cut Off',29.501844,-90.23789),
  ('70346','Ascension','Donaldsonville',30.10609,-91.017988),
  ('70352','Terrebonne','Donner',29.684424,-90.940194),
  ('70353','Terrebonne','Dulac',29.358143,-90.700118),
  ('70354','Lafourche','Galliano',29.43028,-90.342585),
  ('70355','Lafourche','Gheens',29.687187,-90.43547),
  ('70356','Terrebonne','Gibson',29.631566,-90.970879),
  ('70357','Lafourche','Golden Meadow',29.257799,-90.192019),
  ('70358','Jefferson','Grand Isle',29.214732,-90.027546),
  ('70359','Terrebonne','Gray',29.689847,-90.777822),
  ('70360','Terrebonne','Houma',29.578671,-90.805402),
  ('70361','Terrebonne','Houma',29.5958,-90.7195),
  ('70363','Terrebonne','Houma',29.506722,-90.700777),
  ('70364','Terrebonne','Houma',29.635994,-90.679678),
  ('70371','Lafourche','Kraemer',29.8652,-90.5962),
  ('70372','Assumption','Labadieville',29.782462,-90.988904),
  ('70373','Lafourche','Larose',29.597594,-90.311472),
  ('70374','Lafourche','Lockport',29.604507,-90.501988),
  ('70375','Lafourche','Mathews',29.695664,-90.531568),
  ('70377','Terrebonne','Montegut',29.459272,-90.532111),
  ('70380','St. Mary','Morgan City',29.752074,-91.103597),
  ('70381','St. Mary','Morgan City',29.6946,-91.2593),
  ('70390','Assumption','Napoleonville',29.890288,-91.03187),
  ('70391','Assumption','Paincourtville',29.995146,-91.060326),
  ('70392','St. Mary','Patterson',29.699424,-91.31847),
  ('70393','Assumption','Plattenville',29.995924,-90.99897),
  ('70394','Lafourche','Raceland',29.692681,-90.61612),
  ('70395','Terrebonne','Schriever',29.697436,-90.86173),
  ('70397','Terrebonne','Theriot',29.388473,-90.830994),
  ('70401','Tangipahoa','Hammond',30.533553,-90.455443),
  ('70402','Tangipahoa','Hammond',30.516501,-90.46926),
  ('70403','Tangipahoa','Hammond',30.485555,-90.487688),
  ('70404','Tangipahoa','Hammond',30.5046,-90.4629),
  ('70420','St. Tammany','Abita Springs',30.498753,-89.944416),
  ('70421','Tangipahoa','Akers',30.2902,-90.4018),
  ('70422','Tangipahoa','Amite',30.735737,-90.491513),
  ('70426','Washington','Angie',30.926497,-89.858614),
  ('70427','Washington','Bogalusa',30.744198,-89.912079),
  ('70429','Washington','Bogalusa',30.791,-89.8487),
  ('70431','St. Tammany','Bush',30.616752,-89.967363),
  ('70433','St. Tammany','Covington',30.462717,-90.140504),
  ('70434','St. Tammany','Covington',30.4755,-90.1004),
  ('70435','St. Tammany','Covington',30.556992,-90.106639),
  ('70436','Tangipahoa','Fluker',30.834554,-90.533106),
  ('70437','St. Tammany','Folsom',30.619429,-90.209454),
  ('70438','Washington','Franklinton',30.843721,-90.101029),
  ('70441','St. Helena','Greensburg',30.859967,-90.749066),
  ('70442','Tangipahoa','Husser',30.703049,-90.333198),
  ('70443','Tangipahoa','Independence',30.630554,-90.542882),
  ('70444','Tangipahoa','Kentwood',30.897005,-90.489375),
  ('70445','St. Tammany','Lacombe',30.371504,-89.892338),
  ('70446','Tangipahoa','Loranger',30.634711,-90.358474),
  ('70447','St. Tammany','Madisonville',30.421556,-90.207154),
  ('70448','St. Tammany','Mandeville',30.36218,-90.039451),
  ('70449','Livingston','Maurepas',30.273961,-90.670145),
  ('70450','Washington','Mount Hermon',30.942521,-90.261736),
  ('70451','Tangipahoa','Natalbany',30.549613,-90.481067),
  ('70452','St. Tammany','Pearl River',30.416894,-89.75483),
  ('70453','St. Helena','Pine Grove',30.685545,-90.782221),
  ('70454','Tangipahoa','Ponchatoula',30.362846,-90.358594),
  ('70455','Tangipahoa','Robert',30.529855,-90.323981),
  ('70456','Tangipahoa','Roseland',30.787059,-90.50462),
  ('70457','St. Tammany','St. Benedict',30.527464,-90.113355),
  ('70458','St. Tammany','Slidell',30.262007,-89.794167),
  ('70459','St. Tammany','Slidell',30.4255,-89.8813),
  ('70460','St. Tammany','Slidell',30.299875,-89.835997),
  ('70461','St. Tammany','Slidell',30.234038,-89.709634),
  ('70462','Livingston','Springfield',30.376279,-90.580741),
  ('70463','St. Tammany','Sun',30.65807,-89.903817),
  ('70464','St. Tammany','Talisheek',30.541322,-89.890516),
  ('70465','Tangipahoa','Tangipahoa',30.875781,-90.51384),
  ('70466','Tangipahoa','Tickfaw',30.568714,-90.500761),
  ('70467','Washington','Varnado',30.8938,-89.8295),
  ('70469','St. Tammany','Slidell',30.2752,-89.7812),
  ('70470','St. Tammany','Mandeville',30.4255,-89.8813),
  ('70471','St. Tammany','Mandeville',30.404287,-90.061307),
  ('70501','Lafayette','Lafayette',30.239007,-91.991284),
  ('70502','Lafayette','Lafayette',30.2241,-92.0198),
  ('70503','Lafayette','Lafayette',30.171005,-92.054782),
  ('70504','Lafayette','Lafayette',30.2139,-92.0187),
  ('70505','Lafayette','Lafayette',30.2023,-92.0188),
  ('70506','Lafayette','Lafayette',30.195834,-92.080781),
  ('70507','Lafayette','Lafayette',30.278324,-92.028037),
  ('70508','Lafayette','Lafayette',30.155238,-92.028225),
  ('70509','Lafayette','Lafayette',30.1565,-92),
  ('70510','Vermilion','Abbeville',29.894612,-92.193173),
  ('70511','Vermilion','Abbeville',29.9747,-92.1343),
  ('70512','St. Landry','Arnaudville',30.415729,-91.920497),
  ('70513','Iberia','Avery Island',29.899977,-91.903269),
  ('70514','St. Mary','Baldwin',29.845424,-91.557762),
  ('70515','Evangeline','Basile',30.452467,-92.577743),
  ('70516','Acadia','Branch',30.370902,-92.303577),
  ('70517','St. Martin','Breaux Bridge',30.290824,-91.786378),
  ('70518','Lafayette','Broussard',30.134691,-91.927341),
  ('70519','St. Martin','Cade',30.081749,-91.906967),
  ('70520','Lafayette','Carencro',30.329615,-92.033349),
  ('70521','St. Martin','Cecilia',30.3364,-91.8492),
  ('70522','St. Mary','Centerville',29.748439,-91.435682),
  ('70523','St. Mary','Charenton',29.872128,-91.530498),
  ('70524','Evangeline','Chataignier',30.557334,-92.318572),
  ('70525','Acadia','Church Point',30.408131,-92.217328),
  ('70526','Acadia','Crowley',30.210529,-92.378876),
  ('70527','Acadia','Crowley',30.2284,-92.3018),
  ('70528','Vermilion','Delcambre',29.884157,-91.959577),
  ('70529','Lafayette','Duson',30.202279,-92.16158),
  ('70531','Acadia','Egan',30.231157,-92.500746),
  ('70532','Jefferson Davis','Elton',30.4709,-92.697075),
  ('70533','Vermilion','Erath',29.901326,-92.031146),
  ('70534','Acadia','Estherwood',30.165634,-92.454959),
  ('70535','St. Landry','Eunice',30.471149,-92.419836),
  ('70537','Acadia','Evangeline',30.251631,-92.570201),
  ('70538','St. Mary','Franklin',29.80709,-91.487512),
  ('70540','St. Mary','Garden City',29.7633,-91.467),
  ('70541','St. Landry','Grand Coteau',30.420629,-92.042561),
  ('70542','Vermilion','Gueydan',30.009678,-92.584774),
  ('70543','Acadia','Iota',30.335404,-92.501138),
  ('70544','Iberia','Jeanerette',29.905016,-91.656399),
  ('70546','Jefferson Davis','Jennings',30.266368,-92.673552),
  ('70548','Vermilion','Kaplan',29.790545,-92.420528),
  ('70549','Jefferson Davis','Lake Arthur',30.046794,-92.832958),
  ('70550','St. Landry','Lawtell',30.515714,-92.189654),
  ('70551','St. Landry','Leonville',30.461914,-91.983452),
  ('70552','Iberia','Loreauville',30.042453,-91.659967),
  ('70554','Evangeline','Mamou',30.629478,-92.490928),
  ('70555','Vermilion','Maurice',30.086857,-92.143336),
  ('70556','Acadia','Mermentau',30.190636,-92.583797),
  ('70558','Lafayette','Milton',30.100525,-92.075759),
  ('70559','Acadia','Morse',30.139347,-92.508109),
  ('70560','Iberia','New Iberia',29.937141,-91.864508),
  ('70562','Iberia','New Iberia',30.0035,-91.8187),
  ('70563','Iberia','New Iberia',30.029251,-91.731591),
  ('70569','Iberia','Lydia',29.9239,-91.7831),
  ('70570','St. Landry','Opelousas',30.531941,-92.106967),
  ('70571','St. Landry','Opelousas',30.5335,-92.0815),
  ('70575','Vermilion','Perry',29.948922,-92.158095),
  ('70576','Evangeline','Pine Prairie',30.780968,-92.418253),
  ('70577','St. Landry','Port Barre',30.549507,-91.918752),
  ('70578','Acadia','Rayne',30.230073,-92.263673),
  ('70580','Evangeline','Reddell',30.675428,-92.428438),
  ('70581','Jefferson Davis','Roanoke',30.258119,-92.737129),
  ('70582','St. Martin','St. Martinville',30.163505,-91.775338),
  ('70583','Lafayette','Scott',30.261419,-92.124012),
  ('70584','St. Landry','Sunset',30.388058,-92.113453),
  ('70585','Evangeline','Turkey Creek',30.878323,-92.407716),
  ('70586','Evangeline','Ville Platte',30.727263,-92.356045),
  ('70589','St. Landry','Washington',30.684908,-92.044194),
  ('70591','Jefferson Davis','Welsh',30.257744,-92.832802),
  ('70592','Lafayette','Youngsville',30.077154,-92.017724),
  ('70593','Lafayette','Lafayette',30.2081,-92.0951),
  ('70596','Lafayette','Lafayette',30.2241,-92.0198),
  ('70598','Lafayette','Lafayette',30.2081,-92.0951),
  ('70601','Calcasieu','Lake Charles',30.226792,-93.215443),
  ('70602','Calcasieu','Lake Charles',30.2642,-93.3265),
  ('70605','Calcasieu','Lake Charles',30.129276,-93.273527),
  ('70606','Calcasieu','Lake Charles',30.2642,-93.3265),
  ('70607','Calcasieu','Lake Charles',30.038451,-93.190093),
  ('70609','Calcasieu','Lake Charles',30.179071,-93.21482),
  ('70611','Calcasieu','Lake Charles',30.348118,-93.2036),
  ('70612','Calcasieu','Lake Charles',30.2642,-93.3265),
  ('70615','Calcasieu','Lake Charles',30.254009,-93.117713),
  ('70616','Calcasieu','Lake Charles',30.2642,-93.3265),
  ('70629','Calcasieu','Lake Charles',30.231071,-93.21864),
  ('70630','Calcasieu','Bell City',30.03117,-93.059283),
  ('70631','Cameron','Cameron',29.853375,-93.568288),
  ('70632','Cameron','Creole',29.883232,-92.876911),
  ('70633','Calcasieu','DeQuincy',30.426005,-93.39129),
  ('70634','Beauregard','DeRidder',30.799649,-93.243292),
  ('70637','Beauregard','Dry Creek',30.707711,-92.974144),
  ('70638','Allen','Elizabeth',30.842711,-92.77199),
  ('70639','Vernon','Evans',30.983355,-93.497879),
  ('70640','Jefferson Davis','Fenton',30.365879,-92.916564),
  ('70643','Cameron','Grand Chenier',29.737191,-92.779067),
  ('70644','Allen','Grant',30.792345,-92.945596),
  ('70645','Cameron','Hackberry',29.928002,-93.473885),
  ('70646','Calcasieu','Hayes',30.105014,-92.932777),
  ('70647','Calcasieu','Iowa',30.247243,-93.015323),
  ('70648','Allen','Kinder',30.505073,-92.889361),
  ('70650','Jefferson Davis','Lacassine',30.233755,-92.920679),
  ('70651','Allen','Leblanc',30.571997,-92.960871),
  ('70652','Beauregard','Longville',30.613738,-93.247407),
  ('70653','Beauregard','Merryville',30.667604,-93.558664),
  ('70654','Allen','Mittie',30.6922,-92.87442),
  ('70655','Allen','Oberlin',30.625103,-92.717084),
  ('70656','Vernon','Pitkin',30.914161,-92.926727),
  ('70657','Beauregard','Ragley',30.500463,-93.140462),
  ('70658','Allen','Reeves',30.521695,-93.036234),
  ('70659','Vernon','Rosepine',30.921932,-93.284285),
  ('70660','Beauregard','Singer',30.57264,-93.460816),
  ('70661','Calcasieu','Starks',30.353644,-93.653664),
  ('70662','Beauregard','Sugartown',30.798103,-93.005982),
  ('70663','Calcasieu','Sulphur',30.278305,-93.40559),
  ('70664','Calcasieu','Sulphur',30.2642,-93.3265),
  ('70665','Calcasieu','Sulphur',30.121881,-93.451224),
  ('70668','Calcasieu','Vinton',30.175044,-93.605585),
  ('70669','Calcasieu','Westlake',30.242348,-93.272318),
  ('70704','East Baton Rouge','Baker',30.5159,-91.0804),
  ('70706','Livingston','Denham Springs',30.607238,-90.907361),
  ('70707','Ascension','Gonzales',30.2047,-90.8695),
  ('70710','West Baton Rouge','Addis',30.358232,-91.268832),
  ('70711','Livingston','Albany',30.524507,-90.592006),
  ('70712','West Feliciana','Angola',30.969575,-91.596702),
  ('70714','East Baton Rouge','Baker',30.587189,-91.127633),
  ('70715','Pointe Coupee','Batchelor',30.814542,-91.657426),
  ('70718','Ascension','Brittany',30.201,-90.8689),
  ('70719','West Baton Rouge','Brusly',30.363175,-91.299555),
  ('70721','Iberville','Carville',30.223391,-91.079505),
  ('70722','East Feliciana','Clinton',30.854787,-90.945939),
  ('70723','St. James','Convent',30.059602,-90.840237),
  ('70725','Ascension','Darrow',30.132614,-90.975919),
  ('70726','Livingston','Denham Springs',30.433416,-90.90231),
  ('70727','Livingston','Denham Springs',30.3375,-90.8434),
  ('70728','Ascension','Duplessis',30.2954,-90.9458),
  ('70729','West Baton Rouge','Erwinville',30.587693,-91.344857),
  ('70730','East Feliciana','Ethel',30.809925,-91.094653),
  ('70732','Pointe Coupee','Fordoche',30.635912,-91.585224),
  ('70733','Livingston','French Settlement',30.289843,-90.800199),
  ('70734','Ascension','Geismar',30.206556,-90.996999),
  ('70736','Pointe Coupee','Glynn',30.633975,-91.338448),
  ('70737','Ascension','Gonzales',30.226092,-90.92498),
  ('70738','Ascension','Burnside',30.1388,-90.924),
  ('70739','East Baton Rouge','Greenwell Springs',30.601066,-90.965337),
  ('70740','Iberville','Grosse Tete',30.317541,-91.435993),
  ('70743','St. James','Hester',30.025982,-90.770238),
  ('70744','Livingston','Holden',30.55941,-90.667123),
  ('70747','Pointe Coupee','Innis',30.87426,-91.672236),
  ('70748','East Feliciana','Jackson',30.815023,-91.206165),
  ('70749','Pointe Coupee','Jarreau',30.629553,-91.450662),
  ('70750','St. Landry','Krotz Springs',30.46394,-91.787529),
  ('70752','Pointe Coupee','Lakeland',30.595551,-91.41723),
  ('70753','Pointe Coupee','Lettsworth',30.638578,-91.683835),
  ('70754','Livingston','Livingston',30.40741,-90.75046),
  ('70755','Pointe Coupee','Livonia',30.594669,-91.529819),
  ('70756','Pointe Coupee','Lottie',30.531937,-91.642679),
  ('70757','Iberville','Maringouin',30.368748,-91.531236),
  ('70759','Pointe Coupee','Morganza',30.712455,-91.586374),
  ('70760','Pointe Coupee','New Roads',30.699747,-91.482689),
  ('70761','East Feliciana','Norwood',30.974954,-91.038279),
  ('70762','Pointe Coupee','Oscar',30.57834,-91.464653),
  ('70763','St. James','Paulina',30.048701,-90.736504),
  ('70764','Iberville','Plaquemine',30.234516,-91.307982),
  ('70765','Iberville','Plaquemine',30.2891,-91.2343),
  ('70767','West Baton Rouge','Port Allen',30.481128,-91.330712),
  ('70769','Ascension','Prairieville',30.30743,-90.940643),
  ('70770','East Baton Rouge','Pride',30.651321,-90.993161),
  ('70772','Iberville','Rosedale',30.437481,-91.464796),
  ('70773','Pointe Coupee','Rougon',30.596783,-91.373333),
  ('70774','Ascension','St. Amant',30.214554,-90.761905),
  ('70775','West Feliciana','St. Francisville',30.858253,-91.369),
  ('70776','Iberville','St. Gabriel',30.260016,-91.091026),
  ('70777','East Feliciana','Slaughter',30.73968,-91.07711),
  ('70778','Ascension','Sorrento',30.162173,-90.818825),
  ('70780','Iberville','Sunshine',30.298735,-91.185292),
  ('70782','West Feliciana','Tunica',30.951919,-91.511804),
  ('70783','Pointe Coupee','Ventress',30.669405,-91.416824),
  ('70784','West Feliciana','Wakefield',30.9175,-91.3581),
  ('70785','Livingston','Walker',30.557101,-90.819236),
  ('70786','Livingston','Watson',30.582437,-90.954355),
  ('70787','West Feliciana','Weyanoke',30.961632,-91.44071),
  ('70788','Iberville','White Castle',30.132093,-91.183796),
  ('70789','East Feliciana','Wilson',30.940581,-91.082957),
  ('70791','East Baton Rouge','Zachary',30.649627,-91.157635),
  ('70792','St. James','Uncle Sam',30.0279,-90.8028),
  ('70801','East Baton Rouge','Baton Rouge',30.449581,-91.185971),
  ('70802','East Baton Rouge','Baton Rouge',30.445471,-91.17527),
  ('70803','East Baton Rouge','Baton Rouge',30.410008,-91.174013),
  ('70804','East Baton Rouge','Baton Rouge',30.3863,-91.1339),
  ('70805','East Baton Rouge','Baton Rouge',30.488923,-91.158261),
  ('70806','East Baton Rouge','Baton Rouge',30.448797,-91.124704),
  ('70807','East Baton Rouge','Baton Rouge',30.555634,-91.208201),
  ('70808','East Baton Rouge','Baton Rouge',30.404146,-91.139137),
  ('70809','East Baton Rouge','Baton Rouge',30.394049,-91.07058),
  ('70810','East Baton Rouge','Baton Rouge',30.345423,-91.094293),
  ('70811','East Baton Rouge','Baton Rouge',30.537682,-91.134907),
  ('70812','East Baton Rouge','Baton Rouge',30.500175,-91.110497),
  ('70813','East Baton Rouge','Baton Rouge',30.527861,-91.197563),
  ('70814','East Baton Rouge','Baton Rouge',30.485018,-91.061669),
  ('70815','East Baton Rouge','Baton Rouge',30.455363,-91.066491),
  ('70816','East Baton Rouge','Baton Rouge',30.426892,-91.027834),
  ('70817','East Baton Rouge','Baton Rouge',30.375109,-90.980419),
  ('70818','East Baton Rouge','Baton Rouge',30.542313,-91.050102),
  ('70819','East Baton Rouge','Baton Rouge',30.47174,-91.007785),
  ('70820','East Baton Rouge','Baton Rouge',30.365415,-91.202669),
  ('70821','East Baton Rouge','Baton Rouge',30.4613,-91.0447),
  ('70822','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70823','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70825','East Baton Rouge','Baton Rouge',30.451972,-91.187756),
  ('70826','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70827','East Baton Rouge','Baton Rouge',30.4338,-91.0825),
  ('70831','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70833','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70835','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70836','East Baton Rouge','Baton Rouge',30.387574,-91.083564),
  ('70837','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70873','East Baton Rouge','Baton Rouge',30.5305,-91.1163),
  ('70874','East Baton Rouge','Baton Rouge',30.5902,-91.2054),
  ('70879','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70884','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70891','East Baton Rouge','Baton Rouge',30.4492,-91.1547),
  ('70892','East Baton Rouge','Baton Rouge',30.4507,-91.1546),
  ('70893','East Baton Rouge','Baton Rouge',30.413,-91.1715),
  ('70894','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70895','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70896','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('70898','East Baton Rouge','Baton Rouge',30.5159,-91.0804),
  ('71001','Bienville','Arcadia',32.591884,-92.911426),
  ('71002','Natchitoches','Ashland',32.120379,-93.11254),
  ('71003','Claiborne','Athens',32.629546,-93.030824),
  ('71004','Caddo','Belcher',32.741443,-93.860079),
  ('71006','Bossier','Benton',32.729183,-93.656132),
  ('71007','Caddo','Bethany',32.362527,-94.006751),
  ('71008','Bienville','Bienville',32.347123,-92.968651),
  ('71009','Caddo','Blanchard',32.578008,-93.891836),
  ('71016','Bienville','Castor',32.224441,-93.116314),
  ('71018','Webster','Cotton Valley',32.821036,-93.432601),
  ('71019','Red River','Coushatta',32.038461,-93.306638),
  ('71021','Webster','Cullen',32.967708,-93.446542),
  ('71023','Webster','Doyline',32.464514,-93.40458),
  ('71024','Webster','Dubberly',32.48892,-93.219881),
  ('71027','DeSoto','Frierson',32.246949,-93.686859),
  ('71028','Bienville','Gibsland',32.486338,-93.076046),
  ('71029','Caddo','Gilliam',32.836168,-93.833718),
  ('71030','DeSoto','Gloster',32.183671,-93.793639),
  ('71031','Natchitoches','Goldonna',32.007616,-92.897035),
  ('71032','DeSoto','Grand Cane',32.094865,-93.795369),
  ('71033','Caddo','Greenwood',32.439845,-94.00382),
  ('71034','Red River','Hall Summit',32.184222,-93.304168),
  ('71037','Bossier','Haughton',32.475082,-93.48762),
  ('71038','Claiborne','Haynesville',32.943192,-93.072935),
  ('71039','Webster','Heflin',32.430294,-93.2897),
  ('71040','Claiborne','Homer',32.783708,-92.998142),
  ('71043','Caddo','Hosston',32.886012,-93.887836),
  ('71044','Caddo','Ida',32.954178,-93.882456),
  ('71045','Bienville','Jamestown',32.335904,-93.162819),
  ('71046','DeSoto','Keatchie',32.172426,-93.935005),
  ('71047','Caddo','Keithville',32.302147,-93.905099),
  ('71048','Claiborne','Lisbon',32.835964,-92.850708),
  ('71049','DeSoto','Logansport',32.014274,-93.971246),
  ('71050','DeSoto','Longstreet',32.0977,-93.9521),
  ('71051','Bossier','Elm Grove',32.319454,-93.477953),
  ('71052','DeSoto','Mansfield',32.015449,-93.656448),
  ('71055','Webster','Minden',32.676883,-93.293312),
  ('71058','Webster','Minden',32.6154,-93.2868),
  ('71060','Caddo','Mooringsport',32.64095,-93.98931),
  ('71061','Caddo','Oil City',32.753997,-93.976297),
  ('71063','DeSoto','Pelican',31.911513,-93.514993),
  ('71064','Bossier','Plain Dealing',32.911171,-93.688336),
  ('71065','Sabine','Pleasant Hill',31.803198,-93.502679),
  ('71066','Natchitoches','Powhatan',31.874781,-93.198262),
  ('71067','Bossier','Princeton',32.61081,-93.463765),
  ('71068','Bienville','Ringgold',32.276729,-93.303455),
  ('71069','Caddo','Rodessa',32.971292,-93.988152),
  ('71070','Bienville','Saline',32.084929,-92.98803),
  ('71071','Webster','Sarepta',32.918355,-93.449941),
  ('71072','Webster','Shongaloo',32.938004,-93.312011),
  ('71073','Webster','Sibley',32.51414,-93.311486),
  ('71075','Webster','Springhill',32.991404,-93.479899),
  ('71078','DeSoto','Stonewall',32.278203,-93.797767),
  ('71079','Claiborne','Summerfield',32.95697,-92.808435),
  ('71080','Bienville','Taylor',32.366,-93.1011),
  ('71082','Caddo','Vivian',32.842181,-93.978352),
  ('71101','Caddo','Shreveport',32.505424,-93.748748),
  ('71102','Caddo','Shreveport',32.6076,-93.7526),
  ('71103','Caddo','Shreveport',32.491546,-93.771694),
  ('71104','Caddo','Shreveport',32.483775,-93.731646),
  ('71105','Caddo','Shreveport',32.455146,-93.709919),
  ('71106','Caddo','Shreveport',32.384654,-93.736285),
  ('71107','Caddo','Shreveport',32.589392,-93.861725),
  ('71108','Caddo','Shreveport',32.443173,-93.787826),
  ('71109','Caddo','Shreveport',32.467911,-93.813872),
  ('71110','Bossier','Barksdale AFB',32.500371,-93.630892),
  ('71111','Bossier','Bossier City',32.574458,-93.696292),
  ('71112','Bossier','Bossier City',32.448826,-93.645111),
  ('71113','Bossier','Bossier City',32.6276,-93.609),
  ('71115','Caddo','Shreveport',32.264471,-93.56293),
  ('71118','Caddo','Shreveport',32.393679,-93.804064),
  ('71119','Caddo','Shreveport',32.490669,-93.925462),
  ('71120','Caddo','Shreveport',32.6076,-93.7526),
  ('71129','Caddo','Shreveport',32.393039,-93.926716),
  ('71130','Caddo','Shreveport',32.6076,-93.7526),
  ('71133','Caddo','Shreveport',32.6076,-93.7526),
  ('71134','Caddo','Shreveport',32.6076,-93.7526),
  ('71135','Caddo','Shreveport',32.6076,-93.7526),
  ('71136','Caddo','Shreveport',32.6076,-93.7526),
  ('71137','Caddo','Shreveport',32.6076,-93.7526),
  ('71138','Caddo','Shreveport',32.6076,-93.7526),
  ('71148','Caddo','Shreveport',32.6076,-93.7526),
  ('71149','Caddo','Shreveport',32.6076,-93.7526),
  ('71150','Caddo','Shreveport',32.5056,-93.7434),
  ('71151','Caddo','Shreveport',32.6076,-93.7526),
  ('71152','Caddo','Shreveport',32.6076,-93.7526),
  ('71153','Caddo','Shreveport',32.6076,-93.7526),
  ('71154','Caddo','Shreveport',32.6076,-93.7526),
  ('71156','Caddo','Shreveport',32.6076,-93.7526),
  ('71161','Caddo','Shreveport',32.6076,-93.7526),
  ('71162','Caddo','Shreveport',32.6076,-93.7526),
  ('71163','Caddo','Shreveport',32.6076,-93.7526),
  ('71164','Caddo','Shreveport',32.6076,-93.7526),
  ('71165','Caddo','Shreveport',32.6076,-93.7526),
  ('71166','Caddo','Shreveport',32.6076,-93.7526),
  ('71171','Bossier','Bossier City',32.516,-93.7321),
  ('71172','Bossier','Bossier City',32.6276,-93.609),
  ('71201','Ouachita','Monroe',32.539557,-92.106941),
  ('71202','Ouachita','Monroe',32.399906,-92.05655),
  ('71203','Ouachita','Monroe',32.581991,-92.018572),
  ('71207','Ouachita','Monroe',32.5093,-92.1193),
  ('71209','Ouachita','Monroe',32.531362,-92.070982),
  ('71210','Ouachita','Monroe',32.4908,-92.1594),
  ('71211','Ouachita','Monroe',32.4908,-92.1594),
  ('71212','Ouachita','Monroe',32.526084,-92.074299),
  ('71213','Ouachita','Monroe',32.4908,-92.1594),
  ('71217','Ouachita','Monroe',32.5116,-92.0849),
  ('71218','Richland','Archibald',32.350797,-91.787398),
  ('71219','Franklin','Baskin',32.325706,-91.69322),
  ('71220','Morehouse','Bastrop',32.864539,-91.908541),
  ('71221','Morehouse','Bastrop',32.7562,-91.8723),
  ('71222','Union','Bernice',32.82922,-92.660475),
  ('71223','Morehouse','Bonita',32.89102,-91.67854),
  ('71225','Ouachita','Calhoun',32.50693,-92.350471),
  ('71226','Jackson','Chatham',32.250749,-92.437982),
  ('71227','Lincoln','Choudrant',32.529605,-92.474256),
  ('71229','Morehouse','Collinston',32.631923,-91.896808),
  ('71230','Franklin','Crowville',32.240305,-91.592824),
  ('71232','Richland','Delhi',32.414389,-91.496652),
  ('71233','Madison','Delta',32.325145,-90.931697),
  ('71234','Union','Downsville',32.64523,-92.330531),
  ('71235','Lincoln','Dubach',32.690015,-92.673804),
  ('71237','West Carroll','Epps',32.588352,-91.481055),
  ('71238','Jackson','Eros',32.363057,-92.375235),
  ('71240','Ouachita','Fairbanks',32.6443,-92.0365),
  ('71241','Union','Farmerville',32.779372,-92.352043),
  ('71242','West Carroll','Forest',32.792233,-91.412918),
  ('71243','Franklin','Fort Necessity',31.95173,-91.816093),
  ('71245','Lincoln','Grambling',32.526936,-92.71556),
  ('71247','Jackson','Hodge',32.271289,-92.720338),
  ('71249','Franklin','Jigger',32.0349,-91.7468),
  ('71250','Morehouse','Jones',32.958209,-91.572997),
  ('71251','Jackson','Jonesboro',32.220631,-92.67689),
  ('71253','West Carroll','Kilbourne',32.996085,-91.315728),
  ('71254','East Carroll','Lake Providence',32.807682,-91.235149),
  ('71256','Union','Lillie',32.947741,-92.70947),
  ('71259','Richland','Mangham',32.259266,-91.848657),
  ('71260','Union','Marion',32.907919,-92.234963),
  ('71261','Morehouse','Mer Rouge',32.778105,-91.694108),
  ('71263','West Carroll','Oak Grove',32.871845,-91.425837),
  ('71264','Morehouse','Oak Ridge',32.601281,-91.772528),
  ('71266','West Carroll','Pioneer',32.711035,-91.477007),
  ('71268','Jackson','Quitman',32.346067,-92.73702),
  ('71269','Richland','Rayville',32.440635,-91.793784),
  ('71270','Lincoln','Ruston',32.489856,-92.643874),
  ('71272','Lincoln','Ruston',32.529187,-92.651631),
  ('71273','Lincoln','Ruston',32.6065,-92.6484),
  ('71275','Lincoln','Simsboro',32.511899,-92.816833),
  ('71276','East Carroll','Sondheimer',32.581774,-91.159545),
  ('71277','Union','Spearsville',32.943343,-92.550972),
  ('71279','Richland','Start',32.486719,-91.856879),
  ('71280','Ouachita','Sterlington',32.717701,-92.101204),
  ('71281','Ouachita','Swartz',32.4908,-92.1594),
  ('71282','Madison','Tallulah',32.346878,-91.231932),
  ('71284','Madison','Tallulah',32.4085,-91.1868),
  ('71286','East Carroll','Transylvania',32.64739,-91.23319),
  ('71291','Ouachita','West Monroe',32.565188,-92.173211),
  ('71292','Ouachita','West Monroe',32.396681,-92.214761),
  ('71294','Ouachita','West Monroe',32.4908,-92.1594),
  ('71295','Franklin','Winnsboro',32.145309,-91.708966),
  ('71301','Rapides','Alexandria',31.274156,-92.467107),
  ('71302','Rapides','Alexandria',31.197018,-92.37022),
  ('71303','Rapides','Alexandria',31.281321,-92.547344),
  ('71306','Rapides','Alexandria',31.3113,-92.4451),
  ('71307','Rapides','Alexandria',31.2034,-92.5269),
  ('71309','Rapides','Alexandria',31.3047,-92.6196),
  ('71315','Rapides','Alexandria',31.1397,-92.3984),
  ('71316','Concordia','Acme',31.288968,-91.755272),
  ('71320','Avoyelles','Bordelonville',31.114482,-91.779108),
  ('71322','Avoyelles','Bunkie',30.871128,-92.175542),
  ('71323','Avoyelles','Center Point',31.26656,-92.210375),
  ('71324','Franklin','Chase',32.0971,-91.699),
  ('71325','Rapides','Cheneyville',31.016772,-92.336244),
  ('71326','Concordia','Clayton',31.772181,-91.585739),
  ('71327','Avoyelles','Cottonport',30.976902,-92.034859),
  ('71328','Rapides','Deville',31.357684,-92.188903),
  ('71329','Avoyelles','Dupont',30.9294,-91.9479),
  ('71330','Rapides','Echo',31.110023,-92.241499),
  ('71331','Avoyelles','Effie',31.252072,-92.065984),
  ('71333','Avoyelles','Evergreen',30.909986,-92.07187),
  ('71334','Concordia','Ferriday',31.668507,-91.581596),
  ('71336','Franklin','Gilbert',32.027122,-91.591595),
  ('71339','Avoyelles','Hamburg',31.005742,-91.936359),
  ('71340','Catahoula','Harrisonburg',31.759812,-91.80805),
  ('71341','Avoyelles','Hessmer',31.056111,-92.164117),
  ('71342','LaSalle','Jena',31.593716,-92.137601),
  ('71343','Catahoula','Jonesville',31.520809,-91.899171),
  ('71345','St. Landry','Lebeau',30.728356,-91.975451),
  ('71346','Rapides','Lecompte',31.118246,-92.374928),
  ('71348','Rapides','Libuse',31.3541,-92.3335),
  ('71350','Avoyelles','Mansura',31.066509,-92.060267),
  ('71351','Avoyelles','Marksville',31.184246,-91.960829),
  ('71353','St. Landry','Melville',30.612997,-91.767295),
  ('71354','Concordia','Monterey',31.404457,-91.750053),
  ('71355','Avoyelles','Moreauville',31.058397,-91.841215),
  ('71356','St. Landry','Morrow',30.835335,-92.02834),
  ('71357','Tensas','Newellton',32.118991,-91.299302),
  ('71358','St. Landry','Palmetto',30.716673,-91.84786),
  ('71359','Rapides','Pineville',31.324701,-92.426319),
  ('71360','Rapides','Pineville',31.324271,-92.354146),
  ('71361','Rapides','Pineville',31.3692,-92.4198),
  ('71362','Avoyelles','Plaucheville',30.899117,-91.961057),
  ('71363','Catahoula','Rhinehart',31.6377,-92.0068),
  ('71365','Rapides','Ruby',31.1894,-92.2487),
  ('71366','Tensas','St. Joseph',31.950193,-91.352398),
  ('71367','Evangeline','St. Landry',30.875518,-92.288288),
  ('71368','Catahoula','Sicily Island',31.879707,-91.681882),
  ('71369','Avoyelles','Simmesport',30.936543,-91.854161),
  ('71371','LaSalle','Trout',31.674053,-92.249684),
  ('71373','Concordia','Vidalia',31.375868,-91.585156),
  ('71375','Tensas','Waterproof',31.842335,-91.468245),
  ('71377','Concordia','Wildsville',31.6094,-91.7808),
  ('71378','Franklin','Wisner',31.942365,-91.708659),
  ('71401','Catahoula','Aimwell',31.794781,-91.944613),
  ('71403','Vernon','Anacoco',31.210416,-93.445374),
  ('71404','Winn','Atlanta',31.752115,-92.746016),
  ('71405','Rapides','Ball',31.409505,-92.40173),
  ('71406','Sabine','Belmont',31.734226,-93.505319),
  ('71407','Grant','Bentley',31.517243,-92.48646),
  ('71409','Rapides','Boyce',31.310753,-92.689221),
  ('71410','Winn','Calvin',31.964224,-92.771219),
  ('71411','Natchitoches','Campti',31.905455,-93.090534),
  ('71414','Natchitoches','Clarence',31.825687,-93.024517),
  ('71415','Caldwell','Clarks',32.025394,-92.142355),
  ('71416','Natchitoches','Cloutierville',31.540434,-92.896951),
  ('71417','Grant','Colfax',31.508204,-92.649646),
  ('71418','Caldwell','Columbia',32.137308,-92.048469),
  ('71419','Sabine','Converse',31.797619,-93.728964),
  ('71422','Winn','Dodson',32.076589,-92.657982),
  ('71423','Grant','Dry Prong',31.603431,-92.553342),
  ('71424','Rapides','Elmer',31.1795,-92.696673),
  ('71425','Catahoula','Enterprise',31.885091,-91.870687),
  ('71426','Sabine','Fisher',31.491792,-93.461665),
  ('71427','Rapides','Flatwoods',31.384968,-92.891088),
  ('71428','Natchitoches','Flora',31.609205,-93.088533),
  ('71429','Sabine','Florien',31.400435,-93.426223),
  ('71430','Rapides','Forest Hill',31.067683,-92.527582),
  ('71431','Rapides','Gardner',31.2587,-92.6775),
  ('71432','Grant','Georgetown',31.749577,-92.46771),
  ('71433','Rapides','Glenmora',31.00118,-92.639215),
  ('71434','Natchitoches','Gorum',31.442012,-92.942844),
  ('71435','Caldwell','Grayson',32.025951,-92.152261),
  ('71438','Rapides','Hineston',31.1018,-92.880251),
  ('71439','Vernon','Hornbeck',31.339524,-93.367906),
  ('71440','Winn','Joyce',31.9393,-92.5988),
  ('71441','Caldwell','Kelly',31.951551,-92.15343),
  ('71443','Vernon','Kurthwood',31.3374,-93.1657),
  ('71446','Vernon','Leesville',31.157403,-93.173885),
  ('71447','Rapides','Lena',31.411719,-92.81051),
  ('71448','Rapides','Longleaf',31.0066,-92.5526),
  ('71449','Sabine','Many',31.521833,-93.54044),
  ('71450','Natchitoches','Marthaville',31.779008,-93.398733),
  ('71452','Natchitoches','Melrose',31.582642,-92.945043),
  ('71454','Grant','Montgomery',31.69142,-92.858382),
  ('71455','Natchitoches','Mora',31.403448,-92.9895),
  ('71456','Natchitoches','Natchez',31.619037,-92.961449),
  ('71457','Natchitoches','Natchitoches',31.739201,-93.091426),
  ('71458','Natchitoches','Natchitoches',31.7476,-93.0791),
  ('71459','Vernon','Fort Polk',31.077352,-93.22042),
  ('71460','Sabine','Negreet',31.4693,-93.5749),
  ('71461','Vernon','New Llano',31.12101,-93.297735),
  ('71462','Sabine','Noble',31.669175,-93.736203),
  ('71463','Allen','Oakdale',30.808963,-92.647273),
  ('71465','LaSalle','Olla',31.871987,-92.203887),
  ('71466','Rapides','Otis',31.215909,-92.748853),
  ('71467','Grant','Pollock',31.563329,-92.387104),
  ('71468','Natchitoches','Provencal',31.475874,-93.138491),
  ('71469','Natchitoches','Robeline',31.694472,-93.270631),
  ('71471','Winn','St. Maurice',31.7596,-92.959),
  ('71472','Rapides','Sieper',31.168851,-92.787163),
  ('71473','Winn','Sikes',32.068969,-92.429741),
  ('71474','Vernon','Simpson',31.277182,-93.014278),
  ('71475','Vernon','Slagle',31.201296,-93.1246),
  ('71477','Rapides','Tioga',31.3999,-92.6042),
  ('71479','LaSalle','Tullos',31.857738,-92.353053),
  ('71480','LaSalle','Urania',31.869951,-92.279136),
  ('71483','Winn','Winnfield',31.892384,-92.657875),
  ('71485','Rapides','Woodworth',31.173893,-92.520418),
  ('71486','Sabine','Zwolle',31.627595,-93.658762),
  ('71496','Vernon','Leesville',31.1435,-93.261),
  ('71497','Natchitoches','Natchitoches',31.749019,-93.097965),
  ('71749','Union','Junction City',33.071881,-92.818579)ON CONFLICT (zip_code) DO UPDATE
  SET parish    = EXCLUDED.parish,
      city      = EXCLUDED.city,
      latitude  = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude;

COMMENT ON TABLE public.louisiana_zip_parishes IS
  'Every Louisiana ZIP code (720) with its parish and an approximate centroid. '
  'Complete as of 2026-09-06 from the GeoNames US postal dataset, cross-checked '
  'row by row against the US Census 2020 ZCTA-to-County relationship file. This '
  'is the location mechanism that works for every member — a device fix exists '
  'only for those who grant the permission — so get_parish_for_zip() is what '
  'places a member, and profiles.parish is DERIVED '
  'from this table by a trigger rather than supplied by any client. A ZIP absent '
  'from here resolves to a NULL parish, which no job fan-out reaches — so this '
  'table must stay COMPLETE, not merely non-empty.';

COMMENT ON COLUMN public.louisiana_zip_parishes.latitude IS
  'APPROXIMATE ZIP centroid — NOT a precise position, and NOT population-'
  'weighted. Census 2024 ZCTA Gazetteer internal point (540 rows: a point '
  'guaranteed to lie inside the ZCTA polygon) or, for PO-box/unique ZIPs with no '
  'ZCTA, the GeoNames delivery-office point (180 rows). Every account in a ZIP '
  'shares this one point, and in large rural ZIPs it can sit 20-30km from the '
  'town. Correct for coarse radius filtering ("within 25 miles") as the fallback '
  'tier when a member declines device geolocation. NEVER copy onto '
  'profiles.latitude, which means a real device fix; NEVER use for sub-mile '
  'distance, proximity ranking between two members of the same ZIP, or anything '
  'a user is shown as their location.';

COMMENT ON COLUMN public.louisiana_zip_parishes.longitude IS
  'See louisiana_zip_parishes.latitude — same source, same approximation, same '
  'prohibition on being treated as a precise position.';

-- Assert the shape rather than trusting the row list above. A truncated or
-- mangled VALUES block would otherwise apply cleanly and leave a table that
-- still looks plausible — which is exactly how the 252-row sample survived.
DO $$
DECLARE
  v_rows int; v_parishes int; v_bad_parish int; v_no_centroid int; v_off_map int;
BEGIN
  SELECT count(*), count(DISTINCT parish),
         count(*) FILTER (WHERE parish IS NULL OR btrim(parish) = ''),
         count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL),
         -- Louisiana's bounding box, with 71749 (Junction City) the one
         -- deliberate exception explained in the header.
         count(*) FILTER (WHERE zip_code <> '71749' AND NOT (
           latitude BETWEEN 28.85 AND 33.05 AND longitude BETWEEN -94.10 AND -88.70))
    INTO v_rows, v_parishes, v_bad_parish, v_no_centroid, v_off_map
    FROM public.louisiana_zip_parishes;

  IF v_rows <> 720 THEN
    RAISE EXCEPTION 'louisiana_zip_parishes holds % rows, expected 720', v_rows;
  END IF;
  IF v_parishes <> 64 THEN
    RAISE EXCEPTION 'louisiana_zip_parishes covers % parishes, expected 64', v_parishes;
  END IF;
  IF v_bad_parish <> 0 THEN
    RAISE EXCEPTION '% rows carry an empty parish', v_bad_parish;
  END IF;
  IF v_no_centroid <> 0 THEN
    RAISE EXCEPTION '% rows have no centroid', v_no_centroid;
  END IF;
  IF v_off_map <> 0 THEN
    RAISE EXCEPTION '% centroids fall outside Louisiana', v_off_map;
  END IF;

  -- The row this migration exists for.
  IF public.get_parish_for_zip('70528') IS DISTINCT FROM 'Vermilion' THEN
    RAISE EXCEPTION '70528 (Delcambre) resolves to %, expected Vermilion',
      coalesce(public.get_parish_for_zip('70528'), '<null>');
  END IF;
  -- Three rows the original seed got wrong and 20260904211910 repaired. A
  -- full-table upsert is exactly what could silently regress them.
  IF public.get_parish_for_zip('71019') IS DISTINCT FROM 'Red River' THEN
    RAISE EXCEPTION '71019 (Coushatta) regressed off Red River';
  END IF;
  IF public.get_parish_for_zip('71055') IS DISTINCT FROM 'Webster' THEN
    RAISE EXCEPTION '71055 (Minden) regressed off Webster';
  END IF;
  IF public.get_parish_for_zip('70301') IS DISTINCT FROM 'Lafourche' THEN
    RAISE EXCEPTION '70301 (Thibodaux) regressed off Lafourche';
  END IF;
END $$;
