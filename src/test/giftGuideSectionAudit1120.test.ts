/**
 * Section audit 11-20: a pick the audit found sold out, discontinued, a dead link or last year's edition is on no guide
 * page, and a card that named the wrong product carries the real name (scripts/giftGuideSectionAudit1120.mjs, applied by
 * the picks generator's last pass).
 *
 * @mutate scripts/giftGuideSectionAudit1120.mjs |   if (GONE_1120.some(([re]) => re.test(name))) return undefined; |   if (GONE_1120.length < 0) return undefined;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GONE_1120, GONE_IN_GUIDE_1120, RENAMED_1120, auditFix1120 } from "../../scripts/giftGuideSectionAudit1120.mjs";

const DIR = join(__dirname, "..", "content", "giftGuidePicks");
type Pick = { name: string; brand?: string };
const guides = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ slug: f.replace(".json", ""), picks: (JSON.parse(readFileSync(join(DIR, f), "utf8")).picks ?? []) as Pick[] }));

describe("gift guide section audit 11-20", () => {
  it("drops a gone pick everywhere, a guide-only one in its guide alone, renames a misnamed card, leaves the rest", () => {
    expect(auditFix1120("mom", { name: "AeroGarden Harvest Elite" })).toBeUndefined();
    expect(auditFix1120("heroes", { name: "Durango Workhorse Ventilated Work Boot" })).toBeUndefined();
    const boot = { name: "Durango Workhorse Ventilated Work Boot" };
    expect(auditFix1120("work-life", boot)).toBe(boot);
    expect(auditFix1120("heroes", { name: "Columbia Men's Fleece", brand: "Columbia", href: "x" })).toEqual({ name: "The North Face Men's Glacier Fleece Jacket", brand: "The North Face", href: "x" });
    const mug = { name: "YETI Rambler 14 oz Mug" };
    expect(auditFix1120("dad", mug)).toBe(mug);
  });
  it("no generated guide page carries a gone pick or an old wrong name", () => {
    expect(guides.length).toBeGreaterThan(40);
    expect(GONE_1120.length).toBeGreaterThan(20);
    const left = guides.flatMap((g) => g.picks.filter((p) =>
      GONE_1120.some(([re]) => (re as RegExp).test(p.name)) || (GONE_IN_GUIDE_1120[g.slug as keyof typeof GONE_IN_GUIDE_1120] ?? []).some(([re]) => (re as RegExp).test(p.name)) || RENAMED_1120.some(([re]) => (re as RegExp).test(p.name)),
    ).map((p) => `${g.slug}: ${p.name}`));
    expect(left).toEqual([]);
  });
});
