-- Sales tax was silently NOT collected in DeSoto and LaSalle parishes.
--
-- Two tables spell the same parish differently, and the lookup between them is
-- an exact `=`, so it misses and the miss degrades to a rate of zero. No error,
-- no warning, no flag on the job — the poster is simply quoted and charged $0
-- sales tax on a taxable job.
--
-- Verified on prod before writing this:
--
--   louisiana_zip_parishes.parish   'DeSoto'   (4 zips)   'LaSalle'  (3 zips)
--   parish_tax_rates.parish_name    'De Soto'             'La Salle'
--
--   rate via the exact match the code performs .......... NULL, NULL
--   rate if the two names agreed ....................... 10.00%, 10.50%
--
-- Louisiana's own official parish names are DeSoto and LaSalle — no space —
-- so `parish_tax_rates` is the table holding the wrong spelling, and it is the
-- one that moves. Correcting the ZIP table instead would fix the join and leave
-- 7 ZIPs disagreeing with the state's naming everywhere else they are shown.
--
-- Scope: 2 rows. Every other parish already matches — coverage is 64/64 with no
-- null rates, and total_rate = state_rate + local_rate throughout.
--
-- Replay-safe: keyed on the exact wrong value, so a re-run after the names are
-- already correct updates nothing. Guarded on the table existing for a
-- from-scratch rebuild.

DO $$
BEGIN
  IF to_regclass('public.parish_tax_rates') IS NULL THEN
    RAISE NOTICE 'parish_tax_rates not present — skipping';
    RETURN;
  END IF;

  UPDATE public.parish_tax_rates SET parish_name = 'DeSoto'  WHERE parish_name = 'De Soto';
  UPDATE public.parish_tax_rates SET parish_name = 'LaSalle' WHERE parish_name = 'La Salle';

  -- Fail LOUD if this did not achieve the join it exists to achieve. A silent
  -- no-op here would restore exactly the condition being fixed: a tax lookup
  -- that returns nothing and is read as zero.
  IF EXISTS (
    SELECT 1 FROM public.louisiana_zip_parishes z
    WHERE NOT EXISTS (
      SELECT 1 FROM public.parish_tax_rates r WHERE r.parish_name = z.parish
    )
  ) THEN
    RAISE EXCEPTION 'parish name mismatch remains: % ',
      (SELECT string_agg(DISTINCT z.parish, ', ')
         FROM public.louisiana_zip_parishes z
        WHERE NOT EXISTS (
          SELECT 1 FROM public.parish_tax_rates r WHERE r.parish_name = z.parish
        ));
  END IF;
END $$;
