// Q2709 fold-in (lead 11-04; nightly-red #3491 ui-sweep): /profile?tab=notifications failed axe heading-order
// (moderate, 1 node, h3) in the empty-state sweep (run 41883963188, customer + helper phone-light). The Job reminders
// and Declutter group titles were <h3> with no <h2> above them on the tab (the page heading is the h1), so the
// outline skipped a level. They are section titles of the tab, the same level as the SMS alerts card's <h2>.
//
// @mutate src/components/notificationPreferences/JobRemindersGroup.tsx | <h2 className="font-sans font-semibold text-ds-13 mb-0" | <h3 className="font-sans font-semibold text-ds-13 mb-0"
// @mutate src/components/notificationPreferences/DeclutterNotificationGroup.tsx | <h2 className="font-sans font-semibold text-ds-13 mb-0" | <h3 className="font-sans font-semibold text-ds-13 mb-0"
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const FILES = [
  "src/components/notificationPreferences/JobRemindersGroup.tsx",
  "src/components/notificationPreferences/DeclutterNotificationGroup.tsx",
];

describe("#3491: the notification tab's group titles do not skip a heading level", () => {
  for (const f of FILES) {
    it(`${f} titles its group with an <h2>`, () => {
      const src = blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));
      expect(src).toMatch(/<h2 className="font-sans font-semibold text-ds-13 mb-0"/);
      expect(src).not.toMatch(/<h[3-6][\s>]/);
    });
  }
  it("inventory: both groups", () => expect(FILES.length).toBeGreaterThan(1));
});
