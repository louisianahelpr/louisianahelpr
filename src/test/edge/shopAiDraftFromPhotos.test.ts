/**
 * S054 (Shops audit 11-12): the Shops AI draft only worked on a SAVED draft with uploaded photos; Declutter drafts a new
 * listing from photos still on the device. declutter-ai-draft now takes target "shop_item" with photos in the body and
 * no itemId (shopPhotosDraft), run here from the REAL source through the edge harness (the model call is a stubbed
 * fetch; nothing reaches Anthropic):
 *   - the 'shops' switch for the verified caller, then: the caller has a shop, and may sell on it
 *     (shop_owner_sell_block_reason for the VERIFIED id, never an id from the body), all before any spend;
 *   - its own hourly cap (30 an hour, Declutter's new-listing number), counted after the gates;
 *   - the photos only reach the model: no storage read or write, no record RPC; the answer goes through the shop
 *     sanitizer (banned flag fails closed);
 *   - Declutter's own photos path is not taken for a shop item (no 'declutter' gate, no declutter prompt).
 *
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   if (!shop) return json({ error: "shop_not_found" }, 403); |
 * @mutate supabase/functions/declutter-ai-draft/index.ts |   if (block) return json({ error: typeof block === "string" ? block : "account_restricted" }, 403); |
 * @mutate supabase/functions/declutter-ai-draft/index.ts | maxRequests: 30, keyPrefix: "shops-ai-photos" | maxRequests: 3000, keyPrefix: "shops-ai-photos"
 * @mutate supabase/functions/declutter-ai-draft/index.ts |  { p_owner_id: userId } |  { p_owner_id: body.ownerId }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { rateLimitCalls, rateLimitRefusedBuckets, resetSharedMocks } from "./mocks/shared";

const MAKER = "00000000-0000-4000-8000-0000000005a1";
// A JPEG-looking base64 string ("/9j/" start), long enough to pass the size floor.
const PHOTO = `/9j/${"A".repeat(400)}`;
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function call(body: Record<string, unknown>) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", ANTHROPIC_API_KEY: "sk-ant-test" });
  const fn = await loadEdgeFunction("declutter-ai-draft");
  const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-ai-draft", headers: { Authorization: "Bearer member-jwt" }, body }));
  const text = await res.text();
  return { status: res.status, body: (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<string, unknown> };
}

const modelAnswer = (o: Record<string, unknown>) =>
  vi.fn(async () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(o) }] }), { status: 200 }));

beforeEach(() => {
  resetEnv();
  resetSupabaseMock();
  resetSharedMocks();
  scenario.authUser = { id: MAKER, email: "maker@example.test" };
  scenario.rpc.feature_enabled_for_user = true;
  scenario.rpc.shop_owner_sell_block_reason = null;
  scenario.reads.shops = { rows: [{ id: "shop-1" }] };
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnv();
});

describe("S054: a new shop item is drafted from photos still on the device", () => {
  it("a maker with a shop gets a draft; the photos reach only the model; nothing is stored", async () => {
    const fetchMock = modelAnswer({ title: "Fig soy candle", description: "Hand-poured, 8 oz.", kind: "made", subtype: "candles", possibly_banned: false, banned_reason: "" });
    vi.stubGlobal("fetch", fetchMock);
    const r = await call({ mode: "draft", target: "shop_item", photos: [PHOTO, PHOTO] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ title: "Fig soy candle", description: "Hand-poured, 8 oz.", kind: "made", subtype: "candles", flagged: false });
    expect(rpcs("feature_enabled_for_user").map((c) => c.args)).toEqual([{ p_key: "shops", p_user_id: MAKER }]);
    expect(rpcs("shop_owner_sell_block_reason").map((c) => c.args)).toEqual([{ p_owner_id: MAKER }]);
    expect(rpcs("declutter_assert_can_draft_from_photos")).toHaveLength(0);
    expect(rpcs("shops_record_item_ai_check")).toHaveLength(0);
    expect(scenario.storage.objects.size).toBe(0);
    // Two photos sent, both as JPEGs, with the SHOP prompt.
    const sent = String((fetchMock.mock.calls[0] as unknown as [unknown, { body?: unknown }])[1]?.body);
    expect(sent.match(/"media_type":"image\/jpeg"/g)).toHaveLength(2);
    expect(sent).not.toContain("Declutter section");
    // Its own hourly bucket, Declutter's new-listing number.
    expect(rateLimitCalls.find((c) => c.keyPrefix === "shops-ai-photos")).toMatchObject({ windowMs: 3_600_000, maxRequests: 30 });
  });

  it("an answer that does not say the item is allowed comes back flagged (fails closed)", async () => {
    vi.stubGlobal("fetch", modelAnswer({ title: "Pocket knife set", description: "", kind: "made", subtype: "crafts" }));
    const r = await call({ mode: "draft", target: "shop_item", photos: [PHOTO] });
    expect(r.status).toBe(200);
    expect(r.body.flagged).toBe(true);
  });

  it("no shop: refused before the cap or the model", async () => {
    const fetchMock = modelAnswer({});
    vi.stubGlobal("fetch", fetchMock);
    scenario.reads.shops = { rows: [] };
    const r = await call({ mode: "draft", target: "shop_item", photos: [PHOTO] });
    expect(r).toMatchObject({ status: 403, body: { error: "shop_not_found" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rateLimitCalls.some((c) => c.keyPrefix === "shops-ai-photos")).toBe(false);
  });

  it("a maker who may not sell (strikes, ban, payout setup) is refused with that code, spending nothing", async () => {
    const fetchMock = modelAnswer({});
    vi.stubGlobal("fetch", fetchMock);
    scenario.rpc.shop_owner_sell_block_reason = "shop_strikes_blocked";
    const r = await call({ mode: "draft", target: "shop_item", photos: [PHOTO], ownerId: "00000000-0000-4000-8000-0000000009ff" });
    expect(r).toMatchObject({ status: 403, body: { error: "shop_strikes_blocked" } });
    expect(fetchMock).not.toHaveBeenCalled();
    // The id checked is the verified caller's, never one from the body.
    expect(rpcs("shop_owner_sell_block_reason").map((c) => c.args)).toEqual([{ p_owner_id: MAKER }]);
  });

  it("the hourly cap answers 429 before the model; bad photos are refused", async () => {
    const fetchMock = modelAnswer({});
    vi.stubGlobal("fetch", fetchMock);
    rateLimitRefusedBuckets.add("shops-ai-photos");
    expect((await call({ mode: "draft", target: "shop_item", photos: [PHOTO] })).status).toBe(429);
    rateLimitRefusedBuckets.clear();
    expect(await call({ mode: "draft", target: "shop_item", photos: ["not-a-jpeg"] })).toMatchObject({ status: 400, body: { error: "item_photos_invalid" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the 'shops' switch off refuses it", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    const r = await call({ mode: "draft", target: "shop_item", photos: [PHOTO] });
    expect(r).toMatchObject({ status: 403, body: { error: "feature_disabled" } });
    expect(rpcs("shop_owner_sell_block_reason")).toHaveLength(0);
  });
});
