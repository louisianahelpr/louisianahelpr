/**
 * BOARD 178, first slice: the Help screen leads with "Talk to a real person"
 * (spec v2 §9.8: "Talk to a real person" first), and every topic label and
 * submit button is sentence case.
 *
 * @mutate src/lib/supportTopics.ts |     label: "Talk to a real person", |     label: "Message Admin",
 * @mutate src/lib/supportTopics.ts |     submitLabel: "Report issue", |     submitLabel: "Report Issue",
 */
import { describe, expect, it } from "vitest";
import { SUPPORT_TOPICS } from "@/lib/supportTopics";
import { TAB_TITLES } from "@/pages/profile/types";

const sentence = (s: string) => s.split(/\s+/).slice(1).every((w) => !/^[A-Z][a-z]/.test(w));

describe("Help, board 178 (first slice)", () => {
  it("is titled Help and leads with Talk to a real person", () => {
    expect(TAB_TITLES.support).toBe("Help");
    expect(SUPPORT_TOPICS[0].label).toBe("Talk to a real person");
  });
  it("every topic label and submit button is sentence case", () => {
    expect(SUPPORT_TOPICS.length).toBeGreaterThan(3);
    const bad = SUPPORT_TOPICS.flatMap((t) => [t.label, t.submitLabel]).filter((l) => !sentence(l));
    expect(bad).toEqual([]);
  });
});
