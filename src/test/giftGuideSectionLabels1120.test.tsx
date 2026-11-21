/**
 * Owner 11-20 on Dad ("Is the guide for dad or father in law?"): "Top picks" and "Father-in-Law" read as two titles
 * side by side. On a guide with more than one section the first reads "Top picks for Dad" and a merged person section
 * "For your father-in-law"; the jump chips carry the same labels after a "Jump to a section:" label.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   if (/^top picks$/i.test(title.trim())) return `Top picks for ${guide.title}`; |   if (false) return "";
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   if (id && PERSON_SECTIONS.has(id)) return `For your ${title.toLowerCase()}`; |   if (false) return "";
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sectionLabel } from "@/pages/info/giftGuides/GiftGuideView";

describe("gift guides: section headings read as parts of one guide (owner 11-20)", () => {
  it("Top picks names the guide; a person section reads 'For your ...'; other sections keep their title", () => {
    expect(sectionLabel({ title: "Dad" }, "Top picks", "top-picks")).toBe("Top picks for Dad");
    expect(sectionLabel({ title: "Dad" }, "Father-in-Law", "father-in-law")).toBe("For your father-in-law");
    expect(sectionLabel({ title: "Mom" }, "Mother-in-Law", "mother-in-law")).toBe("For your mother-in-law");
    expect(sectionLabel({ title: "Healthcare" }, "Nurses", "nurses")).toBe("Nurses");
  });

  it("every shipped person-guide page with two sections gets distinct, non-bare headings", () => {
    // For Her / For Him (owner 11-20 evening): Dad and Mom fold into For Him and For Her, sectioned by use.
    for (const [slug, title] of [["him", "For Him"], ["her", "For Her"]] as const) {
      const picks = (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: { section?: string; sectionId?: string }[] }).picks;
      const heads = [...new Map(picks.map((p) => [p.sectionId, p.section])).entries()].map(([id, t]) => sectionLabel({ title }, String(t), id));
      expect(heads.length, slug).toBeGreaterThan(1);
      expect(new Set(heads).size, slug).toBe(heads.length);
      for (const h of heads) expect(h, slug).not.toMatch(/^(Top picks|Father-in-Law|Mother-in-Law|undefined)$/);
    }
  });

  it("the jump chips sit after a visible label, so two chips never read as two titles", () => {
    const src = readFileSync("src/pages/info/giftGuides/GiftGuideView.tsx", "utf8");
    expect(src).toContain('<span className="gg-secnav-label" aria-hidden="true">{G.sectionNavLabel}:</span>');
    expect(src).toContain("{sectionLabel(guide, s.title, s.id)}</a>");
  });
});
