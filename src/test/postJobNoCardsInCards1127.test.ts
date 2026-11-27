/**
 * Polish audit 11-27 #10 (HIGH; owner rule: no cards in cards). Post a job was boxes inside boxes 3 deep: the whole
 * step was a card (SectionCard); "Add photos and more", "Sales tax" and "More options" were cards inside it; "Require
 * before & after photos" was a green-tinted card inside that; the privacy note on When and where was its own card.
 * Now the step has no outer card, and each inner group is a flat section under a 1px hairline, no border box or tint.
 *
 * Inventory from source: the step shell and the four groups the audit named.
 *
 * @mutate src/components/postjob/SectionCard.tsx | <section aria-label={title} data-post-job-section="" className="space-y-5"> | <section aria-label={title} data-post-job-section="" className="rounded-ds-lg bg-card border border-border p-card space-y-5">
 * @mutate src/components/postjob/OptionalExtras.tsx | <section className="border-t border-border [&>button]:px-0" | <section className="rounded-[20px] border border-border bg-card [&>button]:px-0"
 * @mutate src/components/postjob/detailsSection/PhotoProofToggle.tsx | <div data-flat-row="" className="py-1 space-y-1"> | <div data-flat-row="" className="rounded-ds-md border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-1">
 * @mutate src/components/postjob/LogisticsSection.tsx | <div data-flat-row="" className="flex items-start gap-2.5"> | <div data-flat-row="" className="flex items-start gap-2.5 rounded-2xl border border-border bg-card p-4">
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx | className="flex items-center justify-between gap-3 border-t border-border pt-3" data-flat-row="" | className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-2" data-flat-row=""
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const BOX = /\brounded-(?:ds-lg|ds-md|2xl|xl|\[20px\])\b[^"`]*\bborder\b(?!-t\b)|\bbg-card\b|\bbg-primary\/5\b/;

/** Every className string on an element marked as one of the step's groups (data-post-job-section, -flat-group, -flat-row). */
function groupClasses(file: string): string[] {
  const src = blankComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  // An opening tag, reading quoted values whole (a class like "[&>button]:px-0" holds a ">").
  for (const m of src.matchAll(/<(?:section|div)\b((?:[^>"{]|"[^"]*"|\{[^}]*\})*)>/g)) {
    if (!/\bdata-(?:post-job-section|flat-group|flat-row)=""/.test(m[1])) continue;
    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[1]);
    out.push(cls ? (cls[1] ?? cls[2]) : "");
  }
  return out;
}

const FILES = [
  "src/components/postjob/SectionCard.tsx",
  "src/components/postjob/OptionalExtras.tsx",
  "src/components/postjob/detailsSection/PhotoProofToggle.tsx",
  "src/components/postjob/LogisticsSection.tsx",
  "src/components/postjob/detailsSection/TaxKindQuestion.tsx",
];

describe("Post a job has no cards inside cards (polish 11-27 #10)", () => {
  it("the step shell and each named group are flat: no border box, card fill or tint", () => {
    const found: string[] = [];
    const boxed: string[] = [];
    for (const f of FILES) {
      const classes = groupClasses(f);
      if (classes.length === 0) found.push(`${f}: no marked group`);
      for (const c of classes) if (BOX.test(c)) boxed.push(`${f}: ${c}`);
    }
    expect(found).toEqual([]);
    expect(boxed).toEqual([]);
  });

  it("the folded groups sit under a hairline", () => {
    expect(groupClasses("src/components/postjob/OptionalExtras.tsx")[0]).toMatch(/\bborder-t\b/);
    expect(groupClasses("src/components/postjob/detailsSection/TaxKindQuestion.tsx")[0]).toMatch(/\bborder-t\b/);
  });
});
