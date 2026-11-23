// @mutate src/content/sponsorPage.ts |           { brand: "Cat 5 Fishing Charters (Lake Charles)", prize: "$100 gift card toward a fishing charter trip" }, |           { brand: "Helping Hands Gallery", prize: "Handmade ceramic cup" },\n          { brand: "Cat 5 Fishing Charters (Lake Charles)", prize: "$100 gift card toward a fishing charter trip" },
// @mutate src/content/giftGuideSponsorGiftTypes.ts |   "Candle Bloom Confections": "Product", |   "Candle Bloom Confections": "Product",\n  "Helping Hands Gallery": "Product",
// @mutate src/content/giftGuideSponsorLogos.json | {"name":"Jaboom Baits", | {"name":"Helping Hands Gallery","slug":"helping-hands-gallery","group":"la","href":"/gift-guides/25-days-sponsors"},\n{"name":"Jaboom Baits",
// @mutate src/content/sponsorPage.ts |           { brand: "Forgiven Hearts", prize: "$25 gift certificate" }, |           { brand: "Sprinkle in Time Too (Sulphur)", prize: "2 free sundaes" },\n          { brand: "Forgiven Hearts", prize: "$25 gift certificate" },
// @mutate src/content/giftGuideSearchIndex.json | ["Bayou Grace Outfitters","25-days-sponsors" | ["Sprinkle in Time Too","25-days-sponsors"],\n["Bayou Grace Outfitters","25-days-sponsors"
// @mutate scripts/check-25days-lineup.mjs |         .filter((p) => !PUBLIC_OFF_SPONSORS.some((n) => p.brand.startsWith(n))), |         .filter((p) => !PUBLIC_OFF_SPONSORS.includes(p.brand)),
// @mutate scripts/gift-guide-sponsor-logos.mjs |  && !PUBLIC_OFF_SPONSORS.some((n) => b.startsWith(n))); |  && !PUBLIC_OFF_SPONSORS.includes(b));
/**
 * A 25 Days sponsor who said No to being shown publicly is on no public surface of the website (owner 2026-11-21,
 * tracker: "respect their No: leave Helping Hands OFF the public sponsor wall and public lineup (still post their day +
 * tag them)"). Before this guard, Helping Hands Gallery showed on /25days (the lineup), the 25 Days sponsors guide and
 * the gift-guides logo row (readiness check 2026-11-22, Ready-to-post-1123 README section 7).
 *
 * Inventory: every name in src/content/sponsorPublicOff.mjs, checked against every public source the site draws a
 * sponsor from: the lineup data (sponsorPage.lineup.days) and its rendered A-Z list, the logo row
 * (giftGuideSponsorLogos.json) and its logo files, every gift-guide chunk (giftGuidePicks/*.json, listed from the git
 * index), the name-only lists, the gift types and the search index. The two generators and the tracker drift check
 * must read the list, so a re-run can never put the sponsor back.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PUBLIC_OFF_SPONSORS } from "@/content/sponsorPublicOff.mjs";
import { sponsorPage } from "@/content/sponsorPage";
import { SPONSOR_GIFT_TYPES } from "@/content/giftGuideSponsorGiftTypes";
import { NAME_ONLY_SPONSORS } from "@/content/giftGuidePicks";
import { Lineup } from "@/components/sponsor/Sections";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const OFF = PUBLIC_OFF_SPONSORS.map(fold);
const isOff = (s: unknown) => OFF.some((k) => fold(s).startsWith(k));
const slug = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

describe("sponsors who said No are on no public surface (owner 2026-11-21)", () => {
  it("the list names Helping Hands Gallery and Sprinkle in Time Too (inventory floor)", () => {
    expect(PUBLIC_OFF_SPONSORS.length).toBeGreaterThan(1);
    expect(PUBLIC_OFF_SPONSORS).toContain("Helping Hands Gallery");
    // Night audit 2026-11-23 (25days M10): her sign-up said "not OK on the wall", yet she was on the live lineup.
    expect(PUBLIC_OFF_SPONSORS).toContain("Sprinkle in Time Too");
  });

  it("not in the lineup data, nor in the rendered A-Z lineup on /25days", () => {
    const brands = sponsorPage.lineup.days.flatMap((d) => d.partners.map((p) => p.brand));
    expect(brands.length).toBeGreaterThan(100);
    expect(brands.filter(isOff)).toEqual([]);
    expect(Object.keys(sponsorPage.lineup.links).filter(isOff)).toEqual([]);
    render(<MemoryRouter><Lineup /></MemoryRouter>);
    const shown = screen.getAllByTestId("lineup-partner").map((c) => c.textContent ?? "");
    expect(shown.length).toBeGreaterThan(50);
    expect(shown.filter(isOff)).toEqual([]);
  });

  it("not in the logo row, and no logo file of theirs ships", () => {
    const rows = JSON.parse(read("src/content/giftGuideSponsorLogos.json")) as { name: string }[];
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.filter((r) => isOff(r.name)).map((r) => r.name)).toEqual([]);
    for (const n of PUBLIC_OFF_SPONSORS) expect(existsSync(join(ROOT, "public/gift-guides/sponsors", `${slug(n)}.webp`)), n).toBe(false);
  });

  it("not on any gift guide (the 25 Days sponsors guide included), name-only lists, gift types or search", () => {
    const chunks = readdirSync(join(ROOT, "src/content/giftGuidePicks")).filter((f) => f.endsWith(".json"));
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks).toContain("25-days-sponsors.json");
    const hits: string[] = [];
    for (const f of chunks) {
      const { picks = [], deals = [] } = JSON.parse(read(`src/content/giftGuidePicks/${f}`)) as { picks?: Record<string, unknown>[]; deals?: unknown[] };
      for (const p of picks) if (isOff(p.brand) || isOff(p.name)) hits.push(`${f}: ${String(p.name)}`);
      if (OFF.some((k) => fold(JSON.stringify(deals)).includes(k))) hits.push(`${f}: deals`);
    }
    expect(hits).toEqual([]);
    expect(Object.values(NAME_ONLY_SPONSORS).flat().filter(isOff)).toEqual([]);
    expect(Object.keys(SPONSOR_GIFT_TYPES).filter(isOff)).toEqual([]);
    const index = fold(read("src/content/giftGuideSearchIndex.json"));
    for (const k of OFF) expect(index.includes(k), k).toBe(false);
  });

  it("the drift check and the logo generator read the list, so a re-run never puts them back", () => {
    for (const f of ["scripts/check-25days-lineup.mjs", "scripts/gift-guide-sponsor-logos.mjs"]) {
      const src = blankComments(read(f));
      expect(src, f).toMatch(/from "\.\.\/src\/content\/sponsorPublicOff\.mjs"/);
      // Prefix match: the lineup names a sponsor with its town ("Sprinkle in Time Too (Sulphur)"); an exact
      // includes() missed it and the drift check asked to put her back (2026-11-23).
      expect(src, f).toMatch(/!PUBLIC_OFF_SPONSORS\.some\(\(n\) => (?:p\.brand|b)\.startsWith\(n\)\)/);
    }
  });
});
