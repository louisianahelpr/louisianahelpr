import { useEffect, useState } from "react";

/**
 * How long a page's first paint may wait on its SECONDARY data (ratings, poster
 * names, tiers) once the primary list is in. Past this the list paints anyway,
 * so a slow or failing enrichment call can never hold a page on its skeleton.
 */
export const ARRIVAL_CAP_MS = 1500;

/**
 * ONE SETTLED PAINT for a screen built from more than one query (Q169).
 *
 * Owner, 2026-09-23: the browse page "loads, jumps, more cards appear, it loads
 * again". Measured on a production build against prod at 375 (Fast 3G, 4x CPU):
 * the job list painted, then ~400ms later the poster enrichment landed, the
 * ranking re-read each poster's tier, and cards swapped places under the
 * reader's eye. Two queries, two paints — the list arrived twice.
 *
 * The rule this hook enforces: the skeleton stays until the primary query is
 * in AND every secondary query has SETTLED (success or error — a failure is an
 * answer too), then everything paints in one commit. `capMs` bounds the wait
 * for the secondary data, so a hung enrichment call costs at most that long.
 *
 * It LATCHES: once the page has painted, a background refetch or a later
 * secondary query never puts the skeleton back.
 *
 * Guard: src/test/listArrivesInOneWave.test.ts.
 */
export function useArrivalGate(
  primaryReady: boolean,
  secondaryReady: boolean,
  capMs: number = ARRIVAL_CAP_MS,
): boolean {
  const [capped, setCapped] = useState(false);
  const [latched, setLatched] = useState(false);
  const ready = latched || (primaryReady && (secondaryReady || capped));

  useEffect(() => {
    if (ready && !latched) setLatched(true);
  }, [ready, latched]);

  useEffect(() => {
    if (!primaryReady || secondaryReady || latched) return;
    const t = setTimeout(() => setCapped(true), capMs);
    return () => clearTimeout(t);
  }, [primaryReady, secondaryReady, latched, capMs]);

  return ready;
}
