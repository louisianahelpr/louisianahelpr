import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { categoryPricing } from "@/lib/pricingGuide";

// Smart Pricing Guidance — pulls a price range for a job category from
// the budgets of *real completed jobs* (via the get_category_price_stats
// RPC) so the post form can hint at what actually fills, not a static
// hand-maintained table.
//
// Graceful degradation is the whole point of the `source` field:
//   - "live"   — the RPC answered with a real percentile range.
//   - "static" — the RPC is missing (migration not yet applied to this
//                environment, PGRST202) OR there simply isn't enough
//                completed-job data; we fall back to categoryPricing so
//                the poster still sees a sensible range.
// The UI uses `source`/`parishMatch` only to phrase the hint honestly —
// it never blocks the form on this.

export interface CategoryPriceStats {
  /** Lower bound of the suggested range, in whole dollars. */
  min: number;
  /** Upper bound of the suggested range, in whole dollars. */
  max: number;
  /** Typical (median) price when available, in whole dollars. */
  median: number | null;
  /** How many completed jobs the live range was computed from. */
  sampleCount: number;
  /** True when the live range was scoped to the poster's parish. */
  parishMatch: boolean;
  /** Where the numbers came from — drives how the hint is worded. */
  source: "live" | "static";
}

// A live range needs at least this many completed jobs behind it before
// we'd rather show it than the static fallback. Below this the RPC's own
// numbers are too noisy to phrase as "jobs like this pay $X–$Y".
const MIN_LIVE_SAMPLE = 3;

function staticStats(category: string): CategoryPriceStats {
  const fallback = categoryPricing[category] ?? categoryPricing.other;
  return {
    min: fallback.min,
    max: fallback.max,
    median: null,
    sampleCount: 0,
    parishMatch: false,
    source: "static",
  };
}

const toNum = (v: number | string | null): number | null => {
  if (v === null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolves a price-guidance range for a job category, preferring real
 * completed-job data and falling back to the static pricing guide.
 *
 * @param category Job category slug (e.g. "cleaning"). Empty disables.
 * @param parish   Optional parish to narrow the sample to.
 */
export function useCategoryPriceStats(
  category: string,
  parish: string | null,
): { stats: CategoryPriceStats | null; loading: boolean } {
  const [stats, setStats] = useState<CategoryPriceStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!category) {
      setStats(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_category_price_stats", {
          p_category: category,
          p_parish: parish ?? undefined,
        });
        if (cancelled) return;

        if (error) {
          // RPC not deployed yet (migration not applied to this
          // environment) — degrade silently to the static guide.
          setStats(staticStats(category));
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        const p25 = row ? toNum(row.p25) : null;
        const p75 = row ? toNum(row.p75) : null;
        const sampleCount = row?.sample_count ?? 0;

        // Not enough real data to trust — show the static range instead.
        if (!row || p25 === null || p75 === null || sampleCount < MIN_LIVE_SAMPLE) {
          setStats(staticStats(category));
          return;
        }

        const median = toNum(row.p50);
        setStats({
          min: Math.round(p25),
          max: Math.round(p75),
          median: median !== null ? Math.round(median) : null,
          sampleCount,
          parishMatch: row.parish_match === true,
          source: "live",
        });
      } catch {
        if (!cancelled) setStats(staticStats(category));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [category, parish]);

  return { stats, loading };
}
