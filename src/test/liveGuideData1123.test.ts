/**
 * Live gift-guide data (owner pop-up 2026-11-23 ~11:15 AM: "make the app's guides pull the latest gifts, prices and
 * deals from the website, so later edits show up without new reviews"). Pins every layer:
 *   - the build emits each live data file plus a manifest naming its hash (scripts/lib/giftGuideLiveData.mjs, called
 *     from vite.config.ts's lh-gift-guide-live-data plugin);
 *   - the page (src/lib/liveGuideData.ts) takes a newer valid copy from the live site, saves it, and hands it to the
 *     guide page (src/content/giftGuideCatalog.ts loadGuidePicks) and the deals page;
 *   - a malformed copy is refused (bundled kept, failure reported); a site built before the bundle is never taken;
 *   - the installed app reads from https://www.louisianahelpr.com and points relative photos there;
 *   - vercel.json sends CORS only on /gift-guides/data/*, and the native meta CSP lets the app connect to www.
 *
 * @mutate vite.config.ts | for (const a of buildLiveData(process.cwd(), appBuiltAt).assets) this.emitFile( | for (const a of [] as { fileName: string; source: string }[]) this.emitFile(
 * @mutate src/lib/liveGuideData.ts |   if (!(m.builtAt > e.inUse.builtAt)) return; |   return;
 * @mutate src/lib/liveGuideData.ts |   if (!e.valid(fixed)) { |   if (false) {
 * @mutate src/lib/liveGuideData.ts |   return cap?.isNativePlatform?.() === true ? LIVE_DATA_ORIGIN : ""; |   return "";
 * @mutate src/lib/liveGuideData.ts |   const useSaved = saved !== null && saved.builtAt > bundleBuiltAt() && valid(saved.value); |   const useSaved = saved !== null;
 * @mutate src/content/giftGuideCatalog.ts |   applyChunk(liveCopy<PickChunk>(name, chunk, isLivePickChunk)); |   applyChunk(chunk);
 * @mutate vercel.json |       "source": "/gift-guides/data/(.*)", |       "source": "/(.*)",
 * @mutate vite.config.ts | [\\/]src[\\/]lib[\\/](liveGuideData\.ts\|giftGuideLiveDataShared\.mjs)$/, | [\\/]src[\\/]lib[\\/](giftGuideLiveDataShared\.mjs)$/,
 * @mutate index.html | connect-src 'self' https://www.louisianahelpr.com | connect-src 'self'
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { report } from "@/lib/errorLogger";
import { buildLiveData, liveDataSources } from "../../scripts/lib/giftGuideLiveData.mjs";
import { LIVE_DATA_ORIGIN, liveDataHash } from "@/lib/giftGuideLiveDataShared.mjs";
import { _resetLiveGuideDataForTests, isLiveDeals, isLivePickChunk, liveCopy, onLiveUpdate, refreshLiveGuideData } from "@/lib/liveGuideData";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const json = (f: string) => JSON.parse(read(f)) as unknown;

type Chunk = { picks: { name: string; price?: number; image?: string; href: string }[] };
const HER = json("src/content/giftGuidePicks/her.json") as Chunk;
const BUNDLE_AT = "2026-11-23T12:00:00.000Z";
const LATER = "2026-11-23T15:00:00.000Z";
const EARLIER = "2026-11-23T09:00:00.000Z";

/** A fetch stub serving `routes` (path -> body); records every URL asked for. */
function stubFetch(routes: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    const path = url.replace(LIVE_DATA_ORIGIN, "");
    if (!(path in routes)) return new Response("not found", { status: 404 });
    return new Response(typeof routes[path] === "string" ? (routes[path] as string) : JSON.stringify(routes[path]), { status: 200 });
  }));
  return asked;
}
const manifest = (builtAt: string, name: string, value: unknown) => {
  const hash = liveDataHash(value);
  const path = `/gift-guides/data/${name.replace(/\//g, "-")}.${hash}.json`;
  return { m: { v: 1, builtAt, files: { [name]: { hash, path } } }, path };
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(report).mockClear();
  _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: "" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe("the build emits the live data files with a manifest", () => {
  const { manifest: man, assets } = buildLiveData(ROOT, BUNDLE_AT);

  it("lists every live guide's picks chunk, the deals cards and the manifest", () => {
    const names = Object.keys(man.files);
    expect(names.length).toBeGreaterThan(4);
    for (const slug of LIVE_GUIDES_1121.filter((s) => liveDataSources(ROOT).some((x) => x.name === `picks/${s}`))) expect(names).toContain(`picks/${slug}`);
    expect(names).toEqual(expect.arrayContaining(["picks/her", "picks/him", "picks/kids", "deals"]));
    expect(assets.map((a) => a.fileName)).toContain("gift-guides/data/manifest.json");
  });

  it("each manifest entry names an emitted file whose content hashes to it, and the hash matches the bundled module's", () => {
    for (const [name, f] of Object.entries(man.files)) {
      const asset = assets.find((a) => `/${a.fileName}` === f.path);
      expect(asset, name).toBeDefined();
      expect(liveDataHash(JSON.parse(asset!.source))).toBe(f.hash);
    }
    expect(man.files["picks/her"].hash).toBe(liveDataHash(HER));
  });

  it("carries the Kids filter tags file once it exists", () => {
    const has = liveDataSources(ROOT).some((s) => s.name === "kidsTags");
    expect(has).toBe(Object.keys(man.files).includes("kidsTags"));
    expect(blankComments(read("scripts/lib/giftGuideLiveData.mjs"))).toContain('"src/content/giftGuideKidsTags.json"');
  });

  it("vite.config.ts emits them in the build", () => {
    const src = blankComments(read("vite.config.ts"));
    expect(src).toMatch(/name: "lh-gift-guide-live-data",\s*apply: "build",\s*generateBundle\(\) \{\s*for \(const a of buildLiveData\(process\.cwd\(\), appBuiltAt\)\.assets\) this\.emitFile\(\{ type: "asset", fileName: a\.fileName, source: a\.source \}\);/);
  });

  it("the loader rides the public-page-reads chunk group, never signed-in-deep (611 KB gz on the guide page's path, 11-23)", () => {
    const src = blankComments(read("vite.config.ts"));
    const group = src.match(/name: "public-page-reads",\s*test: \/(.*)\/,\s*\n/);
    expect(group).not.toBeNull();
    const re = new RegExp(group![1]);
    expect(re.test("/x/src/lib/liveGuideData.ts")).toBe(true);
    expect(re.test("/x/src/lib/giftGuideLiveDataShared.mjs")).toBe(true);
  });

  it("the real bundled data passes the validators (no live copy of today's shape is ever refused)", () => {
    for (const { name, file } of liveDataSources(ROOT)) {
      if (name.startsWith("picks/")) expect(isLivePickChunk(json(file)), name).toBe(true);
    }
    expect(isLiveDeals(json("src/content/giftGuideDeals.json"))).toBe(true);
  });
});

describe("the page prefers a newer valid copy from the live site", () => {
  it("fetches, swaps in, and saves a newer copy; the next session starts from it", async () => {
    const fresh = { ...HER, picks: [{ ...HER.picks[0], name: "Live Pick", price: 12 }, ...HER.picks.slice(1)] };
    const { m, path } = manifest(LATER, "picks/her", fresh);
    const asked = stubFetch({ "/gift-guides/data/manifest.json": m, [path]: fresh });
    expect(liveCopy("picks/her", HER, isLivePickChunk)).toBe(HER);
    const seen: Chunk[] = [];
    onLiveUpdate<Chunk>("picks/her", (v) => seen.push(v));
    await refreshLiveGuideData();
    expect(asked).toEqual(["/gift-guides/data/manifest.json", path]);
    expect(seen.map((c) => c.picks[0].name)).toEqual(["Live Pick"]);
    expect(liveCopy("picks/her", HER, isLivePickChunk).picks[0].name).toBe("Live Pick");
    // A new session (app relaunch, offline): the saved copy draws first, no network needed.
    _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: "" });
    expect(liveCopy("picks/her", HER, isLivePickChunk).picks[0].name).toBe("Live Pick");
    expect(report).not.toHaveBeenCalled();
  });

  it("never takes a copy from a site built before this bundle, nor refetches unchanged data", async () => {
    const fresh = { ...HER, picks: [{ ...HER.picks[0], name: "Old Site Pick" }] };
    const old = manifest(EARLIER, "picks/her", fresh);
    let asked = stubFetch({ "/gift-guides/data/manifest.json": old.m, [old.path]: fresh });
    liveCopy("picks/her", HER, isLivePickChunk);
    await refreshLiveGuideData();
    expect(asked).toEqual(["/gift-guides/data/manifest.json"]);
    expect(liveCopy("picks/her", HER, isLivePickChunk)).toBe(HER);
    _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: "" });
    const same = manifest(LATER, "picks/her", HER);
    asked = stubFetch({ "/gift-guides/data/manifest.json": same.m, [same.path]: HER });
    liveCopy("picks/her", HER, isLivePickChunk);
    await refreshLiveGuideData();
    expect(asked).toEqual(["/gift-guides/data/manifest.json"]);
  });

  it("a saved copy older than this bundle (an app update shipped newer data), or a malformed one, is ignored", () => {
    const old = { ...HER, picks: [{ ...HER.picks[0], name: "Saved Before Update" }] };
    window.localStorage.setItem("lh-live-guide-data:picks/her", JSON.stringify({ hash: liveDataHash(old), builtAt: EARLIER, value: old }));
    expect(liveCopy("picks/her", HER, isLivePickChunk)).toBe(HER);
    _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: "" });
    window.localStorage.setItem("lh-live-guide-data:picks/her", JSON.stringify({ hash: "x", builtAt: LATER, value: { picks: [] } }));
    expect(liveCopy("picks/her", HER, isLivePickChunk)).toBe(HER);
  });

  it("the guide page swaps the live copy in (loadGuidePicks)", async () => {
    const fresh = { ...HER, picks: [{ ...HER.picks[0], name: "Live Pick On Page" }, ...HER.picks.slice(1)] };
    const { m, path } = manifest(LATER, "picks/her", fresh);
    stubFetch({ "/gift-guides/data/manifest.json": m, [path]: fresh });
    const cat = await import("@/content/giftGuideCatalog");
    await cat.loadGuidePicks("her");
    const before = cat.guidePicksVersion();
    await refreshLiveGuideData();
    expect(cat.guidePicksVersion()).toBe(before + 1);
    expect(cat.guideBySlug("her")?.picks.some((p) => p.name === "Live Pick On Page")).toBe(true);
  });
});

describe("a malformed copy is refused and the bundled one kept", () => {
  for (const [label, bad] of [
    ["a pick with no name", { picks: [{ brand: "x", line: "y", href: "https://a.example/b" }] }],
    ["an empty list", { picks: [] }],
    ["a javascript: link", { picks: [{ ...HER.picks[0], href: "javascript:alert(1)" }] }],
    ["a non-numeric price", { picks: [{ ...HER.picks[0], price: "12" }] }],
    ["not JSON at all", "<!doctype html><title>404</title>"],
  ] as const) {
    it(label, async () => {
      const { m, path } = manifest(LATER, "picks/her", bad);
      stubFetch({ "/gift-guides/data/manifest.json": m, [path]: bad });
      const seen: unknown[] = [];
      liveCopy("picks/her", HER, isLivePickChunk);
      onLiveUpdate("picks/her", (v) => seen.push(v));
      await refreshLiveGuideData();
      expect(seen).toEqual([]);
      expect(liveCopy("picks/her", HER, isLivePickChunk)).toBe(HER);
      expect(window.localStorage.length).toBe(0);
      expect(report).toHaveBeenCalledTimes(1);
    });
  }

  it("a malformed manifest is reported and nothing else is fetched", async () => {
    const asked = stubFetch({ "/gift-guides/data/manifest.json": { v: 1, builtAt: LATER, files: { "picks/her": { hash: "x", path: "https://evil.example/x.json" } } } });
    liveCopy("picks/her", HER, isLivePickChunk);
    await refreshLiveGuideData();
    expect(asked).toEqual(["/gift-guides/data/manifest.json"]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("deals: a card with no link is refused", async () => {
    const deals = json("src/content/giftGuideDeals.json") as Record<string, unknown>[];
    const bad = [{ ...deals[0], href: 7 }];
    const { m, path } = manifest(LATER, "deals", bad);
    stubFetch({ "/gift-guides/data/manifest.json": m, [path]: bad });
    liveCopy("deals", deals, isLiveDeals);
    await refreshLiveGuideData();
    expect(liveCopy("deals", deals, isLiveDeals)).toBe(deals);
  });
});

describe("the installed app reads from the live site", () => {
  it("uses the absolute www URL and points relative photos there", async () => {
    _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: null });
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const fresh = { ...HER, picks: [{ ...HER.picks[0], image: "/gift-guides/picks/new.webp" }] };
    const { m, path } = manifest(LATER, "picks/her", fresh);
    const asked = stubFetch({ "/gift-guides/data/manifest.json": m, [path]: fresh });
    liveCopy("picks/her", HER, isLivePickChunk);
    await refreshLiveGuideData();
    expect(asked).toEqual([`https://www.louisianahelpr.com/gift-guides/data/manifest.json`, `https://www.louisianahelpr.com${path}`]);
    expect(liveCopy("picks/her", HER, isLivePickChunk).picks[0].image).toBe("https://www.louisianahelpr.com/gift-guides/picks/new.webp");
  });

  it("the web reads its own origin (relative)", async () => {
    _resetLiveGuideDataForTests({ builtAt: BUNDLE_AT, origin: null });
    const asked = stubFetch({});
    liveCopy("picks/her", HER, isLivePickChunk);
    await refreshLiveGuideData();
    expect(asked).toEqual(["/gift-guides/data/manifest.json"]);
  });

  it("the native meta CSP lets the app connect to www", () => {
    const m = read("index.html").match(/connect-src([^;"]*)/);
    expect(m?.[1].split(/\s+/)).toContain("https://www.louisianahelpr.com");
  });
});

describe("vercel.json: CORS only on the data path", () => {
  const headers = (JSON.parse(read("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] }).headers;
  it("the data path allows any origin to read it", () => {
    const rule = headers.find((h) => h.source === "/gift-guides/data/(.*)");
    expect(rule?.headers).toEqual([{ key: "Access-Control-Allow-Origin", value: "*" }]);
  });
  it("no other rule sends a CORS header", () => {
    const cors = headers.filter((h) => h.headers.some((x) => /^access-control-/i.test(x.key)));
    expect(headers.length).toBeGreaterThan(5);
    expect(cors.map((h) => h.source)).toEqual(["/gift-guides/data/(.*)"]);
  });
});
