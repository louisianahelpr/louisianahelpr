import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY Profile tab wears the SAME shell. Asserted against the router, which
 * is where the shells actually live.
 *
 * The previous version of this test globbed `src/components/profile/*Tab.tsx`
 * and checked each file's own wrapper. All thirteen passed — and the tabs were
 * still visibly inconsistent, because SEVEN of them do not have a `*Tab.tsx`
 * file at all: their wrapper is written inline in ProfileTabPanels. Scanning
 * the components proved something true about the wrong set of files, and the
 * owner reported the same defect more than ten times while the suite stayed
 * green. Found by dumping the router's actual wrappers:
 *
 *   space-y-3 .............................................. schedule, warnings
 *   space-y-5 .............................................. referral
 *   h-full min-h-0 flex flex-col gap-3 overflow-hidden ...... notifications
 *   space-y-4 .............................................. credentials
 *
 * Four different shells. So this reads ProfileTabPanels.tsx and requires every
 * `{tab === "…" && (<div className="…">` to be exactly SHELL — no allowance
 * for "contains", which is what let `space-y-4 pb-4` and friends through.
 */
const SHELL = "space-y-4";

const SRC = readFileSync(
  resolve(__dirname, "../../pages/profile/ProfileTabPanels.tsx"),
  "utf8",
);

/** Every tab branch in the router, with the wrapper class it opens with. */
function routerWrappers(): Array<{ tab: string; wrapper: string }> {
  const re = /\{tab === "([a-z_]+)"[^&]*&&[^(]*\(\s*\n\s*<div className="([^"]*)"/g;
  const out: Array<{ tab: string; wrapper: string }> = [];
  for (const m of SRC.matchAll(re)) out.push({ tab: m[1], wrapper: m[2] });
  return out;
}

describe("Profile tabs share one shell", () => {
  it("finds the tab branches at all (guards the regex rotting)", () => {
    // If the router is refactored and this stops matching, the test would
    // vacuously pass on an empty list — which is exactly how the old one hid a
    // real defect. Fail loudly instead.
    expect(routerWrappers().length).toBeGreaterThanOrEqual(5);
  });

  it("every tab rendered by the router uses the shared shell exactly", () => {
    const wrong = routerWrappers()
      .filter((r) => r.wrapper !== SHELL)
      .map((r) => `${r.tab}: "${r.wrapper}"`);
    expect(wrong, `tabs off the shared shell ("${SHELL}")`).toEqual([]);
  });

  it("tabs that own their wrapper use it too", () => {
    // The other half: components that render their own ProfileTabHeader.
    const names = [
      "AccessibilityTab", "AvailabilityTab", "CredentialsTab", "EarningsTab",
      "LegalTab", "ReviewsTab", "SavedHelpersTab", "ScheduleTab",
      "SecurityTab", "SubscriptionTab", "WarningsTab",
    ];
    const wrong: string[] = [];
    for (const name of names) {
      let src: string;
      try {
        src = readFileSync(resolve(__dirname, `${name}.tsx`), "utf8");
      } catch {
        wrong.push(`${name}: file missing — update this list`);
        continue;
      }
      const at = src.indexOf("<ProfileTabHeader");
      if (at === -1) continue;
      const opens = [...src.slice(0, at).matchAll(/<div[^>]*className="([^"]*)"/g)];
      const wrapper = opens.length ? opens[opens.length - 1][1] : "";
      if (!wrapper.split(/\s+/).includes(SHELL)) wrong.push(`${name}: "${wrapper}"`);
    }
    expect(wrong, `tab components off the shared shell`).toEqual([]);
  });
});
