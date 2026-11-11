import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { EnrichedJob } from "@/components/dashboard/types";

/** The history-state key on the entry openDetailJob pushes. */
const SHEET_ENTRY = "guestJobSheet";

const stateObject = (state: unknown): Record<string, unknown> =>
  state && typeof state === "object" ? (state as Record<string, unknown>) : {};
const isSheetEntry = (state: unknown) => stateObject(state)[SHEET_ENTRY] === true;

/**
 * The guest /browse job sheet (GuestJobPreview) and its ?job=<id> URL.
 *
 * JOBS-29 (lead decision 2026-10-31): tapping a card shows the job first, then "Sign up to apply". The id rides in
 * ?job= so a reload restores it (below), and Sign up carries the job as `?redirect=/jobs/<id>` (lib/jobIntent).
 *
 * F260u (whole-app audit 2026-11-10): ?job= was written with replace, so the sheet had no history entry: Back left a
 * stale URL or walked off the page. Opening now PUSHES one entry (marked in its state); Back pops it and the sheet
 * closes with the param; the sheet's own close pops only an entry it pushed itself (a fresh /browse?job= link drops
 * the param in place). Pulled out of DashboardGuest (size ratchet).
 */
export function useGuestJobSheet(jobs: EnrichedJob[]) {
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const openDetailJob = useCallback((job: EnrichedJob) => {
    setDetailJob(job);
    const next = new URLSearchParams(location.search);
    next.set("job", job.id);
    navigate(
      { pathname: location.pathname, search: `?${next.toString()}` },
      { state: { ...stateObject(location.state), [SHEET_ENTRY]: true } },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  const closeDetailJob = useCallback(() => {
    setDetailJob(null);
    // L005: pops only the entry openDetailJob pushed itself; anything else drops ?job= in place.
    if (isSheetEntry(location.state)) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(location.search);
    next.delete("job");
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true, state: location.state });
  }, [location.pathname, location.search, location.state, navigate]);

  // Back (or Forward) to an entry without ?job= closes the sheet with it.
  const jobParam = searchParams.get("job");
  useEffect(() => {
    if (!jobParam) setDetailJob(null);
  }, [jobParam]);

  // Re-open the sheet from the URL on mount (?job=<id>). One-shot and add-only: it restores the sheet after a reload
  // or a return from /subscription. Retries until the guest feed has loaded.
  const restoredJobParam = useRef(false);
  useEffect(() => {
    if (restoredJobParam.current) return;
    if (!jobParam) {
      restoredJobParam.current = true;
      return;
    }
    const match = jobs.find((j) => j.id === jobParam);
    if (match) {
      setDetailJob(match);
      restoredJobParam.current = true;
    }
  }, [jobParam, jobs]);

  return { detailJob, openDetailJob, closeDetailJob };
}
