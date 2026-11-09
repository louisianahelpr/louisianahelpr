/**
 * M1 slice 2 (share-profile audit 2026-11-05, Q2759): a pasted /u link previewed as a bare face crop with no name or
 * brand. Now api/share.ts gives a found /u card ONE og:image: the branded 1200x630 PNG api/og-profile.ts draws
 * (photo or initial, name, town, rating, counts, brand), with a ?v= tag that changes with what it draws.
 *  - api/og-profile.ts renders a real 1200x630 PNG from the public_profile_by_handle answer (read back from IHDR),
 *    ONLY at the canonical ?h=<current handle>&v=<current tag> (cached a day); any other query is a 302 there (lh-appsec);
 *  - any miss (bad handle: no read at all; no profile; database error) is a 302 to the 1200x630 brand image;
 *  - only this project's stored avatars are ever fetched (no SSRF through a social-login URL);
 *  - the renderer stays server-only: nothing under src/ (outside this module and tests) imports it, satori or resvg.
 *
 * @mutate api/share.ts |     image: profileCardImage(typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? card.handle : handle, card, name), |     image: undefined,
 * @mutate api/share.ts |     url: ogProfileImageUrl(SITE_ORIGIN, handle, card), |     url: `${SITE_ORIGIN}/og-image.png?v=h3`,
 * @mutate src/lib/ogProfileCard.mjs |   const s = [l.name, l.town, l.rating, l.facts, l.skills, | const s = [l.name, l.town,
 * @mutate src/lib/ogProfileCard.mjs |   if (avatarUrl.slice(0, prefix.length) !== prefix) return null; |
 * @mutate api/og-profile.ts |       if (!HANDLE_RE.test(handle)) return fallback(); |
 * @mutate api/og-profile.ts |       if (raw.length > MAX_HANDLE_PARAM) return fallback(); |
 * @mutate api/og-profile.ts |       if (url.search !== canonical.slice(canonical.indexOf("?"))) { |       if (false) {
 * @mutate api/og-profile.ts |       const current = typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? card.handle : handle; |       const current = handle;
 * @mutate api/og-profile.ts |       if (!card) return fallback(); |       if (!card) return new Response("x", { status: 500 });
 * @mutate api/og-profile.ts |   return new Resvg(svg, { fitTo: { mode: "width", value: OG_PROFILE_WIDTH } }).render().asPng(); |   return new Resvg(svg, { fitTo: { mode: "width", value: 1000 } }).render().asPng();
 *  - the card is drawn in the site's own type (owner's UI audit 11-09, F077: it was a generic system-looking face):
 *    Montserrat for the text, Bodoni Moda for the name, every font file shipped in api/_og/ (vercel.json includeFiles),
 *    and the card's ?v= tag changes with its look (OG_PROFILE_STYLE), so crawlers fetch the new drawing.
 * @mutate api/og-profile.ts | el("div", { fontFamily: "Bodoni Moda", fontWeight: 700, fontSize: 72, | el("div", { fontSize: 72,
 * @mutate api/og-profile.ts | padding: "60px 80px 44px", fontFamily: "Montserrat", fontWeight: 400 }, | padding: "60px 80px 44px" },
 * @mutate api/og-profile.ts |   { name: "Bodoni Moda", file: "BodoniModa-700-latin.woff", weight: 700 },\n | 
 * @mutate src/lib/ogProfileCard.mjs |   const selling = Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : Array.isArray(card?.listings) ? card.listings.length : 0; |   const selling = Array.isArray(card?.listings) ? card.listings.length : 0;
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { OG_PROFILE_STYLE, ogProfileLines, ogProfileVersion } from "../lib/ogProfileCard.mjs";
import { blankComments } from "./helpers/blankNonCode";

const SB = "https://example.supabase.co";
const USER = "3f2a1b0c-1111-4222-8333-444455556666";
const AVATAR = `${SB}/storage/v1/object/public/avatars/${USER}/avatar.png`;
const CARD = {
  handle: "lexi-l", name: "Lexi L.", photo_url: AVATAR, town: "Delcambre", skills: "Yard work, Handyman",
  stats: { review_count: 3, avg_rating: 4.67 }, helpr: { jobs_done: 2 }, listing_count: 201, listings: [{}],
};
/** A 1x1 PNG (valid, so the renderer accepts the photo). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

let answer: unknown = CARD;
let rpcStatus = 200;
const fetched: string[] = [];

describe("the branded /u link card (api/og-profile.ts + api/share.ts)", () => {
  let share: { fetch: (req: Request) => Promise<Response> };
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", SB);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      fetched.push(u);
      if (u.endsWith("/rest/v1/rpc/public_profile_by_handle")) return new Response(JSON.stringify(answer), { status: rpcStatus, headers: { "Content-Type": "application/json" } });
      if (u.startsWith(`${SB}/storage/v1/render/image/public/avatars/`)) return new Response(PIXEL, { status: 200, headers: { "Content-Type": "image/png" } });
      if (u === "https://www.louisianahelpr.com/helpr-splash-icon.png") return new Response(PIXEL, { status: 200, headers: { "Content-Type": "image/png" } });
      throw new Error(`unexpected fetch ${u}`);
    });
    ensureOgShellSnapshot(resolve("."));
    share = (await import(/* @vite-ignore */ ["..", "..", "api", "share"].join("/"))).default;
  }, 30_000);
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  /**
   * api/og-profile.ts runs in a plain Node child (ESM + type stripping, as Vercel runs a function), not in this jsdom
   * worker: jsdom's typed arrays are another realm, and resvg refuses them ("Unsupported input").
   */
  /** `v` "current" (the default) is the tag of the answer the read gives, i.e. the canonical URL api/share.ts writes. */
  const ogFetch = (h: string, v: string | null = "current") =>
    ogQuery(`?h=${encodeURIComponent(h)}${v === null ? "" : `&v=${v === "current" ? ogProfileVersion(answer as typeof CARD) : v}`}`);
  const ogQuery = async (query: string) => {
    const out = execFileSync(process.execPath, [resolve("src/test/helpers/ogProfileRun.mjs")], {
      encoding: "utf8",
      input: JSON.stringify({ query, answer, rpcStatus, sb: SB, pixel: PIXEL.toString("base64"), fn: resolve("api/og-profile.ts") }),
      timeout: 60_000,
    });
    const r = JSON.parse(out.trim().split("\n").pop() as string) as { status: number; headers: Record<string, string>; png: string; fetched: string[] };
    fetched.push(...r.fetched);
    return { status: r.status, headers: new Headers(r.headers), arrayBuffer: async () => Buffer.from(r.png, "base64") };
  };
  const shareHtml = async (h: string) => (await share.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=profile&_id=${h}`))).text();

  it("draws a real 1200x630 PNG at the canonical URL only, cached a day; any other query is a 5-minute 302 there", async () => {
    answer = CARD;
    rpcStatus = 200;
    const canonical = `https://www.louisianahelpr.com/api/og-profile?h=lexi-l&v=${ogProfileVersion(CARD)}`;
    const res = await ogFetch("lexi-l");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=86400, stale-while-revalidate=3600");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    if (process.env.OG_PROFILE_DUMP) writeFileSync(process.env.OG_PROFILE_DUMP, png);
    // A random ?v=, no ?v=, an extra parameter, another letter case, or an old handle: no render, a 302 to the canonical URL.
    for (const q of [`?h=lexi-l&v=stale1`, `?h=lexi-l`, `?h=lexi-l&v=${ogProfileVersion(CARD)}&x=1`, `?h=Lexi-L&v=${ogProfileVersion(CARD)}`]) {
      const r = await ogQuery(q);
      expect(r.status, q).toBe(302);
      expect(r.headers.get("location"), q).toBe(canonical);
      expect(r.headers.get("vercel-cdn-cache-control"), q).toBe("public, s-maxage=300, stale-while-revalidate=600");
      expect((await r.arrayBuffer()).byteLength, q).toBe(0);
    }
    answer = { ...CARD, handle: "lexi-new" };
    const old = await ogFetch("lexi-old");
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe(`https://www.louisianahelpr.com/api/og-profile?h=lexi-new&v=${ogProfileVersion(answer as typeof CARD)}`);
  }, 60_000);

  it("any miss is a 302 to the 1200x630 brand image, never CDN-cached; a bad handle is not even looked up", async () => {
    rpcStatus = 200;
    answer = null;
    for (const res of [await ogFetch("nobody-here")]) {
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://www.louisianahelpr.com/og-image.png?v=h3");
      expect(res.headers.get("vercel-cdn-cache-control")).toBeNull();
    }
    rpcStatus = 500;
    answer = { message: "boom" };
    expect((await ogFetch("lexi-l")).status).toBe(302);
    rpcStatus = 200;
    const before = fetched.length;
    for (const h of ["x", "../etc", "a".repeat(31), `lexi-l${" ".repeat(80)}`, "lexi_l"]) {
      const r = await ogFetch(h, null);
      expect(r.status, h).toBe(302);
      expect(r.headers.get("location"), h).toBe("https://www.louisianahelpr.com/og-image.png?v=h3");
    }
    expect(fetched.length).toBe(before);
  }, 30_000);

  it("only this project's stored avatars are fetched; any other photo draws the initial", async () => {
    answer = { ...CARD, photo_url: "https://lh3.googleusercontent.com/a/photo.jpg" };
    fetched.length = 0;
    const res = await ogFetch("lexi-l");
    expect(res.status).toBe(200);
    expect(fetched.some((u) => u.includes("googleusercontent"))).toBe(false);
    answer = { ...CARD, photo_url: `${SB}/storage/v1/object/public/job-photos/${USER}/avatar.png` };
    fetched.length = 0;
    expect((await ogFetch("lexi-l")).status).toBe(200);
    expect(fetched.some((u) => u.includes("/job-photos/"))).toBe(false);
    // Another host's URL of the same shape is not our avatar, even when the rest of it would parse as one.
    answer = { ...CARD, photo_url: `https://evilxxx.supabase.co/storage/v1/object/public/avatars/${USER}/avatar.png` };
    fetched.length = 0;
    expect((await ogFetch("lexi-l")).status).toBe(200);
    expect(fetched.some((u) => u.includes("/storage/v1/render/"))).toBe(false);
    // ...while our own stored avatar IS fetched (so the checks above are not vacuous).
    answer = CARD;
    fetched.length = 0;
    expect((await ogFetch("lexi-l")).status).toBe(200);
    expect(fetched).toContain(`${SB}/storage/v1/render/image/public/avatars/${USER}/avatar.png?width=360&height=360&resize=cover&quality=80&format=origin`);
  }, 30_000);

  it("the card's words: name, town, rating, the TRUE item count, at most three skills", () => {
    expect(ogProfileLines(CARD)).toEqual({ name: "Lexi L.", town: "Delcambre", rating: "★ 4.7 · 3 reviews", facts: "2 jobs done · 201 items for sale", skills: "Yard work · Handyman" });
    expect(ogProfileLines({ name: "", stats: {}, helpr: {}, listings: [{}, {}] })).toEqual({ name: "A neighbor", town: "", rating: "", facts: "2 items for sale", skills: "" });
  });

  it("share.ts gives a found /u card exactly ONE og:image: the 1200x630 card at the CURRENT handle, tagged by what it draws", async () => {
    answer = { ...CARD, handle: "lexi-new" };
    rpcStatus = 200;
    const html = await shareHtml("lexi-old");
    const v = ogProfileVersion(answer as typeof CARD);
    expect(html).toContain(`<meta property="og:image" content="https://www.louisianahelpr.com/api/og-profile?h=lexi-new&amp;v=${v}"`);
    expect(html).toContain('<meta property="og:image:type" content="image/png"');
    expect(html).toContain('<meta property="og:image:width" content="1200"');
    expect(html).toContain('<meta property="og:image:height" content="630"');
    expect(html).toContain(`<meta name="twitter:image" content="https://www.louisianahelpr.com/api/og-profile?h=lexi-new&amp;v=${v}"`);
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
    // A new rating, town or photo is a new URL (crawlers cache images by URL).
    expect(ogProfileVersion({ ...CARD, stats: { review_count: 4, avg_rating: 4.75 } })).not.toBe(ogProfileVersion(CARD));
    expect(ogProfileVersion({ ...CARD, photo_url: null })).not.toBe(ogProfileVersion(CARD));
    expect(ogProfileVersion({ ...CARD })).toBe(ogProfileVersion(CARD));
  });

  it("F077: the card is drawn in Montserrat with the name in Bodoni Moda, from font files the function ships", () => {
    const src = blankComments(readFileSync(resolve("api/og-profile.ts"), "utf8"));
    // The root sets Montserrat for every line; the name alone is Bodoni Moda 700.
    expect(src).toMatch(/padding: "60px 80px 44px", fontFamily: "Montserrat", fontWeight: 400 \}/);
    expect(src).toMatch(/el\("div", \{ fontFamily: "Bodoni Moda", fontWeight: 700, fontSize: 72, [^}]*\}, l\.name\)/);
    // The fonts satori gets are the list, read from api/_og (shipped by vercel.json's includeFiles).
    const list = [...src.matchAll(/\{ name: "([^"]+)", file: "([^"]+)", weight: (\d+) \}/g)].map((m) => ({ name: m[1], file: m[2], weight: Number(m[3]) }));
    expect(list.length).toBeGreaterThan(4);
    for (const want of [["Montserrat", 400], ["Montserrat", 600], ["Bodoni Moda", 700]] as const) {
      // Each face's basic latin subset at least (the letters every name and town is written in).
      expect(list.some((f) => f.name === want[0] && f.weight === want[1] && /-latin\.woff$/.test(f.file)), `${want[0]} ${want[1]}`).toBe(true);
    }
    for (const f of list) expect(existsSync(resolve("api/_og", f.file)), f.file).toBe(true);
    expect(src).toMatch(/fonts \?\?= OG_PROFILE_FONTS\.map\(/);
    expect(src).toMatch(/fonts: fonts \?\? \[\],/);
    const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { functions: Record<string, { includeFiles?: string }> };
    expect(vercel.functions["api/og-profile.ts"].includeFiles).toContain("api/_og/**");
    // A new look is a new ?v= (crawlers cache images by URL).
    expect(OG_PROFILE_STYLE).toBe("fonts-1109");
  });

  it("the renderer is server-only: nothing under src/ imports the renderer or the card module", () => {
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-l", "--untracked", "-E", "@vercel/og|satori|resvg|ogProfileCard|og-profile", "--", "src"], { encoding: "utf8" });
    } catch (e) {
      // git grep exits 1 on no match; anything else is a real failure.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const hits = out
      .split("\n").filter(Boolean).filter((f) => !f.startsWith("src/test/") && !f.startsWith("src/lib/ogProfileCard."));
    expect(hits).toEqual([]);
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { dependencies: Record<string, string> };
    // Pinned exactly; @vercel/og stays out (0.11 pins a vulnerable satori and pulls in sharp; 1.0.3 breaks on Node ESM).
    expect(pkg.dependencies.satori).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["@resvg/resvg-wasm"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["@vercel/og"]).toBeUndefined();
  });
});
