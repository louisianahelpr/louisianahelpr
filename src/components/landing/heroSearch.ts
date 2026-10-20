/**
 * The hero search (owner, 2026-10-20, LANDING-APPROVED.md "search all four"):
 * one box for jobs, items, shops and homes. Today only Jobs is open to everyone
 * (Declutter, Shops and Homes say "Opening soon" until their switches open), so
 * the words search the Jobs feed: the public board (`/browse?q=`) for a
 * signed-out visitor, where acting on a job asks them to sign up and returns
 * them; Jobs > Browse (`/jobs?q=`) once signed in. Both read `q` through
 * useDashboardFilters. Guard: src/test/landingRedesign.test.tsx.
 */
export const SEARCH_PARAM = "q";
export const SEARCH_MAX = 80;

/** Example searches only: no prices until real completed-job data backs them (lead). */
export const TASK_CHIPS = ["Lawn mowing", "Furniture assembly", "Gutter cleaning", "Moving help"] as const;

function searchTerm(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

export function heroSearchTargets(raw: string): { signedIn: string; signedOut: string } {
  const q = searchTerm(raw);
  const qs = q ? `?${new URLSearchParams({ [SEARCH_PARAM]: q }).toString()}` : "";
  return { signedIn: `/jobs${qs}`, signedOut: `/browse${qs}` };
}
