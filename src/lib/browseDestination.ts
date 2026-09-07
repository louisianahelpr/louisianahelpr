/**
 * Where "browse open jobs" actually lives, for the viewer asking.
 *
 * There are two browse feeds and they are different screens, not a screen and
 * a redirect to it: `/browse` (DashboardGuest) is the signed-out feed, and
 * `/dashboard` (Dashboard) is the signed-in one. Both render the same
 * `BrowseTasksToolbar` over the same `open_jobs_browse` view; what differs is
 * everything that needs a user — saves, applications, availability.
 *
 * This exists because the app used to answer the question with a THIRD route,
 * `/jobs`, whose entire job was to look at the session and bounce you to one
 * of the two above. That page is gone (owner, 2026-09-07: "there should be no
 * redirects... it all needs to point to the correct location"). A link that
 * knows who is clicking it can name the right screen directly, and every call
 * site has the session already — so the hop bought nothing and cost a render,
 * a history entry, and a flash of the wrong page.
 *
 * Use this rather than hand-rolling the ternary, so the two destinations stay
 * derived in ONE place. A caller on a surface that is authed-only (Activity,
 * the completion prompts, JobDetail) should skip it and name `/dashboard`
 * outright — passing a user it always has is noise.
 */
export function browseDestinationFor(user: { id: string } | null | undefined): "/browse" | "/dashboard" {
  return user ? "/dashboard" : "/browse";
}
