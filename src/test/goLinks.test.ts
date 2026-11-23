// @mutate src/lib/goLinks.mjs |   if (AMAZON_HOST_RE.test(host)) return false; |   if (AMAZON_HOST_RE.test(host)) return true;
// @mutate src/lib/goLinks.mjs |   return GO_LINK_HOSTS.includes(host); |   return true;
// @mutate src/lib/goLinks.mjs |   if (!isGoSlug(slug) \|\| !map \|\| !Object.prototype.hasOwnProperty.call(map, slug)) return GO_FALLBACK_URL; |   if (!map) return GO_FALLBACK_URL;
// @mutate api/go.ts |  const target = goTargetFor(slug, GO_LINKS); |  const target = new URL(request.url).searchParams.get("url") ?? goTargetFor(slug, GO_LINKS);
// @mutate api/go.ts | export const GO_CACHE_CONTROL = "private, no-store"; | export const GO_CACHE_CONTROL = "public, max-age=300";
// @mutate api/go.ts | export const GO_ROBOTS = "noindex, nofollow"; | export const GO_ROBOTS = "all";
// @mutate vercel.json |       "destination": "/api/go?slug=:slug" |       "destination": "/index.html"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AFFILIATE_HOSTS } from "@/content/giftGuides";
import { GO_LINKS } from "@/content/goLinks.mjs";
import { AMAZON_HOST_RE, GO_FALLBACK_URL, GO_LINK_HOSTS, GO_SLUG_RE, goTargetFor, isAllowedGoTarget, slugify } from "@/lib/goLinks.mjs";
import { mapJson, mapModule, refusal, slugsFromPicks } from "../../scripts/go-links.mjs";
import handler, { GO_CACHE_CONTROL, GO_ROBOTS } from "../../api/go";

/**
 * Branded /go/ short links (owner 11-18: "Yes, build go links. All of our links should be this way.").
 * /go/<slug> -> api/go.ts -> 302 to the slug's affiliate link from src/content/goLinks.json. Amazon never goes
 * through /go/ (the Associates agreement forbids cloaking an Associate link behind our own domain).
 */
const ROOT = resolve(__dirname, "../..");
const MAP = JSON.parse(readFileSync(resolve(ROOT, "src/content/goLinks.json"), "utf8")) as Record<string, { url: string; label?: string }>;
const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { rewrites: { source: string; destination: string; has?: unknown[] }[] };

const go = (path: string, headers: Record<string, string> = {}) => handler.fetch(new Request(`https://www.louisianahelpr.com${path}`, { headers }));

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the /go/ map", () => {
  it("holds the owner's first links", () => {
    expect(Object.keys(MAP).length).toBeGreaterThanOrEqual(7);
    expect(MAP["mindtheskin-signal"].url).toBe("https://go.shopmy.us/p-107605659");
    expect(MAP["mindtheskin-surge"].url).toBe("https://go.shopmy.us/p-107605753");
    expect(MAP["mindtheskin-kit"].url).toBe("https://go.shopmy.us/p-107605832");
    expect(MAP.skinfix.url).toBe("https://go.shopmy.us/p-107602872");
    expect(MAP["woot-toys"].url).toBe("https://mavely.app.link/JbehDoLQa8b");
    expect(MAP["woot-squishy"].url).toBe("https://mavely.app.link/xfxJPdKQa8b");
    expect(MAP["toddler-baby"].url).toBe("https://walmrt.us/4t7npBP");
  });

  it("never targets Amazon, anywhere in the map", () => {
    const amazon = Object.entries(MAP).filter(([, v]) => AMAZON_HOST_RE.test(new URL(v.url).hostname) || /amazon\.|amzn\.|tag=louisianahelpr-20/i.test(v.url));
    expect(amazon).toEqual([]);
    for (const h of ["www.amazon.com", "amazon.com", "amzn.to", "smile.amazon.com", "www.amazon.co.uk", "amzn.com", "a.co"]) expect(AMAZON_HOST_RE.test(h), h).toBe(true);
    expect(isAllowedGoTarget("https://www.amazon.com/dp/B0F3GWXLTS?tag=louisianahelpr-20")).toBe(false);
    expect(isAllowedGoTarget("https://amzn.to/3abc")).toBe(false);
    expect(GO_LINK_HOSTS.some((h) => AMAZON_HOST_RE.test(h))).toBe(false);
  });

  it("every slug is [a-z0-9-] and every target is https on an allowed host", () => {
    for (const [slug, v] of Object.entries(MAP)) {
      expect(slug, slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug, slug).toMatch(GO_SLUG_RE);
      expect(isAllowedGoTarget(v.url), `${slug} -> ${v.url}`).toBe(true);
    }
  });

  it("the allowed hosts are exactly the gift guides' AFFILIATE_HOSTS plus walmrt.us", () => {
    expect([...GO_LINK_HOSTS].sort()).toEqual([...new Set([...AFFILIATE_HOSTS, "walmrt.us"])].sort());
  });

  it("the server mirror goLinks.mjs is exactly goLinks.json (re-run node scripts/go-links.mjs sync)", () => {
    expect(GO_LINKS).toEqual(MAP);
    expect(readFileSync(resolve(ROOT, "src/content/goLinks.mjs"), "utf8")).toBe(mapModule(MAP));
    expect(readFileSync(resolve(ROOT, "src/content/goLinks.json"), "utf8")).toBe(mapJson(MAP));
  });

  it("vercel.json rewrites /go/:slug to the function, ahead of the catch-all", () => {
    const i = vercel.rewrites.findIndex((r) => r.source === "/go/:slug");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(vercel.rewrites[i].destination).toBe("/api/go?slug=:slug");
    expect(vercel.rewrites[i].has).toBeUndefined();
    expect(i).toBeLessThan(vercel.rewrites.length - 1);
  });
});

describe("api/go.ts", () => {
  it("a known slug answers 302 to its link, cached 5 minutes, noindex", async () => {
    for (const slug of Object.keys(MAP)) {
      const res = await go(`/api/go?slug=${slug}`);
      expect(res.status, slug).toBe(302);
      expect(res.headers.get("location"), slug).toBe(MAP[slug].url);
    }
    const res = await go("/api/go?slug=skinfix");
    expect(GO_CACHE_CONTROL).toBe("private, no-store");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(GO_ROBOTS).toBe("noindex, nofollow");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("an unknown, empty, malformed or prototype slug falls back to the gift guides", async () => {
    for (const q of ["slug=no-such-link", "", "slug=", "slug=../../evil", "slug=__proto__", "slug=constructor", "slug=toString", "slug=a%2F%2Fevil.com", `slug=${"a".repeat(65)}`]) {
      const res = await go(`/api/go?${q}`);
      expect(res.status, q).toBe(302);
      expect(res.headers.get("location"), q).toBe(GO_FALLBACK_URL);
    }
    expect(GO_FALLBACK_URL).toBe("https://www.louisianahelpr.com/gift-guides");
    // Only the map's own, well-formed keys: an inherited entry or a malformed key is never followed.
    const ok = { url: "https://go.shopmy.us/p-1" };
    expect(goTargetFor("inherited", Object.create({ inherited: ok }))).toBe(GO_FALLBACK_URL);
    expect(goTargetFor("Bad_Slug", { Bad_Slug: ok })).toBe(GO_FALLBACK_URL);
    expect(goTargetFor("good-slug", { "good-slug": ok })).toBe(ok.url);
  });

  it("no open redirect: a url in the query string is ignored", async () => {
    for (const q of ["slug=skinfix&url=https://evil.example", "url=https://evil.example", "to=https://evil.example&slug=nope", "slug=skinfix&redirect=https://evil.example&next=//evil.example"]) {
      const loc = (await go(`/api/go?${q}`)).headers.get("location");
      expect(loc, q).not.toMatch(/evil/);
    }
    expect((await go("/api/go?slug=skinfix&url=https://evil.example")).headers.get("location")).toBe(MAP.skinfix.url);
  });

  it("a map entry on a non-allowlisted or Amazon host is refused", () => {
    expect(isAllowedGoTarget("https://evil.example/x")).toBe(false);
    expect(isAllowedGoTarget("http://go.shopmy.us/p-1")).toBe(false);
    expect(isAllowedGoTarget("https://go.shopmy.us.evil.example/p-1")).toBe(false);
    expect(isAllowedGoTarget("https://user@go.shopmy.us/p-1")).toBe(false);
    expect(isAllowedGoTarget("javascript:alert(1)")).toBe(false);
    expect(isAllowedGoTarget("https://go.shopmy.us/p-1")).toBe(true);
  });

  it("logs one analytics_events row per hit, and a failed log never blocks the redirect", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://db.example");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon");
    vi.resetModules();
    const fresh = (await import("../../api/go")).default;
    await fresh.fetch(new Request("https://www.louisianahelpr.com/api/go?slug=skinfix", { headers: { "user-agent": "UA-test" } }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/db\.example\/rest\/v1\/analytics_events\?/);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ event: "go_link_click", user_id: null, properties: { slug: "skinfix", known: true }, platform: "web" });

    fetchSpy.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await fresh.fetch(new Request("https://www.louisianahelpr.com/api/go?slug=woot-toys"));
    expect(res.headers.get("location")).toBe(MAP["woot-toys"].url);
    expect(Date.now() - t0).toBeLessThan(1000);

    fetchSpy.mockImplementation(() => Promise.reject(new Error("down")));
    expect((await fresh.fetch(new Request("https://www.louisianahelpr.com/api/go?slug=skinfix"))).status).toBe(302);
    vi.unstubAllEnvs();
  });
});

describe("scripts/go-links.mjs", () => {
  it("add refuses Amazon, other hosts, bad slugs and a silent repoint", () => {
    expect(refusal("amz", "https://www.amazon.com/dp/X?tag=louisianahelpr-20")).toMatch(/Amazon/);
    expect(refusal("amz", "https://amzn.to/x")).toMatch(/Amazon/);
    expect(refusal("evil", "https://evil.example/x")).toMatch(/not an allowed/);
    expect(refusal("Bad_Slug", "https://go.shopmy.us/x")).toMatch(/slug/);
    expect(refusal("skinfix", "https://go.shopmy.us/other", MAP)).toMatch(/already points/);
    expect(refusal("new-one", "https://go.shopmy.us/p-1", MAP)).toBeNull();
  });

  it("--from-picks makes deduped brand-product slugs for non-Amazon affiliate picks only", () => {
    const picks = [
      { brand: "Skinfix", name: "Balm", href: "https://go.shopmy.us/p-1" },
      { brand: "Skinfix", name: "Balm", href: "https://go.shopmy.us/p-2" },
      { brand: "Skinfix", name: "Balm", href: "https://go.shopmy.us/p-1" },
      { brand: "Nintendo", name: "Switch 2", href: "https://www.amazon.com/dp/B0F3GWXLTS?tag=louisianahelpr-20" },
      { brand: "Gambino's", name: "King Cake", href: "https://gambinos.com/x" },
      { brand: "Woot", name: "Toys", href: MAP["woot-toys"].url },
    ];
    const { map, added } = slugsFromPicks(picks, MAP);
    expect(added).toBe(2);
    expect(map["skinfix-balm"].url).toBe("https://go.shopmy.us/p-1");
    expect(map["skinfix-balm-2"].url).toBe("https://go.shopmy.us/p-2");
    expect(Object.values(map).some((v) => /amazon|gambinos/.test(v.url))).toBe(false);
    expect(slugify("Café Du Monde & Beignet's Mix!")).toBe("cafe-du-monde-and-beignets-mix");
  });
});
