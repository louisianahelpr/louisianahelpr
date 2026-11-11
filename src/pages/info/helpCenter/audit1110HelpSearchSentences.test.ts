/**
 * F412 (audit 11-10): Help search matched only exact words, so "how much does it cost" and "my job went wrong" both
 * said "No answers match". Filler words are dropped and the point words match plain synonyms (helpSearchWords.ts).
 *
 * @mutate src/pages/info/helpCenter/helpSearchWords.ts |   return (point.length > 0 ? point : words).map((w) => [...(SYNONYMS[w] ?? [w])]); |   return words.map((w) => [...(SYNONYMS[w] ?? [w])]);
 * @mutate src/pages/info/helpCenter/helpSearchWords.ts |   cost: ["cost", "fee", "price", "charge"], |   cost: ["cost"],
 * @mutate src/pages/info/helpCenter/helpSearchWords.ts |   wrong: ["wrong", "problem", "dispute", "issue"], |   wrong: ["wrong"],
 * @mutate src/pages/info/HelpCenter.tsx |         return terms.every((forms) => forms.some((w) => text.includes(w))); |         return terms.every((forms) => text.includes(forms[0]));
 */
import { describe, expect, it } from "vitest";
import { filterFaqSections } from "@/pages/info/HelpCenter";
import { FAQ_SECTIONS } from "./helpCenterContent";

const questions = (query: string) => filterFaqSections(FAQ_SECTIONS, query).flatMap((s) => s.items.map((i) => i.q));

describe("F412: Help search understands a typed sentence", () => {
  it('"how much does it cost" finds the fees answer', () => {
    expect(questions("how much does it cost")).toContain("What fees does Helpr charge?");
  });

  it('"my job went wrong" finds answers about a problem with a job', () => {
    const hits = questions("my job went wrong");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((q) => /problem|dispute|wrong|issue/i.test(q))).toBe(true);
  });

  it("an exact word still works and nonsense still finds nothing", () => {
    expect(questions("refund").length).toBeGreaterThan(0);
    expect(questions("zzqxnotaword")).toEqual([]);
  });
});
