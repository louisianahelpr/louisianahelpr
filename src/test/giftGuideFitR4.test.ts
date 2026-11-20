/**
 * Gift guide item fit, round 4 (2026-11-19, ~/.lh-shots/design-audit-loop/gg-r4-fit: 12 High, 89 Medium, 72 Low) and the
 * links audit round 4 (gg-r4-links), read from the generated guide chunks (src/content/giftGuidePicks) and the import's
 * rules (scripts/giftGuideRules.mjs, FIT AUDIT R4):
 *   - each career keeps only items that fit that job: no medical care anywhere, stethoscopes only on the clinical guides,
 *     nurse-labeled items only on the nurse guides, no "<job> Gifts for Women" names, and the audit's per-guide misfits
 *     (R4_OFF) gone;
 *   - one of a kind per guide (TYPE_CAPS: trauma shears, penlights, truck fridges, CB radios, book lights ...) and one row
 *     per product (PRODUCT_TWINS: the MX Master 3S under two links, MUCK Arctic Pro, Hoka Men's Bondi 9);
 *   - the color guides hold their color, not another one or a pun on it;
 *   - the brand cap of 3 holds in the Louisiana guides too, and North Louisiana holds only North Louisiana items;
 *   - hair tools count as beauty (Kitsch curlers were on 17 guides, the Dyson Airwrap on 16): at most 6 guides each;
 *   - no name cut at its comma ("Salt, Fat"), no store as a brand, and the links audit's wrong-page FreeSip pin
 *     (p-104112945, a 40 oz bottle) nowhere.
 *
 * @mutate scripts/giftGuideRules.mjs |   if (medicalCare(p)) return "r4: medical care"; |   if (false) return "r4: medical care";
 * @mutate scripts/giftGuideRules.mjs |   if (STETHOSCOPE.test(name) && !STETHOSCOPE_GUIDES.test(slug)) return "r4: stethoscope"; |   if (false) return "r4: stethoscope";
 * @mutate scripts/giftGuideRules.mjs |   if (vagueGiftName(p)) return "r4: vague name"; |   if (false) return "r4: vague name";
 * @mutate scripts/giftGuideRules.mjs |   [/\btrauma shears\b\|\bmedical scissors\b/i, 1], |   [/\btrauma shears\b\|\bmedical scissors\b/i, 9],
 * @mutate scripts/giftGuideRules.mjs |   if (own.test(name)) return "color pun"; |   if (own.test(name)) return "";
 * @mutate scripts/gift-guide-picks.mjs |   const capped = (slug) => !slug.startsWith("store-") && slug !== "gift-cards" |   const capped = (slug) => !slug.startsWith("store-") && !LOUISIANA_GUIDES.has(slug) && slug !== "gift-cards"
 * @mutate scripts/gift-guide-picks.mjs |       if (!r && caps.some(([k, max]) => (typed.get(k) ?? 0) >= max)) r = "r4: type cap"; |       if (false) r = "r4: type cap";
 * @mutate scripts/gift-guide-picks.mjs |       if (!beautyItem(p) \|\| beautyKeep.get(beautyKey(p))?.has(slug)) return true; |       return true;
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import {
  BANNED_LINKS, BEAUTY_GUIDE_MAX, NORTH_LA, NURSE_GUIDES, NURSE_LABEL, R4_OFF, STETHOSCOPE, STETHOSCOPE_GUIDES, beautyItem, brandKey,
  colorWhy, fitR4Why, medicalCare, r4Name, retailerBrand, typeCaps, vagueGiftName,
} from "../../scripts/giftGuideRules.mjs";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

type Pick = { name: string; brand?: string; href: string };
const DIR = "src/content/giftGuidePicks";
// The owner's own picks (ownerPick, _owner-picks.json) are exempt from every rule (owner 11-19).
// Big batch 1120: a merged guide's section is read under its old slug (helpers/giftGuideSections.ts).
const pageOf = (slug: string): Pick[] => sectionPageOf<Pick & { ownerPick?: true }>(slug).filter((p) => !p.ownerPick);
const slugs = Object.keys(sectionChunks());
const guides = slugs.filter((s) => !s.startsWith("store-") && s !== "25-days-sponsors");
const indexSrc = readFileSync("src/content/giftGuideIndex.ts", "utf8");
const groupOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
const louisiana = guides.filter((s) => groupOf.get(s) === "Louisiana");

describe("gift guides: item fit r4 (fit + links audits, 11-19)", () => {
  it("the rules read the audit's examples", () => {
    expect(medicalCare({ name: "Tea Tree Oil Epsom Salt Foot Soak for Toenail Fungus Treatment" })).toBe(true);
    expect(medicalCare({ name: "Luden's Sore Throat Relief Drops" })).toBe(true);
    expect(medicalCare({ name: "Purell Advanced Hand Sanitizer Variety Pack" })).toBe(true);
    expect(medicalCare({ name: "Ergodyne ProFlex 1650 Back Support Belt" })).toBe(true);
    expect(medicalCare({ name: "Nekteck Shiatsu Neck Massager with Heat for Pain Relief" })).toBe(false);
    expect(medicalCare({ name: "Heated Stadium Seats for Bleachers with Back Support" })).toBe(false);
    expect(STETHOSCOPE.test("Classic III Stethoscopes")).toBe(true);
    expect(STETHOSCOPE.test("Stethoscope Name Tag Personalized")).toBe(false);
    expect(STETHOSCOPE_GUIDES.test("hospital-front-desk")).toBe(false);
    expect(STETHOSCOPE_GUIDES.test("er-nurses")).toBe(true);
    expect(NURSE_LABEL.test("CAVN Pen Light with Pupil Gauge LED Penlight for Nurses Doctors")).toBe(false);
    expect(vagueGiftName({ name: "HEXMOZ Christmas Teacher Gifts for Women", brand: "HEXMOZ" })).toBe(true);
    expect(vagueGiftName({ name: "URBRE Bus Driver Gifts for Women", brand: "WYT" })).toBe(true);
    expect(vagueGiftName({ name: "RAK Magnetic Pickup Tool Gifts for Men", brand: "RAK" })).toBe(false);
    expect(fitR4Why("educators", "By career", { name: "SECRUI Wireless Doorbell" })).not.toBe("");
    expect(fitR4Why("car-lover", "Hobbies", { name: "10x8ft Golf Practice Net With Auto Ball Return" })).not.toBe("");
    expect(fitR4Why("educators", "By career", { name: "Low-Odor Dry Erase Markers, Chisel Tip, 12 Count", brand: "EXPO" })).toBe("");
    expect(colorWhy("red-lover", { name: "JBL Grip Portable Bluetooth Speaker Blue" })).toBe("another color");
    expect(colorWhy("red-lover", { name: "HS21 Headlamp with Red Light" })).toBe("color pun");
    expect(colorWhy("red-lover", { name: "Playing Cards, 2 Pack, Red and Blue" })).toBe("");
    expect(colorWhy("yellow-lover", { name: "Brimmer Sunglasses (Jet Black with Polished Gold)" })).toBe("another color");
    expect(typeCaps("truck-drivers", { name: "12V Refrigerator, 23 Quart" }).length).toBeGreaterThan(0);
    expect(typeCaps("engineers", { name: "Mx Master Black 3s Wireless Mouse" }).map(([k]) => k))
      .toEqual(typeCaps("engineers", { name: "Logitech MX Master 3S Performance Wireless Mouse" }).map(([k]) => k));
    expect(r4Name({ name: "Salt, Fat", brand: "Salt" })).toEqual({ name: "Salt, Fat, Acid, Heat", brand: "Samin Nosrat" });
    expect(retailerBrand("Le Creuset 1.25 Qt Enamel on Steel Demi Tea Kettle", "Macy's")).toBe("Le Creuset");
    expect(retailerBrand("Walmart+ membership", "Walmart")).toBe("Walmart");
    expect(beautyItem({ name: "Kitsch Heatless Satin Curlers, Jumbo 4-Piece", brand: "Kitsch" })).toBe(true);
    expect(beautyItem({ name: "Dyson Airwrap i.d. Multi-Styler", brand: "Dyson" })).toBe(true);
    expect(NORTH_LA.test("RDC 200 Duck Call Duck Commander")).toBe(true);
    expect(NORTH_LA.test("Tony Chachere's Instant Roux Mix")).toBe(false);
    expect(BANNED_LINKS.get("https://go.shopmy.us/p-104112945")).toBe("wrong page");
  });

  it("every guide follows them", () => {
    expect(guides.length).toBeGreaterThan(150);
    const bad: string[] = [];
    let picks = 0;
    for (const slug of guides) {
      const list = pageOf(slug);
      picks += list.length;
      const group = groupOf.get(slug) ?? "";
      const caps = new Map<string, number>();
      const perBrand = new Map<string, number>();
      for (const p of list) {
        const r = fitR4Why(slug, group, p);
        if (r) bad.push(`${slug}: ${r}: ${p.name}`);
        if (R4_OFF[slug as keyof typeof R4_OFF]?.test(`${p.name} ${p.brand ?? ""}`)) bad.push(`${slug}: misfit: ${p.name}`);
        if (NURSE_LABEL.test(p.name) && !NURSE_GUIDES.test(slug) && !/bab(y|ies)|^(new-mom|mom-to-be)$/.test(slug)) bad.push(`${slug}: nurse item: ${p.name}`);
        for (const [k, max] of typeCaps(slug, p)) {
          caps.set(k, (caps.get(k) ?? 0) + 1);
          if (caps.get(k) === max + 1) bad.push(`${slug}: more than ${max} of ${k} (${p.name})`);
        }
        // A title cut at its comma: the brand is its first word ("Salt, Fat" by "Salt").
        if (p.brand && new RegExp(`^${p.brand.replace(/[^\w]/g, "\\$&")}, \\w+$`).test(p.name)) bad.push(`${slug}: cut-off name: ${p.name}`);
        if (/^(macy'?s|target|target\.com|tractor supply)$/i.test(p.brand ?? "")) bad.push(`${slug}: store as brand: ${p.name}`);
        if (p.href === "https://go.shopmy.us/p-104112945") bad.push(`${slug}: 40 oz FreeSip pin: ${p.name}`);
        const b = brandKey(p.brand ?? "");
        if (b && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "")) perBrand.set(b, (perBrand.get(b) ?? 0) + 1);
      }
      if (louisiana.includes(slug)) for (const [b, n] of perBrand) if (n > 3) bad.push(`${slug}: ${n} x ${b}`);
    }
    expect(picks).toBeGreaterThan(700); // one guide per product (owner 11-19): the guides are smaller
    expect(louisiana.length).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it("North Louisiana holds North Louisiana items, and hair tools keep to 6 guides", () => {
    for (const p of pageOf("north-louisiana")) expect(`${p.name} ${p.brand ?? ""}`).toMatch(NORTH_LA);
    const on = (rx: RegExp) => guides.filter((s) => pageOf(s).some((p) => rx.test(`${p.name} ${p.brand ?? ""}`)));
    const kitsch = on(/\bheatless satin curlers, jumbo\b/i);
    const airwrap = on(/\bairwrap\b/i);
    expect(kitsch.length).toBeGreaterThanOrEqual(0); // one guide per product + removal lists (owner 11-19)
    expect(kitsch.length).toBeLessThanOrEqual(BEAUTY_GUIDE_MAX);
    expect(airwrap.length).toBeGreaterThan(0);
    expect(airwrap.length).toBeLessThanOrEqual(BEAUTY_GUIDE_MAX);
    expect(airwrap.filter((s) => !["her", "wife", "girlfriend", "mom", "sister", "self-care-lover"].includes(s))).toEqual([]);
  });

  it("the links audit's fixes hold on the store pages too", () => {
    const stores = slugs.filter((s) => s.startsWith("store-"));
    // Big batch 1120: the 30 kept store pages (src/content/giftGuideMerges.mjs STORE_PAGES_KEPT).
    expect(stores.length).toBeGreaterThan(25);
    const banned = ["https://go.shopmy.us/p-104112945", "https://go.shopmy.us/p-104209798", "https://mavely.app.link/rUbFIqQTa8b",
      "https://mavely.app.link/7qwASmTTa8b", "https://mavely.app.link/EmDfi5TTa8b", "https://mavely.app.link/67wI8mUTa8b"];
    const hits = stores.flatMap((s) => pageOf(s).filter((p) => banned.includes(p.href)).map((p) => `${s}: ${p.name}`));
    expect(hits).toEqual([]);
    // Funko's homepage-only deal (its only deal: the store page leaves with it).
    const withDeal = stores.filter((s) => (JSON.parse(readFileSync(`${DIR}/${s}.json`, "utf8")) as { deals?: { href?: string }[] }).deals?.some((d) => d.href === "https://mavely.app.link/CAOsxnPQa8b"));
    expect(withDeal).toEqual([]);
  });
});
