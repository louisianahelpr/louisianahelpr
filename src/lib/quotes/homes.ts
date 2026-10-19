/**
 * Where quotes live (owner decision 2026-10-19: quotes live INSIDE Post a Job,
 * Jobs, My Jobs and Posts; the standalone /quotes hub is retired):
 *   - a poster's quote requests, and the quotes that came in on each, sit on
 *     Posts (the "Your quote requests" section);
 *   - open quote requests sit in the Jobs browse feed ("Wants Quotes");
 *   - the quotes a member sent sit on My Jobs (the "Your quotes" section).
 * Every screen links to these, never to /quotes. Old /quotes links (pushes,
 * emails, notification rows already written) still work: the /quotes route is
 * QuotesHubRedirect, which sends each old view to its new home.
 * Guarded by src/test/quotesHubRetired.test.ts.
 */
export const QUOTE_HOMES = {
  /** Posts, scrolled to the poster's quote requests. */
  myRequests: "/posts?quotes=1",
  /** The Jobs browse feed with the Wants Quotes lens on. */
  openRequests: "/home?wantsQuotes=1",
  /** My Jobs, scrolled to the quotes this member sent. */
  myQuotes: "/jobs?quotes=1",
} as const;

/**
 * The new home for an old /quotes link, from its query string. The hub's
 * views were ?view=requests (the default), ?view=open and ?view=mine;
 * notifications added ?user=<actor> (the seed boundary, read server-side
 * only), which no home needs.
 */
export function quotesHubTarget(search: string): string {
  const view = new URLSearchParams(search).get("view");
  if (view === "open") return QUOTE_HOMES.openRequests;
  if (view === "mine") return QUOTE_HOMES.myQuotes;
  return QUOTE_HOMES.myRequests;
}
