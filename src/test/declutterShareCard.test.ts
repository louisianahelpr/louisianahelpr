/**
 * Q2426 Share a Declutter item to Facebook (owner 2026-10-27).
 *
 * Before: /declutter/item/:id had no link card, so a seller posting an item in a local Facebook group showed
 * the generic Helpr homepage card (no photo, title, price or town). Now vercel.json sends the item path to
 * api/share.ts, which builds the card from declutter_public_item_card (20261027194426, anon, only the card's
 * four fields) and shows the cover through shop-photo kind=declutter (by photo id, never the storage path,
 * which names the seller). The seller's own live listing carries "Share this item" and "Post to Facebook".
 *
 * Behaviour of the SQL: src/test/pglite/declutterShareCard.pglite.mjs (30 PASS, migration applied 3x; RED
 * with it absent, with the seller_hidden check planted out, and with the switch check planted out).
 *
 * @mutate vercel.json |       "destination": "/api/share?_og=declutter&_id=:id" |       "destination": "/api/share?_og=page&_id=browse"
 * @mutate api/share.ts |   if (route.kind === "declutter") {\n    const seg = safeIdSegment(route.id); |   if (false) {\n    const seg = safeIdSegment(route.id);
 * @mutate api/share.ts |     ogTitle: clean(`${title} · ${price}`, 100), |     ogTitle: title,
 * @mutate api/share.ts |   if (!Number.isFinite(cents) \|\| cents <= 0) return "Free"; |   if (!Number.isFinite(cents)) return "Free";
 * @mutate api/share.ts |     url: `${SUPABASE_URL}/functions/v1/shop-photo?id=${id}&kind=declutter&w=1200&og=1`, |     url: `${SUPABASE_URL}/storage/v1/object/public/job-photos/${id}`,
 * @mutate supabase/functions/shop-photo/index.ts |       kind === "declutter"\n        ? await admin.rpc("declutter_public_photo_path", { p_photo_id: id }) |       false\n        ? await admin.rpc("declutter_public_photo_path", { p_photo_id: id })
 * @mutate supabase/migrations/20261027194426_declutter_share_card.sql |           AND NOT i.seller_hidden\n |
 * @mutate src/components/declutter/DeclutterManageListing.tsx |             <ShareListingRow item={item} /> |
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const ITEM = "3f2a1b0c-1111-4222-8333-444455556666";
const PHOTO = "9a8b7c6d-1111-4222-8333-444455556666";

describe("Q2426: the Declutter item link card (SQL)", () => {
  it("the three functions are defined in 20261027194426 and read one visibility rule", () => {
    const names = ["declutter_item_link_visible", "declutter_public_item_card", "declutter_public_photo_path"];
    for (const n of names) expect(newestFunction(n).file, n).toContain("20261027194426");
    expect(names.length).toBeGreaterThan(2);
    const rule = code("declutter_item_link_visible");
    expect(rule).toContain("f.key = 'declutter' AND f.audience IN ('testers', 'everyone')");
    expect(rule).toContain("i.status IN ('live', 'reserved') AND NOT i.seller_hidden AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())");
    expect(code("declutter_public_item_card")).toContain("IF p_item_id IS NULL OR NOT public.declutter_item_link_visible(p_item_id) THEN RETURN NULL;");
    expect(code("declutter_public_photo_path")).toContain("public.declutter_item_link_visible(ph.item_id)");
  });

  it("the card returns only title, price, town and the cover photo id: never the seller, description, floor or a path", () => {
    const card = code("declutter_public_item_card");
    const keys = [...card.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["area_label", "photo_id", "price_cents", "title"]);
    expect(card).not.toMatch(/seller_id'|description|floor|pickup|storage_path/);
  });

  it("anon may run the card; the photo path and the rule are service_role only", () => {
    const sql = blankSqlComments(read("supabase/migrations/20261027194426_declutter_share_card.sql"));
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.declutter_public_item_card(uuid) TO anon, authenticated, service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_public_photo_path(uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_item_link_visible(uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_public_photo_path\(uuid\) TO [^;]*\b(anon|authenticated)\b/);
  });

  it("shop-photo serves kind=declutter through declutter_public_photo_path, after the rate limit", () => {
    const edge = blankComments(read("supabase/functions/shop-photo/index.ts"));
    expect(edge).toContain('askedKind === "declutter" ? "declutter"');
    const flat = edge.replace(/\s+/g, " ");
    expect(flat).toContain('kind === "declutter" ? await admin.rpc("declutter_public_photo_path", { p_photo_id: id }) : await admin.rpc("shops_public_photo_path"');
    const at = edge.indexOf('admin.rpc("declutter_public_photo_path", { p_photo_id: id })');
    expect(at).toBeGreaterThan(0);
    expect(edge.indexOf("await checkRateLimit(req,")).toBeLessThan(at);
  });
});

describe("Q2426: the link preview (api/share.ts + vercel.json)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let answer: unknown = null;
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/rest/v1/rpc/declutter_public_item_card")) {
        return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("unexpected fetch");
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const page = async (id: string) => handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=declutter&_id=${id}`));

  it("a live item previews with its photo, title, price and town, noindex, linking back to the item", async () => {
    answer = { title: "Oak rocking chair", price_cents: 2500, area_label: "Mid-City, Baton Rouge", photo_id: PHOTO };
    const res = await page(ITEM);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Oak rocking chair · $25"');
    expect(html).toContain('<meta property="og:description" content="$25 · Mid-City, Baton Rouge.');
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html).toContain(`<meta property="og:url" content="https://www.louisianahelpr.com/declutter/item/${ITEM}"`);
    expect(html).toContain(`<link rel="canonical" href="https://www.louisianahelpr.com/declutter/item/${ITEM}"`);
    expect(html).toContain(`<meta property="og:image" content="https://example.supabase.co/functions/v1/shop-photo?id=${PHOTO}&amp;kind=declutter&amp;w=1200&amp;og=1"`);
    expect(html).not.toMatch(/job-photos|storage\/v1/);
    // Values only: still exactly one og:image tag (owner 10-31: no second, square one).
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
    // Members never see fee numbers anywhere (owner rule): the card names no fee.
    expect(html.match(/<meta property="og:description" content="([^"]*)"/)?.[1]).not.toMatch(/fee/i);
  });

  it("a free item says Free; cents print as dollars and cents", async () => {
    answer = { title: "Kids' bike", price_cents: 0, area_label: "Lafayette", photo_id: null };
    let html = await (await page(ITEM)).text();
    expect(html).toContain('<meta property="og:title" content="Kids&#39; bike · Free"');
    expect(html).toContain('<meta property="og:description" content="Free · Lafayette.');
    answer = { title: "Lamp", price_cents: 1250, area_label: "Lafayette", photo_id: null };
    html = await (await page(ITEM)).text();
    expect(html).toContain('<meta property="og:title" content="Lamp · $12.50"');
  });

  it("an item the card may not show, or a non-id path, is a noindex 'isn't available' card", async () => {
    answer = null;
    let html = await (await page(ITEM)).text();
    expect(html).toContain("This item isn&#39;t available");
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    html = await (await page("not-an-id")).text();
    expect(html).toContain("This item isn&#39;t available");
  });

  it("vercel.json rewrites item ids to the card before the SPA catch-all and sends X-Robots-Tag: noindex", () => {
    const v = JSON.parse(read("vercel.json")) as {
      rewrites: { source: string; destination: string }[];
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const rw = v.rewrites.find((r) => r.destination === "/api/share?_og=declutter&_id=:id");
    expect(rw?.source.startsWith("/declutter/item/:id(")).toBe(true);
    expect(v.rewrites.indexOf(rw!)).toBeLessThan(v.rewrites.findIndex((r) => r.destination === "/index.html"));
    expect(v.headers.find((x) => x.source === "/declutter/item/(.*)")?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
  });

  it("robots.txt keeps the item path fetchable (a Disallow would kill the preview)", () => {
    const disallowed = read("public/robots.txt")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .map((l) => /^disallow:\s*(\S+)$/i.exec(l)?.[1])
      .filter((p): p is string => !!p);
    expect(disallowed.length).toBeGreaterThan(5);
    expect(disallowed.filter((p) => `/declutter/item/${ITEM}`.startsWith(p))).toEqual([]);
  });
});
