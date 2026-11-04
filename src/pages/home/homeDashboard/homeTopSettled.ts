import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { usePosterFirstJob } from "./PosterFirstJobCard";

/**
 * Q2706/Q2708 (Builder 3, 11-04): Home's first-week cards (FirstJobHome / PosterFirstJobCard) sit ABOVE Next up, and
 * each is drawn only once its read answers. Live lab (dpl_DatvNXtz, helper persona, Fast 4G 375, 3 runs) measured the
 * poster card arriving after the rest of Home was on screen and pushing Next up, Coming up and Your sections down
 * ~200 px: a 0.20 layout shift, the largest of /home's 0.38. A first visit has no saved height to hold
 * (reservedHeight.ts), so until those reads answer Home draws one placeholder card and nothing below it; the blocks
 * then arrive once, in their final places (new content appearing is not a shift).
 *
 * Settled = the read answered (data or error). A read no one asked for (no query in the cache) is settled: nothing
 * will arrive there. `needPoster` (a member past their first job) makes the poster read required even before its
 * card mounts and asks it, so the gate cannot open for the one render between the two reads.
 * Never longer than HOME_TOP_MAX_WAIT_MS: a hung read must not keep Home's sections hidden.
 */
export const HOME_TOP_MAX_WAIT_MS = 4000;

function useQuerySettled(key: QueryKey): boolean {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  return useSyncExternalStore(
    (cb) => cache.subscribe(cb),
    () => {
      const s = qc.getQueryState(key);
      if (!s) return true;
      return s.status !== "pending";
    },
  );
}

export function useHomeTopSettled(userId: string | undefined, firstJob: { isNew: boolean } | null): boolean {
  const firstSettled = useQuerySettled(["home", "first-job-state", userId]);
  const needPoster = !!firstJob && !firstJob.isNew;
  // The same query (key + fetch) PosterFirstJobCard reads: asked here the render firstJob answers, so it is one read.
  const poster = usePosterFirstJob(userId, needPoster);
  const posterSettled = !poster.isPending;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), HOME_TOP_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  if (!userId || timedOut) return true;
  return firstSettled && (!needPoster || posterSettled);
}

/**
 * Builder 3 (11-04 PM): on a FIRST visit to Home on this device (no saved Next up height, reservedHeight.ts) the
 * to-dos and the money strip have nothing to hold room with. Lab after the first-week fix (prod build, helper persona,
 * Fast 4G, 3 runs): the money strip landing above Coming up (0.050) and Next up growing from its loading lines to
 * "1 of 9" (0.059) were the two shifts left. So the blocks BELOW Next up wait for those reads: Next up then grows
 * with nothing under it, and the rest arrives once, in place. Next up itself is not held: its loading line is the
 * same <p> its to-do title fills, so the page's first big paint stays the greeting (holding the whole column moved
 * LCP from the greeting at 1.09 s to the to-do title at 2.24 s). True while held; once released it stays released,
 * and never longer than HOME_TOP_MAX_WAIT_MS.
 */
export function useHoldWhileFirstVisitReads(pending: boolean): boolean {
  const released = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), HOME_TOP_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  if (!pending || timedOut) released.current = true;
  return !released.current;
}
