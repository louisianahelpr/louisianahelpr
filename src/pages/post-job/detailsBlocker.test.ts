// Q353: the Details section's "complete" test and the submit button's label
// are one function, so every reason Details is incomplete has its own label.
// Measured on prod 2026-09-24: a reposted 33-char title (cap 32) left the
// button disabled and reading "Replace the [Placeholders] to Continue" over a
// description with no placeholders.
import { describe, it, expect } from "vitest";
import { detailsBlocker } from "./detailsBlocker";
import { TITLE_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";

const ok = { title: "Deep clean a 3-bed", description: "Empty house, full turnover clean.", category: "cleaning" };

const CASES: [string, Partial<typeof ok>, RegExp][] = [
  ["no title", { title: "  " }, /Title/],
  ["over-long title", { title: "x".repeat(TITLE_MAX + 1) }, /Shorten the Title/],
  ["no description", { description: "" }, /Description/],
  ["no category", { category: "" }, /Category/],
  ["unfilled placeholder", { description: "Clean the [room]" }, /Placeholders/],
  ["phone number in description", { description: "Call me at 225-555-0142 about it" }, /Contact Details/],
];

describe("detailsBlocker names the real reason (Q353)", () => {
  it("a complete Details section has no blocker", () => {
    expect(detailsBlocker(ok)).toBeNull();
    expect(detailsBlocker({ ...ok, title: "x".repeat(TITLE_MAX) })).toBeNull();
  });
  it("covers every reason (floor: 6 on 2026-09-24)", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
  });
  for (const [name, patch, want] of CASES) {
    it(`${name} → ${want}`, () => {
      const label = detailsBlocker({ ...ok, ...patch });
      expect(label).toMatch(want);
      if (!/Placeholders/.test(want.source)) expect(label).not.toMatch(/Placeholders/);
    });
  }
});

// @mutate src/pages/post-job/detailsBlocker.ts | if (f.title.length > TITLE_MAX) return "Shorten the Title to Continue"; | void TITLE_MAX;
