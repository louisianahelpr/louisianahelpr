/**
 * Audit 11-10 W5 F470: the Help center had no top-level card for "a job went wrong"; the Trust & Safety card said only
 * "Verification, disputes, and reporting." It now opens with that question so a member in trouble sees where to tap.
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | desc: "Something went wrong with a job? Disputes, reporting, and ID checks." | desc: "Verification, disputes, and reporting."
 */
import { describe, expect, it } from "vitest";
import { TOPICS } from "@/pages/info/helpCenter/helpCenterContent";

describe("F470: a help card names a job gone wrong", () => {
  it("the Trust & Safety card opens with the question", () => {
    const card = TOPICS.find((t) => t.label === "Trust & Safety");
    expect(card?.desc).toMatch(/^Something went wrong with a job\?/);
    expect(card?.desc).toContain("Disputes");
  });
});
