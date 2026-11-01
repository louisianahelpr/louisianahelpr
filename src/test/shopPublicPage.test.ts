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
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |      AND COALESCE((SELECT NOT s.paused FROM public.shops s WHERE s.id = p_shop_id), false); |      ;
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |      AND public.shop_state_ok(p_shop_id)\n     AND COALESCE | AND COALESCE
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |      AND public.shop_state_ok(p_shop_id)\n     AND COALESCE | AND public.feature_enabled_for_user('shops', (SELECT owner_id FROM public.shops WHERE id = p_shop_id)) AND public.shop_state_ok(p_shop_id) AND COALESCE
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |   SELECT public.feature_enabled_for('shops')\n     AND public.shop_state_ok(p_shop_id); |   SELECT public.feature_enabled_for('shops');
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |     'badges', public.shop_badges(v_s.id), |     'badges', public.shop_badges(v_s.id), 'rating', (SELECT r.rating FROM public.shop_owner_rating(v_s.owner_id) r),
// @mutate supabase/functions/shop-photo/index.ts |   const rl = await checkRateLimit(req, | const rl = { allowed: true, retryAfter: 0 }; void (req,
// @mutate supabase/functions/shop-photo/index.ts |       if (og) {\n | if (false) {\n
// @mutate supabase/functions/shop-photo/index.ts | !(length > 0 && length <= FALLBACK_MAX_BYTES) | false
// @mutate supabase/functions/shop-photo/index.ts | &quality=80&format=origin` | &quality=80`
// @mutate supabase/functions/shop-photo/index.ts |     if (og && !type.startsWith("image/jpeg")) { |     if (false) {
// @mutate supabase/functions/shop-photo/index.ts | maxRequests: 1200, ipMaxRequests: 6000, | maxRequests: 300, ipMaxRequests: 300,
// @mutate supabase/functions/shop-photo/index.ts |   if (now - lastAlertAt < ALERT_EVERY_MS) return;\n |
// @mutate supabase/functions/shop-photo/index.ts |         alertStorage(upstream.status, "render refused a link-card image"); |         await alertStorage(upstream.status, "render refused a link-card image");
// @mutate supabase/functions/shop-photo/index.ts |   const width = og ? (asked === OG_HEIGHT ? OG_HEIGHT : 1200) : | const width =
// @mutate src/lib/shops/publicShop.ts |   if (!isShopId(shopId)) return null;\n |
// @mutate src/lib/shops/publicShop.ts |   if ((error as { code?: string } \| null)?.code === "PGRST202") return null; |
// @mutate src/pages/shops/ShopPage.tsx |   const { settled, lastAnswer } = useFeatureStatus("shops"); |   const { lastAnswer } = useFeatureStatus("shops"); const settled = true;
// @mutate src/pages/shops/ShopPage.tsx |   if (lastAnswer === true) return <ShopView />; |   if (useFeatureStatus("shops").on) return <ShopView />;
// @mutate supabase/migrations/20261019042744_shops_public_page.sql | GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO anon, authenticated, service_role; | GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO authenticated, service_role;
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |     'area_label', v_s.area_label, |     'area_label', v_s.area_label, 'owner_id', v_s.owner_id,
// @mutate api/share.ts |     robots: SHOP_ROBOTS,\n    image: shopImage(shop), |     image: shopImage(shop),
// @mutate vercel.json | "source": "/shops/(.*)",\n      "headers": [\n        {\n          "key": "X-Robots-Tag",\n          "value": "noindex" | "source": "/shops/(.*)",\n      "headers": [\n        {\n          "key": "X-Robots-Tag",\n          "value": "index"
// @mutate public/robots.txt | Allow: /shops/ | Allow: /shopz/
// @mutate src/lib/shops/publicShop.ts |     url: shopLink(shop.id), |     url: SHOP_LINK_ORIGIN,
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |                  'id', ph.id, 'kind', ph.photo_kind, 'position', ph.position) |                  'id', ph.id, 'kind', ph.photo_kind, 'storage_path', ph.storage_path, 'position', ph.position)
// @mutate supabase/migrations/20261019042744_shops_public_page.sql |        WHERE ph.id = p_photo_id AND public.shop_link_visible(ph.shop_id)) |        WHERE ph.id = p_photo_id)
// @mutate api/share.ts | return respond(withStaticBody(applyMeta(shell, meta), url), meta.cdnCache); | return respond(withStaticBody(applyMeta(shell, meta), url));
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
    // No JWT, so an address rate limit before any lookup (lead /code-review #2), and one client per isolate.
    expect(edge.indexOf("await checkRateLimit(req,")).toBeGreaterThan(0);
    expect(edge.indexOf("await checkRateLimit(req,")).toBeLessThan(edge.indexOf('rpc("shops_public_photo_path"'));
    expect(edge.indexOf("createClient(")).toBeLessThan(edge.indexOf("serve("));
    // Render refused -> the original object, then an alert (review #3).
    expect(edge).toMatch(/\/storage\/v1\/render\/image\/public\/job-photos\/[\s\S]*\/storage\/v1\/object\/public\/job-photos\/[\s\S]*alertStorage\(/);

  });

  it("the photo proxy is robust: capped fallback, JPEG kept, burst-sized limit, unawaited deduped alert (lead re-review)", () => {
    const edge = blankComments(read("supabase/functions/shop-photo/index.ts"));
    // #1 the un-resized original: never for a link card, never over 2 MB or unsized.
    const fallback = edge.indexOf("/storage/v1/object/public/job-photos/");
    expect(fallback).toBeGreaterThan(0);
    const ogRefusal = edge.indexOf("if (og) {");
    expect(ogRefusal).toBeGreaterThan(0);
    expect(ogRefusal).toBeLessThan(fallback);
    expect(edge).toMatch(/const FALLBACK_MAX_BYTES = 2 \* 1024 \* 1024;/);
    expect(edge).toMatch(/!\(length > 0 && length <= FALLBACK_MAX_BYTES\)/);
    // #2 format=origin keeps the JPEG a JPEG (format=jpeg is refused by storage, measured);
    // and an og answer that is not image/jpeg is refused, so og:image:type is never false.
    expect(edge).toMatch(/\/storage\/v1\/render\/image\/public\/job-photos\/[^`]*&format=origin`/);
    expect(edge).toMatch(/if \(og && !type\.startsWith\("image\/jpeg"\)\)/);
    // #4 a page bursts ~114 images: the per-address window fits it, the wide one is wider.
    const rate = /const RATE = \{ windowMs: 60_000, maxRequests: (\d+), ipMaxRequests: (\d+),/.exec(edge);
    expect(rate, "the RATE constant").toBeTruthy();
    expect(Number(rate![1])).toBeGreaterThanOrEqual(1200);
    expect(Number(rate![2])).toBeGreaterThan(Number(rate![1]));
    // #6 the alert is fired, not awaited, and deduped before postSlackOpsAlert writes its row.
    expect(edge).not.toMatch(/await alertStorage\(/);
    const fn = edge.slice(edge.indexOf("function alertStorage("), edge.indexOf("function unavailable("));
    expect(fn.indexOf("if (now - lastAlertAt < ALERT_EVERY_MS) return;")).toBeGreaterThan(0);
    expect(fn.indexOf("if (now - lastAlertAt < ALERT_EVERY_MS) return;")).toBeLessThan(fn.indexOf("postSlackOpsAlert("));
    expect(fn).not.toMatch(/\bawait\b/);
  });

  it("the preview image is served at exactly the size api/share.ts declares (review #6)", () => {
    const edge = blankComments(read("supabase/functions/shop-photo/index.ts"));
    expect(edge).toMatch(/const OG_HEIGHT = 630;/);
    expect(edge).toMatch(/const width = og \? \(asked === OG_HEIGHT \? OG_HEIGHT : 1200\) :/);
    expect(edge).toMatch(/og \? `width=\$\{width\}&height=\$\{OG_HEIGHT\}&resize=cover`/);
    const share = blankComments(read("api/share.ts"));
    expect(share).toMatch(/const w = square \? 630 : 1200;/);
    expect(share).toMatch(/width: w,\s*height: 630,/);
  });

  it("anon may execute shops_public_shop; shop_link_visible stays internal", () => {
    const sql = migSql(fn!.file);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.shops_public_shop\(uuid\) TO anon\b/);
    expect(migSql(vis!.file)).toMatch(/REVOKE ALL ON FUNCTION public\.shop_link_visible\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(migSql(vis!.file)).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.shop_link_visible\(uuid\) TO [^;]*\b(anon|authenticated)\b/);
  });

  it("refuses hidden, paused, seed-while-hidden, bad-standing shops and a switched-off Shops, through ONE shared state rule", () => {
    const state = defs.get("shop_state_ok");
    const members = defs.get("shop_publicly_visible");
    expect(state && members).toBeTruthy();
    const stateBody = blankSqlComments(state!.stmt);
    for (const rule of [/hidden_at IS NULL/, /seed_jobs_hidden_publicly\(\)/, /shop_owner_in_good_standing\(s\.owner_id\)/]) {
      expect(stateBody, String(rule)).toMatch(rule);
    }
    // Lead /code-review #4: members and link visitors read the SAME helper, no copy of the rule.
    const membersBody = blankSqlComments(members!.stmt);
    expect(membersBody).toMatch(/feature_enabled_for\('shops'\)\s+AND public\.shop_state_ok\(p_shop_id\)/);
    expect(membersBody).not.toMatch(/hidden_at|seed_jobs_hidden_publicly/);
    const body = blankSqlComments(vis!.stmt);
    expect(body).toMatch(/public\.shop_state_ok\(p_shop_id\)/);
    expect(body).toMatch(/NOT s\.paused/);
    expect(body).toMatch(/f\.key = 'shops' AND f\.audience IN \('testers', 'everyone'\)/);
    expect(body).not.toMatch(/hidden_at|seed_jobs_hidden_publicly/);
    // Lead /code-review #5: never the OWNER's own switch (a per-owner answer is a tester oracle for anon).
    expect(body).not.toMatch(/feature_enabled_for/);
    expect(blankSqlComments(fn!.stmt)).toMatch(/NOT public\.shop_link_visible\(p_shop_id\)/);
  });

  it("never returns owner-private fields", () => {
    const body = blankSqlComments(fn!.stmt);
    const keys = [...body.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    // rating / review_count: the owner's PERSON rating (get_public_profile_stats) would fingerprint the owner (review #10).
    for (const banned of ["owner_id", "pin_lat", "pin_lng", "sos_number", "hidden_reason", "hidden", "following", "mine", "pickup_address", "address_line1", "rating", "review_count"]) {
      expect(keys, banned).not.toContain(banned);
    }
    expect(body).not.toMatch(/shop_pickup_address|shop_item_private|shop_owner_rating|get_public_profile_stats/);
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
    // Values only: still exactly one og:image tag (owner 10-31: no second, square one).
    expect(html.match(/<meta property="og:image" /g)?.length).toBe(1);
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

describe("SH2b: the page never shows a retry for a link that cannot work", () => {
  it("a non-uuid id answers null with no request; a not-yet-deployed RPC (PGRST202) answers null", async () => {
    const rpc = vi.fn();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
    const { fetchPublicShop } = await import("@/lib/shops/publicShop");
    expect(await fetchPublicShop("mine")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await fetchPublicShop(SHOP_ID)).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement" } });
    await expect(fetchPublicShop(SHOP_ID)).rejects.toThrow();
    vi.doUnmock("@/integrations/supabase/client");
    vi.resetModules();
  });

  it("ShopPage decides member vs public through useFeatureStatus, not a hand-built query key (review #7)", () => {
    const page = blankComments(read("src/pages/shops/ShopPage.tsx"));
    expect(page).toMatch(/const \{ settled, lastAnswer \} = useFeatureStatus\("shops"\);/);
    expect(page).not.toMatch(/feature-enabled|getQueryState/);
  });

  it("a failed switch refetch keeps a member on the full page; only a successful 'off' shows the public one (re-review #3)", async () => {
    const status = { on: false, settled: false, lastAnswer: null as boolean | null };
    vi.doMock("@/hooks/useFeature", () => ({ useFeatureStatus: () => status }));
    vi.doMock("@/components/shops/ShopView", () => ({ default: function ShopView() { return null; } }));
    vi.doMock("@/components/shops/PublicShopView", () => ({ default: function PublicShopView() { return null; } }));
    vi.doMock("@/components/AppPage", () => ({ default: function AppPage() { return null; } }));
    const { default: ShopPage } = await import("@/pages/shops/ShopPage");
    const shown = () => ((ShopPage() as { type: { name: string } }).type.name);
    expect(shown()).toBe("AppPage"); // pending: nothing paints yet
    Object.assign(status, { on: true, settled: true, lastAnswer: true });
    expect(shown()).toBe("ShopView");
    Object.assign(status, { on: false, settled: true, lastAnswer: true }); // refetch ERROR
    expect(shown()).toBe("ShopView");
    Object.assign(status, { on: false, settled: true, lastAnswer: false }); // successful off
    expect(shown()).toBe("PublicShopView");
    Object.assign(status, { on: false, settled: true, lastAnswer: null }); // signed out / first read failed
    expect(shown()).toBe("PublicShopView");
    for (const m of ["@/hooks/useFeature", "@/components/shops/ShopView", "@/components/shops/PublicShopView", "@/components/AppPage"]) vi.doUnmock(m);
    vi.resetModules();
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
