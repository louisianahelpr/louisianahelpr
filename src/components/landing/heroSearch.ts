/**
 * The hero search (owner, 2026-10-20, LANDING-APPROVED.md "search all four"):
 * one box for jobs, items, shops and homes. Today only Jobs is open to everyone
 * (Declutter, Shops and Homes say "Coming soon" until their switches open), so
 * a signed-out visitor's words search the public Jobs board (`/browse?q=`),
 * where acting on a job asks them to sign up and returns them. Signed in,
 * they open /search?q= (board 89), which searches every open section and
 * says "Opening soon" for the rest. Guard: src/test/landingRedesign.test.tsx.
 */
export const SEARCH_PARAM = "q";
export const SEARCH_MAX = 80;

function searchTerm(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

export function heroSearchTargets(raw: string): { signedIn: string; signedOut: string } {
  const q = searchTerm(raw);
  const qs = q ? `?${new URLSearchParams({ [SEARCH_PARAM]: q }).toString()}` : "";
  // Signed in, words go to /search (board 89: every section at once); an
  // empty box still opens Jobs. Signed out, the public Jobs board as before.
  return { signedIn: q ? `/search${qs}` : "/jobs", signedOut: `/browse${qs}` };
}
