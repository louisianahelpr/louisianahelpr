import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import type { FillRateRow, FillRateSummary, FillSortKey, FillDays } from "./types";

export const useFillRate = () => {
  const [fillDays, setFillDays] = useState<FillDays>(30);
  const [fillSort, setFillSort] = useState<FillSortKey>("fill_rate_pct");
  const [fillSortAsc, setFillSortAsc] = useState(true);

  // Fill-rate stats — separate query keyed by p_days so changing the
  // period refetches without invalidating the rest of AdminHealth.
  const fillQueryKey = ["admin-fill-rate", fillDays];
  const { data: fillData, isFetching: fillFetching } = useInstantQuery<FillRateSummary>({
    key: fillQueryKey,
    fallback: {
      total_jobs: 0, filled_jobs: 0, fill_rate_pct: null,
      median_minutes_to_first_app: null, parishes: [], available: true,
    },
    fetcher: async () => {
      const { data, error } = await supabase.rpc("get_fill_rate_stats", { p_days: fillDays });
      // PGRST202 = function not deployed yet — hide the section gracefully.
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") {
          return {
            total_jobs: 0, filled_jobs: 0, fill_rate_pct: null,
            median_minutes_to_first_app: null, parishes: [], available: false,
          };
        }
        throw error;
      }
      const rows = (data ?? []) as FillRateRow[];
      // First row (parish IS NULL) is the overall summary.
      const overall = rows.find((r) => r.parish === null);
      const parishRows = rows.filter((r) => r.parish !== null);
      return {
        total_jobs: overall?.total_jobs ?? 0,
        filled_jobs: overall?.filled_jobs ?? 0,
        fill_rate_pct: overall?.fill_rate_pct ?? null,
        median_minutes_to_first_app: overall?.median_minutes_to_first_app ?? null,
        parishes: parishRows.map((r) => ({
          parish: r.parish!,
          total_jobs: r.total_jobs ?? 0,
          filled_jobs: r.filled_jobs ?? 0,
          fill_rate_pct: r.parish_fill_rate_pct ?? null,
        })),
        available: true,
      };
    },
  });

  const sortedParishes = useMemo(() => {
    if (!fillData?.parishes) return [];
    return [...fillData.parishes].sort((a, b) => {
      const av = fillSort === "fill_rate_pct" ? (a.fill_rate_pct ?? -1) : a.total_jobs;
      const bv = fillSort === "fill_rate_pct" ? (b.fill_rate_pct ?? -1) : b.total_jobs;
      return fillSortAsc ? av - bv : bv - av;
    });
  }, [fillData?.parishes, fillSort, fillSortAsc]);

  const handleFillSort = (key: FillSortKey) => {
    if (fillSort === key) setFillSortAsc((p) => !p);
    else { setFillSort(key); setFillSortAsc(key === "fill_rate_pct"); }
  };

  return { fillDays, setFillDays, fillSort, fillSortAsc, fillData, fillFetching, sortedParishes, handleFillSort };
};
