// Types for scripts/test-signin-link.mjs, so TypeScript callers (e2e/) can read
// the ONE pinned copy of the shared test accounts' auth ids (Q1650).
type Account<Id extends string | null> = { email: string; userId: Id; label: string };
export const ACCOUNTS: {
  poster: Account<string>;
  helper: Account<string>;
  "poster-e2e": Account<string>;
  "helper-e2e": Account<string>;
  "incomplete-e2e": Account<null>;
  "admin-e2e": Account<null>;
};
