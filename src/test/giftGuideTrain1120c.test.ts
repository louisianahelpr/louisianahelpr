/**
 * Gift guides train 1120c (lead 44, 2026-11-20), read from the shipped chunks, the deals page and the train's rule module
 * (scripts/giftGuideTrain1120c.mjs, rules in scripts/gift-guide-train-1120c.json):
 *   - PRICES (owner 11-20 12:32 PM: "the guides also need to show prices"): most non-Amazon picks carry a checked price,
 *     never an Amazon pick; no shown gift over $500 but her named keep (the Dyson Airwrap);
 *   - the Creator Connections adds hold one spot each, on Amazon with the louisianahelpr-20 tag and their campaign's
 *     end day, and no exact product is shown on two guides;
 *   - XTRATUF XT25: a dated code chip on every XTRATUF card, the code in Deals & codes and a row on the deals page;
 *   - the owner adds waiting on links are listed and NOT placed.
 *
 * @mutate scripts/giftGuideTrain1120c.mjs |       pageList[slug] = pageList[slug].filter((p) => !(typeof p.price === "number" && p.price > cap.max) \|\| keep(p)); |       pageList[slug] = pageList[slug].filter(() => true);
 * @mutate scripts/giftGuideTrain1120c.mjs |         return { ...p, code: c.code, ...(c.ends ? { codeEnds: c.ends } : {}) }; |         return { ...p, code: c.code };
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { applyTrain1120c } from "../../scripts/giftGuideTrain1120c.mjs";

type Pick = { name: string; brand?: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; code?: string; codeEnds?: string; campaignEnds?: string };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, { picks: Pick[] }>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))]));
const ALL = [...CHUNKS.values()].flatMap((c) => c.picks);
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-train-1120c.json", "utf8"));
const isAmazon = (p: Pick) => /(^|\.)amazon\.com$|amzn\.to$/.test(new URL(p.href).hostname) || p.store === "store-amazon";

describe("gift guides train 1120c", () => {
  it("prices: most non-Amazon picks show a checked price; Amazon never; nothing over $500 but the Dyson Airwrap", () => {
    const nonAmazon = ALL.filter((p) => !isAmazon(p));
    const priced = nonAmazon.filter((p) => typeof p.price === "number");
    // 305 of ~1,395 before this train (owner 11-20); 777 of 1,390 after (measured 2026-11-20).
    expect(priced.length / nonAmazon.length).toBeGreaterThan(0.5);
    for (const p of priced) expect(p.priceAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const p of ALL.filter(isAmazon)) expect(p.price, p.name).toBeUndefined();
    expect(priced.filter((p) => (p.price ?? 0) > 500).map((p) => p.name).filter((n) => !/Dyson Airwrap/i.test(n))).toEqual([]);
  });

  it("the Creator Connections adds hold one spot each, tagged, with their end day; no product twice", () => {
    const amazonAdds = SPEC.adds.filter((a: { row: Pick }) => /amazon\.com\/dp\//.test(a.row.href));
    expect(amazonAdds.length).toBeGreaterThan(20);
    let placed = 0;
    for (const a of amazonAdds) {
      expect(a.row.href, a.row.name).toMatch(/\?tag=louisianahelpr-20$/);
      // Owner's standard plan (11-20 evening) cut most of these adds from its 49 guides: an add holds one spot or none,
      // never two. PLACED_FLOOR is what the plan keeps (measured 6 on 2026-11-20 night).
      const spots = ALL.filter((p) => p.href === a.row.href && !CHUNKS.get("store-amazon")?.picks.includes(p)).length;
      expect(spots, a.row.name).toBeLessThanOrEqual(1);
      placed += spots;
      expect(a.row.image, a.row.name).toMatch(/^https:\/\//);
    }
    expect(placed).toBeGreaterThanOrEqual(6);
    const guides = [...CHUNKS].filter(([s]) => !s.startsWith("store-") && s !== "25-days-sponsors");
    const seen = new Map<string, string>();
    for (const [slug, c] of guides) for (const p of c.picks) {
      if (!SPEC.adds.some((a: { row: Pick }) => a.row.href === p.href)) continue;
      const key = p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      expect(seen.get(key), `${p.name} on ${slug}`).toBeUndefined();
      seen.set(key, slug);
    }
    const cryo = ALL.filter((p) => /CryoGlow/.test(p.name) && !p.href.includes("store-"));
    expect(cryo.map((p) => p.href)).toEqual(["https://www.amazon.com/dp/B0DSGJCS47?tag=louisianahelpr-20"]);
  });

  it("XTRATUF XT25: a dated chip on every XTRATUF card, the code in Deals & codes, a deals page row", () => {
    const xt = ALL.filter((p) => p.brand === "XTRATUF");
    expect(xt.length).toBeGreaterThanOrEqual(3); // the owner's standard plan (11-20 evening) keeps 3 XTRATUF cards
    for (const p of xt) expect([p.code, p.codeEnds], p.name).toEqual(["XT25", "2026-11-29"]);
    expect(readFileSync("src/content/giftGuides.ts", "utf8")).toMatch(/store: "XTRATUF", code: "XT25"[^}]*expires: "2026-11-29"/);
    const deals = JSON.parse(readFileSync("src/content/giftGuideDeals.json", "utf8")) as { brand: string; code?: string; ends?: string }[];
    expect(deals.find((d) => d.brand === "XTRATUF")).toMatchObject({ code: "XT25", ends: "2026-11-29" });
  });

  it("the owner adds waiting on links are listed and not placed", () => {
    expect(SPEC.waitingOnLinks).toMatch(/Kérastase.*Braun.*HydroJug.*Ugly Stik.*Coach glasses case/s);
    for (const re of [/K[ée]rastase/i, /Silk-expert/i, /Ugly Stik/i, /Stradic|Sedona reel/i, /\bLew's\b/i, /Abu Garcia/i, /St\. Croix/i, /gun cleaning/i]) expect(ALL.some((p) => re.test(p.name)), String(re)).toBe(false);
  });

  it("the rules: brand codes carry their end day; the cap keeps the named keeps", () => {
    const pages: Record<string, Pick[]> = { a: [{ name: "XTRATUF Boot", brand: "XTRATUF", href: "https://x.test/1" }, { name: "Big TV", href: "https://x.test/2", price: 900 }, { name: "Dyson Airwrap", href: "https://x.test/3", price: 700 }] };
    const t = applyTrain1120c(pages, {}, { brandCodes: [{ brand: "XTRATUF", code: "XT25", ends: "2026-11-29" }], priceCap: { max: 500, keep: ["Dyson Airwrap"] } }, { sponsorsGuide: "25-days-sponsors", readJson: () => [] });
    expect(pages.a.map((p) => p.name)).toEqual(["XTRATUF Boot", "Dyson Airwrap"]);
    expect(pages.a[0]).toMatchObject({ code: "XT25", codeEnds: "2026-11-29" });
    expect(t.counts).toMatchObject({ codes: 1, overCap: 1 });
  });
});
