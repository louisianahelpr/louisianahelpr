/**
 * Q1837: the loading-state catalog measures a REAL Declutter item page.
 *
 * deriveRouteSet turned /declutter/item/:id into /declutter/item/test, which is
 * not an item id (isItemId), so the page painted "This item isn't available."
 * at once and measured a clean 0px: the real item skeleton
 * (DeclutterItemSkeleton) was never compared with a real item. The run now
 * makes one draft listing as the helper test account
 * (createLoadingDeclutterItem), measures it as the helper (a draft is only its
 * seller's to read), keys it as /declutter/item/:id (a new id every run), and
 * removes it in the run's finally (removeLoadingDeclutterItem, which refuses
 * anything without the press marker or not a draft).
 *
 * @mutate scripts/audit/press-every-control.mjs |       push(`/declutter/item/${declutterItemId}`, r, ["helper"]); |
 * @mutate scripts/check-loading-state-shape.mjs | .replace(/^\/declutter\/item\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "/declutter/item/:id") |
 * @mutate scripts/audit/measure-loading-states.mjs |       declutterItemId,\n      seedJobId, |       seedJobId,
 * @mutate scripts/audit/measure-loading-states.mjs |       const gone = await removeLoadingDeclutterItem(declutterSeller, declutterItemId); |       const gone = { ok: true, note: "skipped" };
 * @mutate scripts/audit/measure-loading-states.mjs |         const seller = await mintLoadingSeller(); |         const seller = helper;
 * @mutate scripts/audit/pressProdSafety.mjs |   const r = await fetch(`${INBOX_REST()}/rpc/${name}`, { method: "POST", headers: inboxHeaders(token), body: JSON.stringify(args) }); |   const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, { method: "POST", headers: headers({ accessToken: token }), body: JSON.stringify(args) });
 * @mutate scripts/audit/pressProdSafety.mjs |     if (!String(row.title ?? "").includes(PRESS_MARKER)) return { ok: false, note: "not a fixture item (no marker); refusing to remove it" }; |
 * @mutate scripts/audit/pressProdSafety.mjs |     if (row.status !== "draft") return { ok: false, note: `status ${row.status}, not draft; left for the service-role sweeper` }; |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import { deriveRouteSet } from "../../scripts/audit/press-every-control.mjs";
import { stableUrl } from "../../scripts/check-loading-state-shape.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import { PRESS_MARKER, removeLoadingDeclutterItem } from "../../scripts/audit/pressProdSafety.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ITEM = "3f2b6c1e-8a4d-4f0e-9b7a-1c2d3e4f5a6b";
const args = { seedJobId: "j", helperId: "h", customerId: "c", adminViews: [] as string[] };

describe("Q1837: the loading catalog measures a real Declutter item", () => {
  it("measures the run's own item as its seller (the helper) and still measures the not-an-id path", () => {
    const set = deriveRouteSet({ ...args, declutterItemId: ITEM });
    const real = set.filter((r: { url: string }) => r.url === `/declutter/item/${ITEM}`);
    expect(real).toHaveLength(1);
    expect(real[0].personas).toEqual(["helper"]);
    expect(set.some((r: { url: string }) => r.url === "/declutter/item/test")).toBe(true);
    // Inventory floor: the catalog is the whole app, not just this route.
    expect(set.length).toBeGreaterThan(40);
  });

  it("adds no item url when the run made no item", () => {
    const set = deriveRouteSet(args);
    expect(set.some((r: { url: string }) => /^\/declutter\/item\/[0-9a-f-]{36}$/.test(r.url))).toBe(false);
  });

  it("keys the per-run id as /declutter/item/:id and keeps /declutter/item/test its own surface", () => {
    expect(stableUrl(`/declutter/item/${ITEM}`)).toBe("/declutter/item/:id");
    expect(stableUrl(`/declutter/item/${ITEM.replace("3f", "aa")}`)).toBe("/declutter/item/:id");
    expect(stableUrl("/declutter/item/test")).toBe("/declutter/item/test");
    expect(stableUrl("/jobs/abc")).toBe("/jobs/:id");
  });

  it("the run passes its item to the route set and removes it in its finally", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/audit/measure-loading-states.mjs"), "utf8"));
    // CodeQL js/file-access-to-http: the fixture runs on its own in-process session, never the cached helper's.
    expect(src).toMatch(/const seller = await mintLoadingSeller\(\);/);
    expect(src).toMatch(/createLoadingDeclutterItem\(seller,/);
    expect(src).not.toMatch(/createLoadingDeclutterItem\(helper/);
    expect(src).toMatch(/deriveRouteSet\(\{\s*declutterItemId,/);
    const fin = src.slice(src.lastIndexOf("} finally {"));
    expect(fin).toMatch(/removeLoadingDeclutterItem\(declutterSeller, declutterItemId\)/);
  });
});

describe("removeLoadingDeclutterItem removes only its own draft", () => {
  const seller = { userId: "u1", token: "t" };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const stub = (row: Record<string, unknown> | null) => {
    // A loopback stub URL: the unit env's https://unit-test.invalid is refused before any fetch.
    vi.stubEnv("PLAYWRIGHT_SUPABASE_URL", "http://127.0.0.1:54321");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(row ? [row] : []), { status: 200 });
    }));
    return calls;
  };

  it("refuses a row without the press marker and never calls withdraw", async () => {
    const calls = stub({ id: ITEM, title: "Someone's real chair", status: "draft" });
    const r = await removeLoadingDeclutterItem(seller, ITEM);
    expect(r.note).toMatch(/no marker/);
    expect(calls.some((u) => u.includes("/rest/v1/declutter_items?"))).toBe(true);
    expect(r.ok).toBe(false);
    expect(calls.some((u) => u.includes("declutter_withdraw_item"))).toBe(false);
  });

  it("refuses a marked row that is no longer a draft", async () => {
    const calls = stub({ id: ITEM, title: `${PRESS_MARKER} loading x`, status: "live" });
    const r = await removeLoadingDeclutterItem(seller, ITEM);
    expect(r.note).toMatch(/not draft/);
    expect(r.ok).toBe(false);
    expect(calls.some((u) => u.includes("declutter_withdraw_item"))).toBe(false);
  });

  it("the fixture's requests use only env/constant URLs and the minted token (no cached session, no .env read)", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/audit/pressProdSafety.mjs"), "utf8"));
    const start = src.indexOf("const LOADING_PIXEL");
    const body = src.slice(start, src.indexOf("export async function removeLoadingDeclutterItem") + 2000);
    expect(start).toBeGreaterThan(0);
    expect(body).not.toMatch(/supabaseUrl\(\)|anonKey\(\)|prodSelect\(|headers\(seller|\.accessToken/);
    expect(body).toMatch(/mintAdminSession\(\{ email, serviceKey: resolveServiceKey\(\) \}\)/);
  });

  it("sends the minted token and the loopback base, not a cached session", async () => {
    const calls = stub({ id: ITEM, title: "x", status: "draft" });
    await removeLoadingDeclutterItem(seller, ITEM);
    expect(calls[0]).toMatch(/^http:\/\/127\.0\.0\.1:54321\/rest\/v1\/declutter_items\?/);
  });

  it("an item already gone is fine", async () => {
    stub(null);
    const r = await removeLoadingDeclutterItem(seller, ITEM);
    expect(r.note).toBe("already gone");
    expect(r.ok).toBe(true);
  });
});
