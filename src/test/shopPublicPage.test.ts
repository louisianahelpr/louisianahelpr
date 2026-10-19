/**
 * SH2/SH2b (owner 2026-10-19): /shops/:id is viewable by ANYONE WITH THE
 * LINK, no account needed to look; hidden from search engines until the
 * Shops switch opens to everyone; anon reads only what the public page shows.
 *
 * Before: the route sat behind <ProtectedRoute>, every shop read required the
 * viewer's 'shops' switch, a shared link previewed as the generic homepage
 * card, and robots/noindex said nothing about shop pages.
 *
 * Layers checked: route table (App.tsx), the anon RPC (newest definition
 * across migrations, comment-blanked: its grant, what it refuses, what it
 * never returns), the link-preview handler (api/share.ts: noindex + the
 * shop's own title and photo), vercel.json (rewrite + X-Robots-Tag), robots.txt
 * (fetchable, so the preview works), and the one share helper.
 */
// @mutate src/App.tsx | <Route path="/shops/:id" element={<RouteErrorBoundary>{routeEl(<ShopPage />)}</RouteErrorBoundary>} /> | <Route path="/shops/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ShopPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |        AND NOT s.paused\n |
// @mutate supabase/migrations/20261019042744_shops_public_page.sql | GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO anon, authenticated, service_role; | GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO authenticated, service_role;
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |     'area_label', v_s.area_label, |     'area_label', v_s.area_label, 'owner_id', v_s.owner_id,
// @mutate api/share.ts |     robots: SHOP_ROBOTS,\n    image: shopImage(shop), |     image: shopImage(shop),
// @mutate vercel.json | "value": "noindex" | "value": "index"
// @mutate public/robots.txt | Allow: /shops/ | Allow: /shopz/
// @mutate src/lib/shops/publicShop.ts |     url: shopLink(shop.id), |     url: SHOP_LINK_ORIGIN,
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |                  'id', ph.id, 'kind', ph.photo_kind, 'position', ph.position) |                  'id', ph.id, 'kind', ph.photo_kind, 'storage_path', ph.storage_path, 'position', ph.position)
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |        WHERE ph.id = p_photo_id AND public.shop_link_visible(ph.shop_id)) |        WHERE ph.id = p_photo_id)
// @mutate api/share.ts | return respond(applyMeta(shell, meta), meta.cdnCache); | return respond(applyMeta(shell, meta));
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SHOP_ID = "5b0c9a4e-1111-4222-8333-444455556666";

describe("SH2b: the shop route is open to anyone with the link", () => {
  it("/shops/:id is not wrapped in ProtectedRoute", () => {
    const app = blankComments(read("src/App.tsx"));
    const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{([\s\S]*?)\} \/>/g)];
    expect(routes.length).toBeGreaterThan(30);
    const shop = routes.find((m) => m[1] === "/shops/:id");
    expect(shop, "the /shops/:id route").toBeTruthy();
    expect(shop![2]).not.toMatch(/ProtectedRoute/);
    // The owner's own screens stay signed-in only.
    for (const p of ["/shops", "/shops/mine", "/shops/orders", "/shops/dashboard"]) {
      expect(routes.find((m) => m[1] === p)?.[2], p).toMatch(/ProtectedRoute/);
    }
  });
});

describe("SH2b: shops_public_shop is the anon read, and only the page's fields", () => {
  const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
  const fn = defs.get("shops_public_shop");
  const vis = defs.get("shop_link_visible");
  const migSql = (file: string) => blankSqlComments(read(join("supabase", "migrations", file)));

  it("both functions exist in the migrations", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(fn).toBeTruthy();
    expect(vis).toBeTruthy();
  });

  it("the photo path helper is service_role only, and its edge function takes no JWT", () => {
    const pathFn = defs.get("shops_public_photo_path");
    expect(pathFn).toBeTruthy();
    const sql = migSql(pathFn!.file);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.shops_public_photo_path\(uuid, text\) FROM PUBLIC, anon, authenticated;/);
    expect(blankSqlComments(pathFn!.stmt)).toMatch(/shop_link_visible\(ph\.shop_id\)/);
    expect(blankSqlComments(pathFn!.stmt)).toMatch(/i\.status = 'live' AND s\.offers_selling/);
    const edge = blankComments(read("supabase/functions/shop-photo/index.ts"));
    expect(edge).toMatch(/rpc\("shops_public_photo_path"/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.shop-photo\]\s*\n\s*verify_jwt = false/);
  });

  it("anon may execute shops_public_shop; shop_link_visible stays internal", () => {
    const sql = migSql(fn!.file);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.shops_public_shop\(uuid\) TO anon\b/);
    expect(migSql(vis!.file)).toMatch(/REVOKE ALL ON FUNCTION public\.shop_link_visible\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(migSql(vis!.file)).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.shop_link_visible\(uuid\) TO [^;]*\b(anon|authenticated)\b/);
  });

  it("refuses hidden, paused, seed-while-hidden, bad-standing and switched-off owners' shops", () => {
    const body = blankSqlComments(vis!.stmt);
    for (const rule of [/hidden_at IS NULL/, /NOT s\.paused/, /seed_jobs_hidden_publicly\(\)/, /shop_owner_in_good_standing\(s\.owner_id\)/, /feature_enabled_for_user\('shops', s\.owner_id\)/]) {
      expect(body, String(rule)).toMatch(rule);
    }
    expect(blankSqlComments(fn!.stmt)).toMatch(/NOT public\.shop_link_visible\(p_shop_id\)/);
  });

  it("never returns owner-private fields", () => {
    const body = blankSqlComments(fn!.stmt);
    const keys = [...body.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const banned of ["owner_id", "pin_lat", "pin_lng", "sos_number", "hidden_reason", "hidden", "following", "mine", "pickup_address", "address_line1"]) {
      expect(keys, banned).not.toContain(banned);
    }
    expect(body).not.toMatch(/shop_pickup_address|shop_item_private/);
    // A storage path starts with the owner's user id: photos go out by id only.
    expect(keys).not.toContain("storage_path");
    expect(body).toMatch(/i\.status = 'live'/);
  });
});

describe("SH2b: link preview + search engines", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/rest/v1/rpc/shops_public_shop")) {
        return new Response(
          JSON.stringify({
            name: "Bayou Bakes",
            about: "King cakes and kolaches, baked to order.",
            category_label: "Bakery and cakes",
            area_label: "Lafayette",
            photos: [{ id: "7c0c9a4e-1111-4222-8333-444455556666", kind: "cover" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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

  it("a shop link previews as the shop, noindex, with its own photo", async () => {
    const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=shop&_id=${SHOP_ID}`));
    // Minutes, not a day: a hidden or paused shop stops previewing.
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html).toContain('<meta property="og:title" content="Bayou Bakes"');
    expect(html).toContain("Bakery and cakes in Lafayette.");
    expect(html).toContain(`<link rel="canonical" href="https://www.louisianahelpr.com/shops/${SHOP_ID}"`);
    // By photo id through shop-photo, never a storage path (it names the owner).
    expect(html).toContain('<meta property="og:image" content="https://example.supabase.co/functions/v1/shop-photo?id=7c0c9a4e-1111-4222-8333-444455556666&amp;kind=shop&amp;w=1200&amp;og=1"');
    expect(html).not.toMatch(/job-photos|storage\/v1/);
    // Values only: still exactly two og:image tags, in the shell's order.
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(2);
  });

  it("a non-id shop path is a noindex 'not available' card, no lookup", async () => {
    const html = await (await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=shop&_id=mine"))).text();
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    expect(html).toContain("This shop isn&#39;t available");
  });

  it("vercel.json rewrites shop ids to the card and sends X-Robots-Tag: noindex on /shops/*", () => {
    const v = JSON.parse(read("vercel.json")) as { rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] };
    const rw = v.rewrites.find((r) => r.destination === "/api/share?_og=shop&_id=:id");
    expect(rw?.source.startsWith("/shops/:id(")).toBe(true);
    const catchAll = v.rewrites.findIndex((r) => r.destination === "/index.html");
    expect(v.rewrites.indexOf(rw!)).toBeLessThan(catchAll);
    const h = v.headers.find((x) => x.source === "/shops/(.*)");
    expect(h?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
  });

  it("robots.txt keeps a shop page fetchable (the preview needs it) and the browse tab out", () => {
    const rules = read("public/robots.txt")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .map((l) => /^(allow|disallow):\s*(\S*)$/i.exec(l))
      .filter((m): m is RegExpExecArray => !!m && m[2] !== "")
      .map((m) => ({ allow: m[1].toLowerCase() === "allow", path: m[2] }));
    expect(rules.length).toBeGreaterThan(5);
    const allowed = (p: string) => {
      const hits = rules.filter((r) => p.startsWith(r.path));
      if (!hits.length) return true;
      const best = Math.max(...hits.map((r) => r.path.length));
      return hits.some((r) => r.path.length === best && r.allow);
    };
    expect(allowed(`/shops/${SHOP_ID}`)).toBe(true);
    expect(allowed("/shops")).toBe(false);
  });
});

describe("SH2b: shareShop shares the shop's own link", () => {
  it("passes the /shops/<id> link to the share ladder", async () => {
    const calls: unknown[] = [];
    vi.doMock("@/lib/nativeShare", () => ({ shareNative: async (c: unknown) => (calls.push(c), "shared") }));
    const { shareShop, shopLink } = await import("@/lib/shops/publicShop");
    await shareShop({ id: SHOP_ID, name: "Bayou Bakes", category_label: "Bakery and cakes", area_label: "Lafayette" });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { url: string }).url).toBe(shopLink(SHOP_ID));
    expect(shopLink(SHOP_ID)).toBe(`https://www.louisianahelpr.com/shops/${SHOP_ID}`);
    vi.doUnmock("@/lib/nativeShare");
  });
});
