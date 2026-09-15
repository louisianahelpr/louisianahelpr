/**
 * openJobFromPin — the ONE lookup behind "I tapped a job on the map".
 *
 * VN-10: the map's pin preview opened the job-detail dialog only when the
 * pinned job happened to be in the caller's in-memory job list. The feed is
 * paginated and separately filtered (own posts, past-dated jobs, jobs already
 * applied to, blocked posters) while `get_open_jobs_for_map` returns every open
 * job in view, so a pin for a job the list doesn't hold was a dead tap — the
 * card was there, it looked pressable, and nothing happened.
 *
 * There are TWO BrowseMap instances and they both had their own copy of the
 * lookup: the toggle map inside `BrowseTasksFeed` (phone, and the list/map
 * toggle) and the desktop split-view map in `Dashboard.tsx`. Fixing one left
 * the same dead tap on the other — measured at 1440 on prod data, 2026-09-14 —
 * so the lookup lives here now and both call it.
 *
 * Order matters: memory first (free, and carries the feed's own enrichment),
 * then the authoritative row. The pin's own `MapJob` is never the answer — it
 * is privacy-reduced and carries no `customer_id`, which is exactly what the
 * caller gates the Apply footer on (see mapJobToEnrichedJob's header).
 */
import type { EnrichedJob } from "@/components/dashboard/types";
import { fetchJobForPin } from "./fetchJobForPin";

export interface OpenJobFromPinArgs {
  jobId: string;
  /** Job lists to search, in order — e.g. this page's filtered jobs, then everything loaded. */
  lists: Array<EnrichedJob[] | undefined>;
  /** Opens the detail dialog. */
  open: (job: EnrichedJob) => void;
  /** Tells the user why nothing opened. Never silent: that was the defect. */
  onError: (message: string) => void;
  /** Injected in tests; defaults to the real fetch. */
  fetchJob?: (jobId: string) => Promise<EnrichedJob | null>;
}

export function openJobFromPin({ jobId, lists, open, onError, fetchJob = fetchJobForPin }: OpenJobFromPinArgs): void {
  for (const list of lists) {
    const hit = list?.find((j) => j.id === jobId);
    if (hit) {
      open(hit);
      return;
    }
  }
  void fetchJob(jobId)
    .then((fetched) => {
      if (fetched) open(fetched);
      else onError("That job is no longer available.");
    })
    .catch(() => onError("Couldn't open that job. Try again."));
}
