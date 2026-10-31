/**
 * AUD31-23 (Legal, help, rules, landing; Medium): Help had no Declutter section (one question under Getting Started),
 * though Declutter is open to everyone. Now a "Declutter" topic answers buying, selling, getting the item (pickup and
 * delivery), problems and refunds, and delivering, each restating the Declutter terms (TermsSection.tsx), with no fee
 * named (membersSeeNoFeeWords).
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts |   { label: "Declutter", desc: "Buying, selling, pickup, delivery and refunds." },\n |
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts |         q: "What if something's wrong with my item?", |         q: "Something else?",
 */
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS, TOPICS } from "@/pages/info/helpCenter/helpCenterContent";

describe("Help has a Declutter section (AUD31-23)", () => {
  const section = FAQ_SECTIONS.find((s) => s.topic === "Declutter");
  it("is a topic with its blurb (the lookup is by exact label)", () => {
    expect(FAQ_SECTIONS.length).toBeGreaterThan(5);
    expect(section).toBeTruthy();
    expect(TOPICS.find((t) => t.label === "Declutter")?.desc).toBeTruthy();
  });

  it("answers buying, selling, getting it, problems and refunds, and delivering", () => {
    const qs = (section?.items ?? []).map((i) => i.q);
    expect(qs).toEqual([
      "How do I buy something on Declutter?",
      "How do I sell?",
      "How do I get the item?",
      "What if something's wrong with my item?",
      "Can I deliver Declutter items?",
    ]);
    for (const i of section?.items ?? []) expect(i.a.length, i.q).toBeGreaterThan(80);
  });
});
