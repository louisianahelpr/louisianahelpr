import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { MapJob } from "./config";

/**
 * The map's pin set: one read of `get_open_jobs_for_map`, re-run when the
 * viewer changes, when `retry()` is pressed, or when `refreshKey` moves.
 * Moved out of BrowseMap.tsx (component-size ratchet) with no change of
 * behaviour.
 *
 * The pin RPC used to fail SILENTLY: `if (error) { report(...); return; }`
 * left `jobs` at [], so a 500 rendered the "Empty map for now." card — the
 * map told the user Louisiana had no work when in truth the query died.
 * That is the exact failure CLAUDE.md's "never drop the Supabase error"
 * rule exists to stop, and the error-state sweep caught it on /home's
 * map view (SILENT_FAILURE: 36 failed requests, no failure wording, no way
 * out). `loadError` is tracked explicitly so the map can say so and offer a retry.
 */
export function useMapJobs(currentUserId: string | undefined, refreshKey: number | undefined) {
  const [jobs, setJobs] = useState<MapJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /** Bumped by the retry button to re-run the fetch effect. */
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("get_open_jobs_for_map")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          report(error, { tags: { source: "BrowseMap.rpc" } });
          setLoadError(true);
          setLoading(false);
          return;
        }
        setLoadError(false);
        const rows = (data as MapJob[] | null) ?? [];
        // Defensive: drop any rows that snuck through with null coords
        // despite the SQL filter (e.g. type coercion oddness).
        // The RPC doesn't expose customer_id (PII concern), so we can't
        // filter "my own posts" client-side — that's fine since
        // handleApplyRequest in Dashboard already bails out with a
        // "you can't apply to your own post" toast on attempt.
        const cleaned = rows.filter(
          (j) => j.latitude !== null && j.longitude !== null && !Number.isNaN(Number(j.latitude)),
        );
        setJobs(cleaned);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, reloadNonce, refreshKey]);

  const retry = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    setReloadNonce((n) => n + 1);
  }, []);

  return { jobs, loading, loadError, retry };
}
