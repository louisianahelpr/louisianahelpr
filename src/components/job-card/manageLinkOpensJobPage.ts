/**
 * THE MANAGE JOB SCREEN IS GONE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): its actions are on the job page, so an old
 * `/posts?highlight=<id>&manage=1` link (a chat card, an email, a notification already on a phone) opens /jobs/<id>.
 * Every one: the job page runs the card's approve, cancel, edit and steps itself now (usePosterPageFlows), so no
 * link is left that needs the card. JobsSection redirects BEFORE the Posted
 * list mounts: redirecting from inside the list raced its own deep-link URL writes, which put the list back
 * (measured in a browser, 2026-10-31).
 *
 * Its own import-free file (Q1158, 11-06): in useManageDeepLink it put that hook's chunk and activityFilters behind it
 * on signed-in /jobs' first round (Browse never runs them; the lists' lazy chunk does).
 */
export function manageLinkOpensJobPage(params: URLSearchParams): string | null {
  const id = params.get("manage") === "1" ? params.get("highlight") : null;
  return id ? `/jobs/${encodeURIComponent(id)}` : null;
}
