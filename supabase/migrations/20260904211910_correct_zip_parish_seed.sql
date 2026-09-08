-- Correct the Louisiana ZIP→parish seed: 28 wrong parishes, 19 wrong city labels.
--
-- The seed in 20260418042714 was hand-written and 11% of its live rows map a ZIP
-- to the wrong parish. Full audit and evidence: docs/ZIP_SEED_AUDIT_2026-09-04.md.
-- All 260 rows were checked against two independent sources — the GeoNames US
-- postal dataset (programmatic diff, 0 not-found) and the US Census 2020
-- ZCTA-to-County relationship file — which flagged the identical row set.
--
-- ── Why UPDATE ... FROM (VALUES), and not another INSERT ────────────────────
--
-- The original seed used `ON CONFLICT (zip_code) DO NOTHING`, and that is not an
-- incidental detail: eight rows in it collide on the primary key, so `DO NOTHING`
-- silently discarded the loser — and for three of them the DISCARDED row was the
-- correct one. That is how Minden (seat of Webster) and Coushatta (seat of Red
-- River) ended up filed under the wrong parish, with no error anywhere.
--
-- Re-running a corrected INSERT with the same clause would fail the same way: the
-- conflicting row already exists, so DO NOTHING would skip the correction too.
-- An UPDATE keyed on zip_code cannot no-op silently, is idempotent, and is
-- replay-safe on a from-scratch rebuild.
--
-- ── What this does NOT touch ────────────────────────────────────────────────
--
-- 19 ZIPs genuinely straddle a parish line. A ZIP is a postal delivery route,
-- not a civic boundary, so "correcting" one to a single side would be a new
-- wrong answer rather than a repair. Left exactly as seeded, listed here so the
-- next reader does not re-open them (minority share in brackets):
--
--   70364  Houma            keep Terrebonne         (Lafourche 41.9%)
--   71322  Bunkie           keep Avoyelles          (St. Landry 44.1%)
--   71270  Ruston           keep Lincoln            (Jackson 38.6%)
--   70380  Morgan City      keep St. Mary           (Assumption 39% / St. Martin 28.5% (land); St. Mary is USPS+populated)
--   70422  Amite            keep Tangipahoa         (St. Helena 35.9%)
--   70443  Independence     keep Tangipahoa         (Livingston 33.1%)
--   70706  Denham Springs   keep Livingston         (St. Helena 26.7%)
--   70437  Folsom           keep St. Tammany        (Tangipahoa 24.0%)
--   70346  Donaldsonville   keep Ascension          (Assumption 20.8%)
--   71343  Jonesville       keep Catahoula          (Concordia 18.3% / LaSalle 17.4%)
--   71469  Robeline         keep Natchitoches       (Sabine 15.6%)
--   70744  Holden           keep Livingston         (St. Helena 14.6%)
--   70403  Hammond          keep Tangipahoa         (Livingston 13.9%)
--   71251  Jonesboro        keep Jackson            (Bienville 13.8%)
--   70339  Pierre Part      keep Assumption         (St. Martin 13.0%)
--   71046  Keatchie         keep DeSoto             (Caddo 12.7%)
--   71360  Pineville        keep Rapides            (Avoyelles 10.5%)
--   70512  Arnaudville      keep St. Landry         (St. Martin (USPS primary is St. Landry))
--   70535  Eunice           keep St. Landry         (SOURCES DISAGREE: USPS primary St. Landry; land area Acadia 53.7% / St. Landry 27.5%)
--
-- ── One judgement call, stated rather than buried ───────────────────────────
--
-- 71232 (Delhi) is the only correction resting on which measure you trust.
-- GeoNames, the USPS assignment and the town's own location all say Richland;
-- the Census land-area plurality is Madison 46% / Richland 31% / Franklin 22%.
-- Delhi's POPULATION is in Richland, which is the answer that matters for a
-- parish-matched jobs app. The other 27 are unanimous across both sources.
--
-- ── Blast radius ────────────────────────────────────────────────────────────
--
-- `jobs.parish` and `profiles.parish` are written from `get_parish_for_zip`, so
-- these errors corrupt discovery, parish analytics and parish-targeted
-- marketing. NOT tax: `parish_tax_rates` does not exist, nothing reads it, and
-- Stripe computes tax from the address. Zero rows are affected today because
-- production holds only seed and test data — which is the argument for doing
-- this now rather than after launch.
--
-- Every `parish` value below already exists in src/lib/parishes.ts with this
-- exact spelling, so the registry needs no new entry and parishes.test.ts is
-- unaffected.

-- ── 28 wrong parishes (city corrected alongside where it was also wrong) ─────
UPDATE public.louisiana_zip_parishes AS t
   SET parish = v.parish, city = v.city
  FROM (VALUES
    ('70030', 'St. Charles', 'Des Allemands'),
    ('70049', 'St. John the Baptist', 'Edgard'),
    ('70301', 'Lafourche', 'Thibodaux'),
    ('70444', 'Tangipahoa', 'Kentwood'),
    ('70518', 'Lafayette', 'Broussard'),
    ('70638', 'Allen', 'Elizabeth'),
    ('70656', 'Vernon', 'Pitkin'),
    ('71016', 'Bienville', 'Castor'),
    ('71018', 'Webster', 'Cotton Valley'),
    ('71019', 'Red River', 'Coushatta'),
    ('71024', 'Webster', 'Dubberly'),
    ('71027', 'DeSoto', 'Frierson'),
    ('71033', 'Caddo', 'Greenwood'),
    ('71055', 'Webster', 'Minden'),
    ('71064', 'Bossier', 'Plain Dealing'),
    ('71068', 'Bienville', 'Ringgold'),
    ('71223', 'Morehouse', 'Bonita'),
    ('71225', 'Ouachita', 'Calhoun'),
    ('71232', 'Richland', 'Delhi'),
    ('71261', 'Morehouse', 'Mer Rouge'),
    ('71275', 'Lincoln', 'Simsboro'),
    ('71286', 'East Carroll', 'Transylvania'),
    ('71316', 'Concordia', 'Acme'),
    ('71366', 'Tensas', 'St. Joseph'),
    ('71377', 'Concordia', 'Wildsville'),
    ('71411', 'Natchitoches', 'Campti'),
    ('71473', 'Winn', 'Sikes'),
    ('71474', 'Vernon', 'Simpson')
  ) AS v(zip_code, parish, city)
 WHERE t.zip_code = v.zip_code;

-- ── 19 rows where the parish was right and only the city label was wrong ────
UPDATE public.louisiana_zip_parishes AS t
   SET city = v.city
  FROM (VALUES
    ('70039', 'St. Charles', 'Boutte'),
    ('70051', 'St. John the Baptist', 'Garyville'),
    ('70079', 'St. Charles', 'Norco'),
    ('70085', 'St. Bernard', 'St. Bernard'),
    ('70086', 'St. James', 'St. James'),
    ('70092', 'St. Bernard', 'Violet'),
    ('70381', 'St. Mary', 'Morgan City'),
    ('70442', 'Tangipahoa', 'Husser'),
    ('70443', 'Tangipahoa', 'Independence'),
    ('70576', 'Evangeline', 'Pine Prairie'),
    ('70651', 'Allen', 'Leblanc'),
    ('70732', 'Pointe Coupee', 'Fordoche'),
    ('70738', 'Ascension', 'Burnside'),
    ('71046', 'DeSoto', 'Keatchie'),
    ('71073', 'Webster', 'Sibley'),
    ('71243', 'Franklin', 'Fort Necessity'),
    ('71263', 'West Carroll', 'Oak Grove'),
    ('71375', 'Tensas', 'Waterproof'),
    ('71410', 'Winn', 'Calvin')
  ) AS v(zip_code, parish, city)
 WHERE t.zip_code = v.zip_code
   AND t.parish = v.parish;

-- ── Prove it landed ─────────────────────────────────────────────────────────
--
-- A silent no-op is exactly the failure this migration exists to undo, so it
-- refuses to pass quietly. Spot-checks the three collision rows whose correct
-- value was thrown away, plus the row that started the whole audit.
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM (VALUES
    ('70301', 'Lafourche'),
    ('71019', 'Red River'),
    ('71055', 'Webster'),
    ('71366', 'Tensas'),
    ('71068', 'Bienville'),
    ('71232', 'Richland')
  ) AS expect(zip_code, parish)
  LEFT JOIN public.louisiana_zip_parishes t ON t.zip_code = expect.zip_code
  WHERE t.parish IS DISTINCT FROM expect.parish;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'zip seed correction did not land: % spot-checked row(s) still wrong', v_bad;
  END IF;
END;
$$;
