import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The combined (state + local) Louisiana sales-tax rate for a parish.
 *
 * `parish_tax_rates` has been seeded with all 64 parishes since 2026-04 and is
 * world-readable (`Anyone can read parish tax rates`), but until now NOTHING
 * read it except the admin editor — the checkout screen invented a flat
 * "about 9-11%" range instead. This hook is what makes the seeded data reach
 * the poster.
 *
 * Returns `null` (not a guess) when the parish isn't known yet or has no row,
 * so callers say "set by your parish" rather than quoting a made-up rate.
 *
 * Cached for the session: parish rates change on the order of once a year, and
 * re-querying on every keystroke of the zip field would be pure waste.
 */
export function useParishTaxRate(parish: string | null | undefined): {
  /** Combined state + local rate as a percentage, e.g. 10.5 — or null. */
  totalRatePercent: number | null;
  loading: boolean;
} {
  const key = parish?.trim() || null;
  const { data, isLoading } = useQuery({
    queryKey: ["parish-tax-rate", key],
    enabled: !!key,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const row = unwrap(
        await supabase
          .from("parish_tax_rates")
          .select("total_rate")
          // The table stores bare parish names ("East Baton Rouge"), and the
          // zip lookup returns the same shape. `maybeSingle` so an unseeded
          // parish is a null rate, not a thrown error that blanks the total.
          .eq("parish_name", key!)
          .maybeSingle(),
      );
      const rate = row?.total_rate;
      return typeof rate === "number" && rate > 0 ? rate : null;
    },
  });

  return { totalRatePercent: key ? (data ?? null) : null, loading: !!key && isLoading };
}
