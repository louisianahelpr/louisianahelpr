/**
 * Holiday design audit B (2026-11-20, ~/.lh-shots/holiday-audit-1120/B-findings.md), read from the shipped chunks and
 * the generated picks module, never from the pass that wrote them:
 *   - SHOPPER TEXT ONLY (B #1 High): no card name or subtitle, deal, sale or code carries a researcher's note (a
 *     commission rate, "got clicks", "verify", "image borrowed from another creator pin", "existing pick", TODO) and no
 *     subtitle is a lowercase note fragment ("men's wallet gift");
 *   - NO AMAZON RATINGS (B #2 High, Amazon Associates): no "4.8 stars", "4,700+ ratings" or review count in shown text;
 *   - SPONSORS (B #3, #13 High): every brand on the public 25 Days lineup (src/content/sponsorPage.ts) has a card on the
 *     25 Days Sponsors guide (owner 11-22: "Find images from their Facebook or use there logo so all are included", so
 *     none is named only any more); the dropped sponsor (owner 11-20: R&R Wedding Co.) shows nowhere;
 *   - GIFTS, NOT LOGOS (B #14, #16 High): no guide card shows a sponsor logo file, except a sponsor's logo card on the
 *     sponsors guide (owner 11-22: a sponsor with no gift photo shows its logo and the gift it gives);
 *   - WRONG FIT / WRONG PHOTO (B #61, #63, #65, #58 High): Bird Lover is pet birds (no wild-bird feeders), Fish has 3+
 *     aquarium items, and the known wrong products and photos never come back;
 *   - DEALS (B #69): no blocked or off-rule retailer in any deals box, sale or code.
 *
 * @mutate scripts/giftGuideHolidayB1120.mjs |   if (!parts.length \|\| /^[a-z#]/.test(parts[0])) return ""; |   if (!parts.length) return "";
 * @mutate scripts/giftGuideHolidayB1120.mjs |     if (tail.length && tail.every((w) => COMPANY_WORDS.has(w.toLowerCase())) && fold(rest.split(/\s+/)[0]) === fold(head)) n = rest; |     if (tail.length && fold(rest.split(/\s+/)[0]) === fold(head)) n = rest;
 */
import { NOT_CONFIRMED } from "../../scripts/gift-guide-sponsor-logos.mjs";
import { blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { cleanName, shopperLine } from "../../scripts/giftGuideHolidayB1120.mjs";

type Pick = { name: string; brand?: string; line?: string; href: string; image?: string; section?: string; sectionId?: string; sponsor?: boolean };
type Deal = { title: string; href: string };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, { picks: Pick[]; deals?: Deal[] }>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))]));
// Owner's standard plan (11-20 evening, scripts/gift-guide-standard-1120.json): she chose every pick, section and order on
// the planned guides, so the plan wins there (guarded by giftGuideStandard1120.test.ts).
const PLANNED = new Set(Object.keys((JSON.parse(readFileSync("scripts/gift-guide-standard-1120.json", "utf8")) as { guides: Record<string, unknown> }).guides));
const ALL = [...CHUNKS.values()].flatMap((c) => c.picks);
const MOD = readFileSync("src/content/giftGuidePicks.ts", "utf8");
const exported = <T,>(name: string): T => JSON.parse(MOD.match(new RegExp(`export const ${name}[^=]*= (.*);\\n`))?.[1] ?? "null") as T;
const TOP_PICKS = exported<Pick[]>("TOP_PICKS");
const SALES = exported<{ store: string; offer: string; href: string }[]>("SALES");
const DEAL_CODES = exported<{ store: string; offer: string; code: string }[]>("DEAL_CODES");
const NAME_ONLY = exported<Record<string, string[]>>("NAME_ONLY_SPONSORS");
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-holiday-b-1120.json", "utf8"));
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** A researcher's note (B #1): rates, clicks, to-dos, photo sources. Kept here, apart from the pass's own words. */
const NOTE = /\b(best|highest|top|better)\b[\w' -]{0,24}\brates?\b|\bhighest[- ]paying\b|\bcommissions?\b|\bgot (a |some )?clicks?\b|\bclicks\b|\bverify\b|\beyeball\b|\bborrowed\b|\bexisting pick\b|\bcreator pin\b|\bTODO\b|\bTBD\b|\bgoldbelly\s*\d|\(\s*\d+(\.\d+)?\s*%\s*\)|\b\d+(\.\d+)?\s*%\s*(rate|commission)\b|\b(second|another) colorway\b/i;
/** An Amazon-style rating or review count (B #2). */
const RATING = /\b\d(\.\d)?\s*(out of 5\s*)?stars?\b|\b[\d,]+\+?\s*(ratings?|reviews?)\b/i;

describe("gift guides holiday audit B", () => {
  it("shown text carries no researcher's note and no lowercase note fragment", () => {
    const shown = [...ALL, ...TOP_PICKS];
    // ~1,500 picks on 52 chunks (measured 2026-11-20).
    expect(shown.length).toBeGreaterThan(770);
    const bad = shown.flatMap((p) => [p.name, p.line ?? ""].filter((t) => NOTE.test(t)).map((t) => `${p.name}: ${t}`));
    expect(bad).toEqual([]);
    expect(shown.filter((p) => /^[a-z#]/.test(p.line ?? "")).map((p) => `${p.name}: ${p.line}`)).toEqual([]);
    const deals = [...CHUNKS.values()].flatMap((c) => c.deals ?? []).map((d) => d.title);
    expect([...deals, ...SALES.map((s) => s.offer), ...DEAL_CODES.map((c) => c.offer)].filter((t) => NOTE.test(t))).toEqual([]);
  });

  it("no Amazon star rating or review count in any shown name or subtitle", () => {
    expect([...ALL, ...TOP_PICKS].flatMap((p) => [p.name, p.line ?? ""]).filter((t) => RATING.test(t))).toEqual([]);
  });

  it("every 25 Days sponsor has a card on the sponsors guide (none named only); the dropped one shows nowhere", () => {
    const src = readFileSync("src/content/sponsorPage.ts", "utf8");
    const short = (n: string) => n.split(/\s*[:(·]\s*/)[0].replace(/\s*\/.*$/, "").trim();
    const dropped = (n: string) => SPEC.droppedSponsors.some((d: { brand: string }) => fold(n).startsWith(fold(d.brand)));
    // Owner 11-21: a sponsor whose prize, value or delivery is not confirmed is off the sponsors guide until it is.
    // A brand on the owner's guide blocklist (Adagio Teas, a 25 Days sponsor since 2026-11-23) is on no guide at all.
    const lineup = [...new Set([...src.matchAll(/\{ brand: "([^"]+)", prize:/g)].map((m) => short(m[1])))].filter((b) => b !== "Louisiana Helpr" && !dropped(b) && !NOT_CONFIRMED.has(b) && !blockedBrand({ brand: b }));
    expect(lineup).not.toContain("Adagio Teas");
    // 103 brands on the lineup on 2026-11-20, one dropped by the owner; 92 confirmed on 2026-11-21 (16 not confirmed yet).
    expect(lineup.length).toBeGreaterThanOrEqual(92);
    const sg = CHUNKS.get("25-days-sponsors")?.picks ?? [];
    // Owner 11-22: every sponsor once named only is a logo card, so the sponsors guide names nobody.
    expect(NAME_ONLY["25-days-sponsors"]).toBeUndefined();
    const named: string[] = [];
    const alias: Record<string, string[]> = SPEC.lineupAlias;
    const missing = lineup.filter((b) => {
      const frags = (alias[b] ?? [b]).map(fold);
      const card = sg.some((p) => frags.some((f) => fold(p.brand).startsWith(f) || fold(p.name).startsWith(f) || (f.length >= 6 && fold(p.name).includes(f))));
      const name = named.some((n) => frags.some((f) => fold(n).startsWith(f) || f.startsWith(fold(n))) || fold(b).startsWith(fold(n)));
      return !card && !name;
    });
    expect(missing).toEqual([]);
    // 40 gift cards + 64 logo cards (measured 2026-11-22).
    expect(sg.length).toBeGreaterThan(100);
    expect(new Set(sg.map((p) => p.sectionId)).size).toBe(3);
    // R&R Wedding Co. (owner 11-20): no card, no name, no logo, no Small Business Saturday card, no allowed link host.
    const rr = /R&R Wedding|rrwed(ding)?co\.com/i;
    expect(ALL.filter((p) => rr.test(`${p.name} ${p.brand ?? ""} ${p.href}`)).map((p) => p.name)).toEqual([]);
    expect(JSON.stringify(NAME_ONLY)).not.toMatch(rr);
    for (const f of ["src/content/giftGuideSponsorLogos.json", "src/content/giftGuideSmallBiz.json", "src/content/giftGuideSearchIndex.json"]) expect(readFileSync(f, "utf8"), f).not.toMatch(rr);
    expect(readFileSync("src/content/giftGuides.ts", "utf8")).not.toContain("rrweddingco.com");
  });

  it("guide cards show gifts, never a sponsor's logo file (but a sponsor's logo card on the sponsors guide)", () => {
    const guides = [...CHUNKS].filter(([s]) => !s.startsWith("store-"));
    // Owner 11-22: a logo card (it names the gift it gives) shows its logo, and only on the sponsors guide.
    const logoCard = (s: string, p: Pick & { gift?: string }) => s === "25-days-sponsors" && Boolean(p.gift);
    const logos = guides.flatMap(([s, c]) => c.picks.filter((p) => /\/gift-guides\/(small-biz|sponsors)\//.test(p.image ?? "") && !logoCard(s, p)).map((p) => `${s}: ${p.name}`));
    expect(logos).toEqual([]);
    expect(guides.flatMap(([s, c]) => c.picks.filter((p) => (p as { gift?: string }).gift && s !== "25-days-sponsors").map((p) => `${s}: ${p.name}`))).toEqual([]);
    expect((CHUNKS.get("25-days-sponsors")?.picks ?? []).filter((p) => /\/gift-guides\/sponsors\//.test(p.image ?? "")).length).toBeGreaterThan(50);
    // Shop Small keeps product cards for the sponsors with a shop photo (10 on 2026-11-20).
    expect((CHUNKS.get("shop-small-louisiana")?.picks ?? []).filter((p) => p.sponsor).length).toBeGreaterThan(5);
  });

  it("Bird Lover is pet birds, Fish has aquarium gifts, and the known wrong products and photos stay out", () => {
    const pets = CHUNKS.get("pets")?.picks ?? [];
    // The owner's plan (11-20 evening) adds a section for backyard birds: a bird feeder sits only there, never with the pet birds.
    expect(pets.filter((p) => /feeder/i.test(p.name) && /bird/i.test(p.name) && !/backyard birds/i.test(p.section ?? "")).map((p) => p.name)).toEqual([]);
    expect(pets.some((p) => /Sibley/i.test(p.name))).toBe(false);
    expect(pets.filter((p) => /aquarium|betta|fish tank|fluval/i.test(p.name)).length).toBeGreaterThanOrEqual(1); // the owner's plan (11-20 evening) keeps one aquarium gift (Fluval Flex kit); 3 before
    expect(pets.filter((p) => /parrot|bird cage|perch|cage bird|foraging|bird (toy|harness|swing)|bird harness/i.test(p.name)).length).toBeGreaterThanOrEqual(1); // the owner's plan (11-20 evening) has no pet-bird section (4+ before; flagged for her in the lander handoff)
    // B #63: B09577FFFT is a green Hunter Play boot (named yellow), B0H5RFTWQX a butter dish (named Dutch oven);
    // B #65: the Meri Meri tags' photo was the Maisonette logo; B #58: the SKIMS hoodie photo was a skeleton print.
    const NEVER = [/B09577FFFT/, /B0H5RFTWQX/, /mid409239_1548270053/, /SKIMS-LOUNGEWEAR-TP-SCL-127733W-OBS/, /manta_seo\.png/];
    expect(ALL.filter((p) => NEVER.some((re) => re.test(`${p.href} ${p.image ?? ""}`))).map((p) => p.name)).toEqual([]);
  });

  it("no blocked or off-rule retailer in any deals box, sale or code", () => {
    const blocked: string[] = SPEC.dealsBlocked;
    expect(blocked).toContain("Gilt");
    const hit = (t: string) => blocked.some((b) => fold(t).includes(fold(b)));
    expect(SALES.filter((s) => hit(s.store) || hit(s.offer)).map((s) => `${s.store}: ${s.offer}`)).toEqual([]);
    expect(DEAL_CODES.filter((c) => hit(c.store)).map((c) => c.store)).toEqual([]);
    expect([...CHUNKS.values()].flatMap((c) => c.deals ?? []).filter((d) => hit(d.title)).map((d) => d.title)).toEqual([]);
    // 140 sales before (Gilt 9, Rue La La 4, Groupon 3...); the rest stay.
    expect(SALES.length).toBeGreaterThan(80);
  });

  it("the line and name cleaners", () => {
    expect(shopperLine("current AirTag; best Apple rate (16%)")).toBe("");
    expect(shopperLine("men's wallet gift")).toBe("");
    expect(shopperLine("Natchitoches institution; Goldbelly 12%")).toBe("Natchitoches institution.");
    expect(shopperLine("Avery Island classic gift set, 4.8 stars on 4,700+ ratings.")).toBe("Avery Island classic gift set.");
    expect(shopperLine("Blows, vacuums and mulches leaves; a yard-work favorite.")).toBe("Blows, vacuums and mulches leaves; a yard-work favorite.");
    expect(shopperLine("Tracks heart rate and sleep.")).toBe("Tracks heart rate and sleep.");
    expect(cleanName("Parachute Home Parachute Cloud Cotton Robe", "Parachute Home")).toBe("Parachute Cloud Cotton Robe");
    expect(cleanName("Rare Beauty Rare Beginnings Mini Eau de Parfum Set", "Rare Beauty")).toBe("Rare Beauty Rare Beginnings Mini Eau de Parfum Set");
    expect(cleanName("materialkitchen.com MATERIAL - Serve Platter", "materialkitchen.com")).toBe("Material Serve Platter");
    expect(cleanName("Ninja Fireside360 Fire Pit - Samsclub.com", "Ninja")).toBe("Ninja Fireside360 Fire Pit");
  });
  it("a held-back gift is never copied onto the sponsors guide (its logo card shows once), a two-studio business is named once, no section is thin", () => {
    const sg = CHUNKS.get("25-days-sponsors")?.picks ?? [];
    expect(SPEC.sponsorNameOnly.length).toBeGreaterThan(0);
    for (const d of SPEC.sponsorNameOnly as { brand: string }[]) {
      // Owner 11-22: Hilma's probiotic stays off (never copied from another guide); Hilma shows once, as its logo card.
      const mine = sg.filter((p) => fold(p.brand).startsWith(fold(d.brand)) || fold(p.name).startsWith(fold(d.brand)));
      expect(mine.map((p) => [p.name, Boolean((p as { gift?: string }).gift)]), d.brand).toEqual([[d.brand, true]]);
      expect((NAME_ONLY["25-days-sponsors"] ?? []).filter((n) => fold(n).startsWith(fold(d.brand))), d.brand).toEqual([]);
    }
    for (const d of SPEC.sponsorOneName as { brand: string }[])
      for (const [guide, names] of Object.entries(NAME_ONLY)) expect(names.filter((n) => fold(n).startsWith(fold(d.brand))).length, `${guide}: ${d.brand}`).toBeLessThanOrEqual(1);
    // Thin sections fold into a neighbour (owner 11-20: merged, never padded): SECTION_MIN is 8.
    const thin: string[] = [];
    let sections = 0;
    for (const [slug, c] of CHUNKS) {
      const by = new Map<string, number>();
      for (const p of c.picks) if (p.sectionId) by.set(p.sectionId, (by.get(p.sectionId) ?? 0) + 1);
      sections += by.size;
      // The owner's plan (11-20 evening) sets the planned guides' sections; the sponsors guide's three sections follow
      // the sign-ups (giftGuideTrain1120d.test.ts skips it too).
      if (PLANNED.has(slug) || slug === "25-days-sponsors") continue;
      if (by.size > 1) for (const [id, n] of by) if (n < 8) thin.push(`${slug}#${id}: ${n}`);
    }
    expect(sections).toBeGreaterThan(50);
    expect(thin).toEqual([]);
  });
});
