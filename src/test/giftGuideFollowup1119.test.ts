/**
 * Gift guides, owner follow-ups after #4768 (2026-11-19, ~/.lh-shots/design-audit-loop/FOLLOWUP-OWNER-1119.md):
 *   - men's guides show no pink or pastel on any item type (pale mint Crocs, a pink YETI Roadie, a pink Skipjack polo);
 *   - baby items (soothers, loveys, rattles...) only on baby and new-parent guides;
 *   - the named removals (Kendra Scott Elisa in pink, the Nike AF1 '07 Suede, the pink Skipjack polo) and the old
 *     electronics (AirPods Pro 2, JBL Flip 5 / 6, Instinct 2, Forerunner 265, G733) show on no page;
 *   - the owner's own picks lead the guides they name; Advent Calendars and Gift Tags exist and hold picks;
 *   - every guide with one pick shows (owner: "just leave it, no one is looking anyway").
 * The owner's own picks (ownerPick) are exempt from the taste rules.
 *
 * @mutate scripts/giftGuideRules.mjs | export const MEN_COLOR_GUIDES = [...MEN_FAMILY_GUIDES, "nephew", "boys-teens", "brother-in-law", "new-dad"]; | export const MEN_COLOR_GUIDES = [];
 * @mutate src/content/giftGuideCatalog.ts | export const GUIDE_MIN_PICKS = 1; | export const GUIDE_MIN_PICKS = 6;
 */
import { describe, expect, it } from "vitest";
import { BABY_OK, BABY_ITEM, MEN_COLOR_GUIDES, MEN_PASTEL, OLD_ELECTRONICS, OWNER_REMOVED } from "../../scripts/giftGuideRules.mjs";
import { GUIDE_MIN_PICKS, guideBySlug } from "@/content/giftGuideCatalog";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

type Pick = { name: string; brand?: string; href: string; image?: string; ownerPick?: true; retailer?: string; store?: string };
// Big batch 1120: a merged guide's section is read under its old slug (helpers/giftGuideSections.ts).
const pageOf = (slug: string): Pick[] => sectionPageOf<Pick>(slug);
const slugs = Object.keys(sectionChunks());
const guides = slugs.filter((s: string) => !s.startsWith("store-"));

describe("gift guides: owner follow-ups 11-19", () => {
  it("men's guides show no pink or pastel on any item", () => {
    const bad = MEN_COLOR_GUIDES.flatMap((s: string) => pageOf(s).filter((p) => !p.ownerPick && MEN_PASTEL.test(`${p.name} ${String(p.image ?? "").replace(/[-_]/g, " ")}`)).map((p) => `${s}: ${p.name}`));
    expect(MEN_COLOR_GUIDES.reduce((n: number, s: string) => n + pageOf(s).length, 0)).toBeGreaterThan(60);
    expect(bad).toEqual([]);
  });

  it("baby items show only on baby and new-parent guides", () => {
    const bad = guides.filter((s: string) => !BABY_OK(s)).flatMap((s: string) => pageOf(s).filter((p) => !p.ownerPick && BABY_ITEM.test(p.name)).map((p) => `${s}: ${p.name}`));
    expect(bad).toEqual([]);
  });

  it("the named removals and old electronics show on no page, store pages included", () => {
    let n = 0;
    const bad = slugs.flatMap((s: string) => pageOf(s).filter((p) => { n += 1; return !p.ownerPick && (OWNER_REMOVED(p) || OLD_ELECTRONICS.test(p.name)); }).map((p) => `${s}: ${p.name}`));
    expect(n).toBeGreaterThan(3000);
    expect(bad).toEqual([]);
  });

  it("owner picks keep their badge on guides (no longer first: owner 11-19 ~6:40 PM sorts by commission); Advent Calendars and Gift Tags hold picks; a guide shows from one pick", () => {
    const withOwner = guides.filter((s: string) => pageOf(s).some((p) => p.ownerPick));
    expect(withOwner.length).toBeGreaterThan(20);
    for (const s of ["advent-calendars", "gift-tags"]) {
      expect(pageOf(s).length, s).toBeGreaterThan(3);
      expect(guideBySlug(s)?.empty, s).toBeFalsy();
    }
    expect(GUIDE_MIN_PICKS).toBe(1);
    const one = guides.find((s: string) => pageOf(s).length >= 1 && pageOf(s).length < 6 && guideBySlug(s));
    expect(one).toBeDefined();
    expect(guideBySlug(one!)?.empty).toBeFalsy();
  });
});
