// Shape of a row from get_ranked_open_jobs. The RPC returns the full job
// detail set; we type the subset the guest browse card actually reads.
export interface PublicJob {
  id: string;
  title: string;
  description: string | null;
  category: string;
  /**
   * NULL once the poster deletes their account: deletion anonymises the job
   * rather than removing it (20260901033011) and `mask_job_location(NULL)`
   * returns NULL, so this RPC really can hand back a null here. It was typed
   * `string`, which is why `tsc` could not see the unguarded
   * `job.location.toLowerCase()` in `useOpenJobsFeed` that would have emptied
   * the whole public board for a guest.
   */
  location: string | null;
  budget: number;
  date_needed: string;
  start_time: string | null;
  /**
   * Hours the poster estimated the job takes. Returned by
   * `get_ranked_open_jobs` (and by the `open_jobs_browse` view the signed-in
   * feed reads) — it was simply being dropped on the floor by
   * `toEnrichedJob`, so the guest card lost the duration chip the signed-in
   * card shows. A `numeric` column, so PostgREST can hand it back as a
   * string ("4.00"); the card coerces with Number().
   */
  estimated_hours: number | string | null;
  is_urgent: boolean | null;
  urgent_fee: number | null;
  is_recurring: boolean | null;
  recurrence_interval: string | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  created_at: string;
  expires_at: string | null;
  boost_expires_at: string | null;
}

export interface JobsPage {
  jobs: PublicJob[];
  nextOffset: number | null;
}
