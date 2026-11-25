/**
 * Guide critical-path trim (2026-11-24): src/content/giftGuideCatalog.ts no longer reads src/content/giftGuidesAmazon.ts,
 * the owner's 46 Amazon artifact guides. Every one of them is retired (src/content/giftGuideLive.mjs), so they changed no
 * live guide: the catalog's whole public output (GUIDES with their links and picks, rows, related guides, newSlugFor
 * over ~700 slugs, RETIRED_SLUGS, unplacedGuides, search, top picks; before and after every chunk loaded) was dumped
 * before and after the cut and compared byte for byte, identical (again after rebasing on 7f87d32eae). Yet the catalog is
 * on every /gift-guides/<slug> first load, so the data cost 14,219 B gz there (critical-path.mjs, land.sh's build env:
 * 329,074 -> 314,855 B), against a budget the owner never raises (nothing-slow-for-users).
 *
 * This guard keeps the cut and its equivalence true:
 *   - the catalog imports nothing from the Amazon file (comments ignored), and the guide route's whole static reach
 *     (src/pages/info/GiftGuides.tsx, walked with bootReach.mjs's staticReach, the walk the chunk guards use) never
 *     reaches it, so no other module drags the 13.8 KB back onto the route;
 *   - the equivalence, as a lasting condition rather than a frozen dump (a snapshot of the catalog would go red on every
 *     guide edit the owner makes): the Amazon drafts could only ever reach the catalog's output as their own guides or
 *     through the "Shop by store" guides (storeGuide: every pick on a store, which read the Amazon picks too). None of
 *     those slugs is live, and none is in GUIDES before or after every picks chunk loads. Reviving one (adding its slug
 *     to LIVE_GUIDES_1121) fails here, because the catalog would then show it short of the Amazon picks: re-add the
 *     Amazon drafts to the catalog in the same change and update this guard.
 *
 * @mutate src/content/giftGuideCatalog.ts | import { MERGED_INTO, isFoldedStore } from "@/content/giftGuideMerges.mjs"; | import { MERGED_INTO, isFoldedStore } from "@/content/giftGuideMerges.mjs"; import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon"; void AMAZON_GUIDES;
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", "him", "kids", ...THEME_GUIDES_1124, "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"]; | export const LIVE_GUIDES_1121 = ["her", "him", "kids", ...THEME_GUIDES_1124, "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday", "under-25"];
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", "him", "kids", ...THEME_GUIDES_1124, "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"]; | export const LIVE_GUIDES_1121 = ["her", "him", "kids", ...THEME_GUIDES_1124, "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday", "store-amazon"];
 * @mutate src/pages/info/GiftGuides.tsx | import { giftGuides as G } from "@/content/giftGuides"; | import { giftGuides as G } from "@/content/giftGuides"; import "@/content/giftGuidesAmazon";
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AMAZON_GUIDES } from "@/content/giftGuidesAmazon";
import { GUIDES, OLD_SLUGS, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const CATALOG = "src/content/giftGuideCatalog.ts";
const amazonSlugs = AMAZON_GUIDES.map((g) => OLD_SLUGS[g.slug] ?? g.slug);
/** The "Shop by store" guides the catalog builds with storeGuide(...), read from its source. */
const storeSlugs = [...blankComments(readFileSync(resolve(ROOT, CATALOG), "utf8")).matchAll(/storeGuide\(\[[^\]]*\],\s*"([^"]+)"/g)].map((m) => m[1]);

describe("the guide catalog carries no retired Amazon guide data", () => {
  it("giftGuideCatalog.ts imports nothing from giftGuidesAmazon.ts", () => {
    const code = blankComments(readFileSync(resolve(ROOT, CATALOG), "utf8"));
    expect(code).toMatch(/from "@\/content\/giftGuidePicks"/);
    expect(code).not.toMatch(/giftGuidesAmazon/);
  });

  it("the /gift-guides/:slug route's static reach never reaches giftGuidesAmazon.ts", () => {
    const reach = [...staticReach(ROOT, [resolve(ROOT, "src/pages/info/GiftGuides.tsx")])].map(rel);
    expect(reach.length).toBeGreaterThan(50);
    expect(reach).toContain(CATALOG);
    expect(reach).toContain("src/content/giftGuides.ts");
    expect(reach).not.toContain("src/content/giftGuidesAmazon.ts");
  });

  it("no Amazon artifact guide and no store guide is live (the only ways their data reached the output)", () => {
    expect(AMAZON_GUIDES.length).toBeGreaterThan(40);
    expect(storeSlugs).toContain("store-amazon");
    expect(amazonSlugs.filter((slug) => isLiveGuide(slug))).toEqual([]);
    expect(storeSlugs.filter((slug) => isLiveGuide(slug))).toEqual([]);
  });

  it("GUIDES holds none of those slugs, before or after every picks chunk loads", async () => {
    const shut = new Set([...amazonSlugs, ...storeSlugs]);
    expect(GUIDES.length).toBeGreaterThan(3);
    expect(GUIDES.map((g) => g.slug).filter((s) => shut.has(s))).toEqual([]);
    await loadAllGuidePicks();
    expect(GUIDES.map((g) => g.slug).filter((s) => shut.has(s))).toEqual([]);
  });
});
