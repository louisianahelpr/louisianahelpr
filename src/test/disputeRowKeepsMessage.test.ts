/**
 * GUARD Q1082 (owner 2026-10-05, pop-up: "Message always visible" on dispute
 * rows). The row collapses from the middle, and Message sat in the middle of
 * both dispute rows (poster: Escalate, Photos, Timeline, Message, Contact
 * Admin; Helpr: Contact Admin, Message, Timeline, Photos), so at 320 it went
 * into More first. A row that names a survivor (`soloChipKey`) now keeps it on
 * screen at EVERY width, and both dispute rows name Message.
 */
// @mutate src/components/job-card/jobStepRow.tsx |   if (soloIndex >= 0 && soloAt >= 0 && soloAt < overflow.length) { |   if (false) {
// @mutate src/pages/posts/postedJobCard/steps/DisputedStep.tsx |       soloChipKey="message" |       soloChipKey="admin"
// @mutate src/pages/jobs/appliedJobCard/DisputedSection.tsx |       soloChipKey="message" |       soloChipKey="timeline"
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partitionJobStepRowChips } from "@/components/job-card/jobStepRow";

const POSTER = ["escalate", "photos", "timeline", "message", "admin"];
const HELPR = ["admin", "message", "timeline", "photos"];
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("dispute rows keep Message on screen at every width (Q1082)", () => {
  for (const [side, chips] of [["poster", POSTER], ["Helpr", HELPR]] as const) {
    for (let visible = 1; visible <= chips.length; visible++) {
      it(`${side} row, ${visible} visible chip(s): Message is in the row, not in More`, () => {
        const { lead, overflow, trail } = partitionJobStepRowChips(chips, visible, chips.indexOf("message"));
        expect([...lead, ...trail]).toContain("message");
        expect(overflow).not.toContain("message");
        // Nothing is lost: every chip is either shown or in More, once.
        expect([...lead, ...overflow, ...trail].sort()).toEqual([...chips].sort());
        expect(lead.length + trail.length).toBe(Math.min(visible, chips.length));
      });
    }
  }
  it("both dispute rows name Message as their survivor", () => {
    for (const f of ["src/pages/posts/postedJobCard/steps/DisputedStep.tsx", "src/pages/jobs/appliedJobCard/DisputedSection.tsx"]) {
      const s = src(f);
      expect(s, f).toContain('step="disputed"');
      expect(s, f).toContain('soloChipKey="message"');
    }
  });
});
