/**
 * The hero search (owner, 2026-10-20, LANDING-APPROVED.md "search all four"):
 * one box for every open section. Owner 11-18: the Jobs | Declutter tabs above it
 * are gone and the box searches both: its words open /search?q= (board 89) for a
 * guest or a member, which lists jobs and Declutter items together (and says
 * "Coming soon" for a closed section). Guards: src/test/landingRedesign.test.tsx,
 * src/test/landingBrowseSwitch1108.test.tsx.
 */
export const SEARCH_PARAM = "q";
export const SEARCH_MAX = 80;

function searchTerm(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

export function heroSearchTargets(raw: string): { signedIn: string; signedOut: string } {
  const q = searchTerm(raw);
  const qs = q ? `?${new URLSearchParams({ [SEARCH_PARAM]: q }).toString()}` : "";
  // Owner 11-18: the one box covers jobs AND Declutter, so words open /search (open to guests, F071/L001: it lists the
  // jobs and the Declutter items together) whether signed in or out. An empty box still opens the jobs, as before.
  return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: q ? `/search${qs}` : "/browse" };
}
