/**
 * THE ERROR-SCREEN LIST MUST NOT FIRE ON THE APP'S OWN PROSE.
 *
 * `e2e/errorScreens.ts` is the one list every harness uses — the visual sweep,
 * press-every-control, the stale-deploy spec and the journeys — so a pattern
 * that matches legitimate copy reports an error screen on a working page in all
 * of them at once. It happened: `/Something went wrong/i` matched the overdue-job
 * notification body, and it took out 02-marketplace J3-J5 (fixed in 320dfba24,
 * which shipped without a test — this is it) and press-every-control's
 * "Notifications" press on /dashboard and /jobs/:id for the customer persona
 * (run 35660182220).
 *
 * The prose below is not invented. It is the exact `notifications.message`
 * written by the overdue-job sweep, read off prod `fncmgoasalhdgfwzhsqa`
 * 2026-09-21: 388 rows for poster-e2e, 8 of them matching the old pattern and 0
 * matching the anchored one.
 *
 * Every pattern is also asserted able to fire, so tightening one into
 * uselessness is caught here rather than by a nightly that has gone quiet.
 *
 * The registration reinstates the un-anchored pattern (the directive cannot
 * carry a regex literal — `\|` and `\n` inside one do not survive the
 * unescape — so it swaps the field and parks the real one beside it).
 *
 * @mutate e2e/errorScreens.ts | "generic failure copy", re: | "generic failure copy", re: /went wrong/i, wasAnchored:
 */
import { describe, it, expect } from "vitest";
import { ERROR_SCREEN_PATTERNS, findErrorScreen } from "../../e2e/errorScreens";

/**
 * Real text from surfaces that are WORKING. Nothing here may be reported as an
 * error screen.
 */
const HEALTHY_PROSE = [
  // notifications.message, overdue-job sweep — prod, 2026-09-21 (8 rows).
  '"Touch up hallway and stairwell" — its scheduled time has passed and nobody has marked it done. Message your Helpr, or report a problem if something went wrong.',
  '"Clear leaves and clean gutters" — its scheduled time has passed and nobody has marked it done. Message your Helpr, or report a problem if something went wrong.',
  // The same phrase mid-sentence in any other casing must stay quiet too.
  "Tell us what happened if something went wrong and we will take a look.",
  "Report a problem if Something else went wrong is not what you meant.",
];

/** Copy that IS an error surface. Every one of these must still be caught. */
const REAL_ERROR_COPY: { text: string; expect: string }[] = [
  { text: "This page hit a problem. Try again.", expect: "route crash (RouteErrorBoundary)" },
  { text: "Something went sideways. We have logged it.", expect: "app crash (ErrorBoundary)" },
  { text: "Something went wrong. Please try again.", expect: "generic failure copy" },
  { text: "Your payout is on the way. Something went wrong. Please try again.", expect: "generic failure copy" },
  { text: "Update ready", expect: "retired 'Update ready' screen" },
  { text: "Helpr couldn't load", expect: "boot watchdog failure" },
  { text: "We couldn't load your account", expect: "account load failure (ProtectedRoute)" },
  { text: "Couldn't load this section", expect: "section/data load failure" },
  { text: "Page Not Found", expect: "404 on a real route" },
  { text: "We couldn't verify your access", expect: "admin access gate (AdminRoute unknown)" },
];

describe("error-screen patterns vs the app's own prose", () => {
  it("has every pattern covered by a case that must match it", () => {
    // Floor + completeness: the list is the inventory, not this file.
    expect(ERROR_SCREEN_PATTERNS.length).toBeGreaterThanOrEqual(9);
    const uncovered = ERROR_SCREEN_PATTERNS.map((p) => p.name).filter((n) => !REAL_ERROR_COPY.some((c) => c.expect === n));
    expect(uncovered).toEqual([]);
  });

  it("does not report an error screen on healthy copy", () => {
    const wrong = HEALTHY_PROSE.map((t) => ({ t, hit: findErrorScreen(t) })).filter((r) => r.hit);
    expect(wrong.map((r) => `${r.hit!.name} fired on: ${r.t}`)).toEqual([]);
  });

  it("still catches every real error surface", () => {
    for (const c of REAL_ERROR_COPY) {
      expect(findErrorScreen(c.text)?.name, c.text).toBe(c.expect);
    }
  });
});
