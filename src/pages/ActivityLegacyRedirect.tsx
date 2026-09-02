import { Navigate, useLocation } from "react-router-dom";

/**
 * `/activity` is a legacy route. It was replaced by two real routes —
 * `/my-posts` (what I posted) and `/my-jobs` (what I'm working / been offered)
 * — and left behind as `<Navigate to="/my-posts" replace />`.
 *
 * That redirect was wrong in two ways at once, and together they lost helpers
 * their offers:
 *
 *  1. It always landed on the POSTER surface. A helper following a
 *     direct-offer notification to `/activity?tab=offers` arrived at "My
 *     Posts", which for a helper is an empty state, with no pointer to the
 *     offer sitting one route over.
 *  2. `<Navigate to="/my-posts">` carries no `search`, so the `?tab=` /
 *     `?filter=` the notification had put in the link was discarded on the
 *     way — meaning even the correct surface could not have selected the
 *     right bucket.
 *
 * Offers carry a response deadline (24h for a direct offer,
 * poster-chosen for an accepted application), so a lost link is a
 * silently-burned offer, not just a navigation annoyance.
 *
 * This component preserves the query string and maps the legacy `tab` /
 * `filter` vocabulary onto the routes that replaced it.
 */

/** Legacy `?tab=` values that meant "the helper's side of Activity". */
const HELPER_TABS = new Set(["applied", "offers", "myjobs", "my-jobs", "jobs"]);

export default function ActivityLegacyRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const filter = params.get("filter");

  // `filter=offered` / `filter=direct_offer` are helper-side buckets
  // regardless of what `tab` says — those two keys only exist on the applied
  // side (see activityFilters.ts).
  const helperSide =
    (tab !== null && HELPER_TABS.has(tab)) ||
    filter === "offered" ||
    filter === "direct_offer";

  // `tab` has done its job now that it picks the route; keep everything else
  // (notably `filter`) so the destination lands on the right bucket.
  params.delete("tab");
  // `?tab=offers` with no explicit filter is the direct-offer inbox.
  if (tab === "offers" && !filter) params.set("filter", "direct_offer");
  const rest = params.toString();

  return (
    <Navigate to={`${helperSide ? "/my-jobs" : "/my-posts"}${rest ? `?${rest}` : ""}`} replace />
  );
}
