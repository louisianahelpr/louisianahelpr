/** Nearest accepted / in-progress job where the user is the helper. */
export type UpcomingJob = {
  id: string;
  title: string;
  date_needed: string | null;
  start_time: string | null;
  status: string;
};

/**
 * What the pill says, and where it goes — decided in ONE place.
 *
 * The pill shows two different states and they want two different
 * destinations, so the label and the route are returned together. Splitting
 * them (label here, `navigate()` in the page) is how a pill ends up reading
 * "In progress" and landing on an unfiltered list.
 *
 * Both routes are the app's OWN existing deep links, not new ones:
 * `/my-jobs?filter=in_progress` is what every in-progress notification already
 * links to (`useLifecycleHandlers`, `create-payment`), and `?filter=active` is
 * the applied tab's default bucket. `/my-jobs` is Activity's `defaultTab:
 * "applied"` route — NOT `/activity`, which redirects to `/my-posts` and drops
 * the query string, and not `/jobs/:id`, which bounces a signed-in user to
 * `/dashboard?quickApply=…`, i.e. straight back to the screen they tapped from.
 *
 * - `in_progress` → the job the badge is describing. The filter narrows the
 *   applied list to jobs whose status is exactly `in_progress`, which is the
 *   badge's own job (the query behind it takes the single nearest one).
 * - accepted-but-not-started → "Upcoming", so the honest destination is the
 *   list of active/upcoming jobs, not a single row.
 */
export function inProgressBadgeTarget(job: UpcomingJob): {
  live: boolean;
  label: string;
  to: string;
  /** Where the accessible name says it goes. */
  destination: string;
} {
  const live = job.status === "in_progress";
  return live
    ? { live, label: "In progress", to: "/my-jobs?filter=in_progress", destination: "open this job in My Jobs" }
    : { live, label: "Upcoming", to: "/my-jobs?filter=active", destination: "open your active jobs" };
}
