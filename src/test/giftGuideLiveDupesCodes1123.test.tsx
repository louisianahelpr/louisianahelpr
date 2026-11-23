/**
 * Train ab 11-23: the owner's dupes and the deals pages' store codes ride the live guide data too (owner pop-up
 * 2026-11-23 ~11:15 AM: "make the app's guides pull the latest gifts, prices and deals from the website, so later
 * edits show up without new reviews"). Before this, src/content/giftGuideDupes.json and the codes (then a TS array in
 * src/content/giftGuides.ts) were only in the bundle, so a dupe or a Black Friday code added after a release never
 * reached the installed app. Pins every layer:
 *   - the build's manifest names "dupes" and "codes", each hashing to the bundled module (scripts/lib/giftGuideLiveData.mjs);
 *   - the bundled files pass their validators, and a malformed copy is refused;
 *   - the guide page re-stamps its picks with a newer dupes copy (giftGuideCatalog.ts loadGuidePicks);
 *   - the deals page swaps a newer codes copy in and draws it (GiftGuideDeals.tsx, giftGuideDealCounts.ts setStoreCodes).
 *
 * @mutate scripts/lib/giftGuideLiveData.mjs |     { name: "dupes", file: "src/content/giftGuideDupes.json" }, |
 * @mutate scripts/lib/giftGuideLiveData.mjs |     { name: "codes", file: "src/content/giftGuideCodes.json" }, |
 * @mutate src/content/giftGuideCatalog.ts |   dupeEntries = liveCopy<DupesFile>("dupes", dupes.default as DupesFile, isLiveDupes).dupes; |   dupeEntries = (dupes.default as DupesFile).dupes;
 * @mutate src/content/giftGuideCatalog.ts |       restampAll(); |       void 0;
 * @mutate src/content/giftGuideDealCounts.ts |   discountCodes.splice(0, discountCodes.length, ...codes); |   void codes;
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       setCodesCopy((n) => n + 1); |       void 0;
 * @mutate src/lib/liveGuideData.ts | && Array.isArray(o.dupes) && o.dupes.length > 0 && o.dupes.every(isDupe); | ;
 * @mutate src/lib/liveGuideData.ts | && str(o.store) && typeof o.code === "string" && str(o.offer) && (o.href === undefined \|\| okLink(o.href)) | && (o.href === undefined \|\| okLink(o.href))
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { report } from "@/lib/errorLogger";
import { buildLiveData } from "../../scripts/lib/giftGuideLiveData.mjs";
import { liveDataHash } from "@/lib/giftGuideLiveDataShared.mjs";
import { _resetLiveGuideDataForTests, isLiveCodes, isLiveDupes, liveCopy, refreshLiveGuideData } from "@/lib/liveGuideData";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
type Dupe = { name: string; price: number; priceAt: string; href: string; image?: string };
type DupesFile = { dupes: { for: { href?: string; brand?: string; nameHas?: string }; guide: string; original: string; dupes: Dupe[] }[] };
type CodesFile = { codes: { rank: number; store: string; code: string; offer: string; href?: string; expires?: string; starts?: string }[] };
const DUPES = JSON.parse(read("src/content/giftGuideDupes.json")) as DupesFile;
const CODES = JSON.parse(read("src/content/giftGuideCodes.json")) as CodesFile;
const BUNDLE_AT = "2026-11-23T12:00:00.000Z";
const LATER = "2026-11-23T15:00:00.000Z";

function stubFetch(routes: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    if (!(url in routes)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200 });
  }));
  return asked;
}
const serve = (name: string, value: unknown) => {
  const hash = liveDataHash(value);
  const path = `/gift-guides/data/${name}.${hash}.json`;
  return stubFetch({ "/gift-guides/data/manifest.json": { v: 1, builtAt: LATER, files: { [name]: { hash, path } } }, [path]: value });
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(report).mockClear();
  _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: "" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the build's live data carries the dupes and the codes", () => {
  const { manifest } = buildLiveData(ROOT, BUNDLE_AT);
  it("the manifest names both, each hashing to the bundled file", () => {
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(["dupes", "codes"]));
    expect(manifest.files.dupes.hash).toBe(liveDataHash(DUPES));
    expect(manifest.files.codes.hash).toBe(liveDataHash(CODES));
  });
  it("the bundled files pass their validators (today's shape is never refused)", () => {
    expect(DUPES.dupes.length).toBeGreaterThan(60);
    expect(CODES.codes.length).toBeGreaterThan(25);
    expect(isLiveDupes(DUPES)).toBe(true);
    expect(isLiveCodes(CODES)).toBe(true);
  });
  it("a malformed copy is refused", () => {
    expect(isLiveDupes({ dupes: [{ ...DUPES.dupes[0], dupes: [] }] })).toBe(false);
    expect(isLiveDupes({ dupes: [{ ...DUPES.dupes[0], dupes: [{ ...DUPES.dupes[0].dupes[0], href: "javascript:alert(1)" }] }] })).toBe(false);
    expect(isLiveDupes({ dupes: [{ ...DUPES.dupes[0], for: {} }] })).toBe(false);
    expect(isLiveCodes({ codes: [] })).toBe(false);
    expect(isLiveCodes({ codes: [{ ...CODES.codes[0], store: "" }] })).toBe(false);
    expect(isLiveCodes({ codes: [{ ...CODES.codes[0], href: "http://x.example/" }] })).toBe(false);
    expect(isLiveCodes({ codes: [{ ...CODES.codes[0], code: 7 }] })).toBe(false);
  });
  it("the codes are read from the JSON, not a second list in giftGuides.ts", () => {
    const src = blankComments(read("src/content/giftGuides.ts"));
    expect(src).toContain('import codesFile from "@/content/giftGuideCodes.json";');
    expect(src).not.toMatch(/\{\s*rank:\s*\d+,\s*store:/);
    // The deals page reads the one list the live copy reaches (no copy of its own made at load).
    expect(blankComments(read("src/pages/info/giftGuides/GiftGuideDeals.tsx"))).not.toMatch(/const STORE_CODES\s*=/);
  });
});

describe("the guide page re-stamps its picks with a newer dupes copy", () => {
  it("a renamed dupe shows on its original pick after the refresh", async () => {
    const entry = DUPES.dupes.find((d) => d.guide === "her" && d.for.href)!;
    const fresh = { dupes: DUPES.dupes.map((d) => (d === entry ? { ...d, dupes: [{ ...d.dupes[0], name: "Live Dupe Name" }, ...d.dupes.slice(1)] } : d)) };
    const asked = serve("dupes", fresh);
    const cat = await import("@/content/giftGuideCatalog");
    await cat.loadGuidePicks("her");
    const pick = () => cat.guideBySlug("her")?.picks.find((p) => p.href === entry.for.href);
    expect(pick()?.dupes?.[0]?.name).toBe(entry.dupes[0].name);
    await refreshLiveGuideData();
    expect(asked.length).toBe(2);
    expect(pick()?.dupes?.[0]?.name).toBe("Live Dupe Name");
    expect(report).not.toHaveBeenCalled();
  });
});

describe("the deals page swaps a newer codes copy in", () => {
  it("a code added on the site shows on the Black Friday page with no release", async () => {
    const added = { rank: 1, store: "Live Test Store", code: "LIVE10", offer: "10% off, added on the site", expires: "2026-11-30", href: "https://example.com/" };
    const fresh = { codes: [added, ...CODES.codes] };
    const asked = serve("codes", fresh);
    expect(liveCopy("codes", CODES, isLiveCodes)).toBe(CODES);
    render(
      <MemoryRouter>
        <GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-24T18:00:00Z")} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector("[data-gift-deal]")).not.toBeNull());
    expect(screen.queryByText("LIVE10")).toBeNull();
    await act(() => refreshLiveGuideData());
    expect(asked.length).toBe(2);
    await screen.findByText("LIVE10");
    expect(report).not.toHaveBeenCalled();
  });
});
