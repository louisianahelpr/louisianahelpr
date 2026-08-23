import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every Profile tab wears the same shell.
 *
 * `ProfileTabHeader` already gave them a shared title row, but each tab builds
 * its own wrapper around it and those had drifted — `SubscriptionTab` used
 * `flex flex-col min-h-full gap-4 pb-4` where the other eleven used
 * `space-y-4`, so Membership's title row and body sat on a different rhythm
 * from Security, Legal and Earnings, and `min-h-full` stretched the tab to the
 * panel even on short content. The owner reported it twice as "all profile tabs
 * should share the same shell", and the second time as "the profile tabs still
 * have not been fixed".
 *
 * This is deliberately a STATIC source check rather than a rendered one: the
 * drift is a className, it costs milliseconds to catch here, and the failure
 * mode it guards is somebody adding a thirteenth tab with its own idea of the
 * body rhythm. If the shared value ever needs to change, change SHELL below and
 * the test tells you every file to change with it.
 */
const SHELL = "space-y-4";

/** Every tab panel that renders its own ProfileTabHeader. */
const TABS = [
  "AccessibilityTab",
  "AvailabilityTab",
  "CredentialsTab",
  "EarningsTab",
  "JobListTab",
  "LegalTab",
  "ReviewsTab",
  "SavedHelpersTab",
  "ScheduleTab",
  "ScheduleAvailabilityTab",
  "SecurityTab",
  "SubscriptionTab",
  "WarningsTab",
];

const read = (name: string) =>
  readFileSync(resolve(__dirname, `${name}.tsx`), "utf8");

describe("Profile tabs share one shell", () => {
  it("every tab's outermost wrapper uses the shared body rhythm", () => {
    const wrong: string[] = [];
    for (const name of TABS) {
      let src: string;
      try {
        src = read(name);
      } catch {
        continue; // tab removed or renamed — the list below catches that
      }
      // The wrapper is the div immediately enclosing this tab's own
      // ProfileTabHeader. Take the LAST className that opens before it, which
      // is the innermost enclosing wrapper on the top-level return.
      const headerAt = src.indexOf("<ProfileTabHeader");
      if (headerAt === -1) continue;
      const before = src.slice(0, headerAt);
      const opens = [...before.matchAll(/<div[^>]*className="([^"]*)"/g)];
      const wrapper = opens.length ? opens[opens.length - 1][1] : "";
      if (!wrapper.includes(SHELL)) {
        wrong.push(`${name}: "${wrapper}"`);
      }
    }
    expect(wrong, `tabs not on the shared shell ("${SHELL}")`).toEqual([]);
  });

  it("every tab in the list still exists", () => {
    const missing = TABS.filter((name) => {
      try {
        read(name);
        return false;
      } catch {
        return true;
      }
    });
    // A renamed or deleted tab silently drops out of the check above, which is
    // exactly how a list like this rots into covering nothing.
    expect(missing, "listed tabs with no file — update TABS").toEqual([]);
  });
});
