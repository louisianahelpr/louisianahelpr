/**
 * Owner answer 12 (2026-10-17) put a Quotes link in the menu (the Profile
 * landing row on a phone, the desktop rail's Quotes entry). Owner decision
 * 2026-10-19 superseded it: quotes live INSIDE Post a Job, Jobs, My Jobs and
 * Posts, and the /quotes hub redirects (src/test/quotesHubRetired.test.ts;
 * the Wants Quotes lens: src/components/quotes/wantsQuotesFilter.test.tsx).
 * Re-pointed the same day: the menu link is GONE from both places, and its
 * component (QuotesEntryRow) with it, so a stray Quotes destination cannot
 * come back to a menu without failing here.
 *
 * @mutate src/components/DesktopSidebarNav.tsx |     PROFILE_ITEM,\n |     { path: "/quotes", icon: User, label: "Quotes" },\n    PROFILE_ITEM,\n
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const root = resolve(__dirname, "../../..");
const src = (rel: string) => blankComments(readFileSync(resolve(root, rel), "utf8"));

describe("no Quotes menu link (owner 2026-10-19: quotes live inside Jobs)", () => {
  it("neither the Profile landing nor the desktop rail carries a Quotes entry", () => {
    expect(src("src/components/profile/ProfileLanding.tsx")).not.toMatch(/QuotesEntryRow|label: "Quotes"/);
    expect(src("src/components/DesktopSidebarNav.tsx")).not.toMatch(/label: "Quotes"|path: "\/quotes"/);
    expect(existsSync(resolve(root, "src/components/profile/profileLanding/QuotesEntryRow.tsx"))).toBe(false);
  });

  it("/quotes keeps the signed-in app chrome on both surfaces while it redirects (dualSurfaceRoutesGetAppChrome)", () => {
    expect(src("src/lib/desktopNavRoutes.ts")).toContain('"/quotes"');
    expect(src("src/components/mobileNav/mobileNavHelpers.ts")).toContain('"/quotes"');
  });
});
