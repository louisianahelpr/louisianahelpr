/**
 * Declutter client calls (src/lib/declutter/api.ts). Every write is a declutter_*
 * RPC; a refusal must surface (never be swallowed) carrying the plain words on
 * `userMessage`; every read goes through unwrap(); the photo upload deletes its
 * object again when the server refuses the attach.
 *
 * The Supabase client is a recording fake: each query, rpc, storage call and
 * function invoke is logged, and results are handed out from a queue.
 *
 * @mutate src/lib/declutter/api.ts |       .eq("status", "paid")\n      .order("closed_at", { ascending: false }), |       .order("closed_at", { ascending: false }),
 * @mutate src/lib/declutter/api.ts | if (r.item_id && !sales.has(r.item_id)) sales.set | if (r.item_id) sales.set
 * @mutate src/lib/declutter/api.ts | .select("item_id, price_cents, order_id") | .select("item_id, price_cents")
 * @mutate src/lib/declutter/api.ts |       p_not_a_frequent_seller: true,\n      p_keeps_item_until_handover: true,\n    }), (e) => rpcErrorMessage("declutter_attest_item", e)); |       p_not_a_frequent_seller: false,\n      p_keeps_item_until_handover: true,\n    }), (e) => rpcErrorMessage("declutter_attest_item", e));
 * @mutate src/lib/declutter/api.ts |       .limit(500), |       .limit(5000),
 * @mutate src/lib/declutter/api.ts |       .in("status", ["live", "reserved"])\n      .order( |       .in("status", ["live"])\n      .order(
 * @mutate src/lib/declutter/api.ts | await bucket.upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL }); | await bucket.upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
 * @mutate src/lib/declutter/api.ts |       const { error: rmErr } = await bucket.remove([path]);\n      if (rmErr) console.warn("[declutter] could not remove a refused photo upload", rmErr.message); |       const rmErr = null as { message: string } \| null;\n      if (rmErr) console.warn("[declutter] could not remove a refused photo upload", rmErr.message);
 * @mutate src/lib/declutter/api.ts |   if (itemIds.length === 0) return []; |   if (false) return [];
 * @mutate src/lib/declutter/api.ts |   if (paths.length === 0) return; |   if (false) return;
 * @mutate src/lib/declutter/api.ts |     await supabase.rpc("declutter_admin_review_item", { p_item_id: itemId, p_approve: approve, p_note: note ?? "" }) |     await supabase.rpc("declutter_admin_review_item", { p_item_id: itemId, p_approve: approve, p_note: note })
 * @mutate src/lib/declutter/api.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (msg) e.userMessage = msg;
 * @mutate src/lib/declutter/api.ts |       throw new Error("photo_not_uploaded");\n    },\n    attach: |       return;\n    },\n    attach:
 * @mutate src/lib/declutter/api.ts |   if (cleaned && !LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded"); |   if (false) throw new Error("photo_not_uploaded");
 * @mutate src/lib/declutter/api.ts |     throw new Error(code \|\| "ai_unavailable"); |     throw new Error(code);
 * @mutate src/lib/declutter/api.ts |     if (ctx?.status === 429) throw new Error("ai_rate_limited"); |     if (false) throw new Error("ai_rate_limited");
 * @mutate src/lib/declutter/api.ts |     const missing = res.error?.code === "42703" |     const missing = res.error?.code === "42501"
 * @mutate src/lib/declutter/api.ts | const NEWER_ITEM_COLUMNS: Record<string, boolean> = { porch_ok: true, accepts_offers: true }; | const NEWER_ITEM_COLUMNS: Record<string, boolean> = { porch_ok: true, accepts_offers: false };
 * @mutate src/lib/declutter/api.ts | live_at, porch_ok, accepts_offers"; | live_at, porch_ok";
 * @mutate src/lib/declutter/api.ts | { body, timeout: timeoutMs } | { body }
 * @mutate src/lib/declutter/api.ts |   for (const f of list) photos.push(await blobToBase64(await cleanListingPhoto(f, 1280, 0.75))); |   for (const f of list) photos.push(await blobToBase64(f));
 * @mutate src/lib/declutter/api.ts |   const list = files.slice(0, AI_DRAFT_PHOTOS); |   const list = files;
 * @mutate src/lib/declutter/api.ts | (error as { context?: { name?: unknown } }).context?.name === "AbortError"; | false;
 * @mutate src/lib/declutter/api.ts | const aborted = (error as { name?: unknown }).name === "AbortError" \|\| | const aborted =
 * @mutate src/lib/declutter/api.ts |   return rpcData(await supabase.rpc("declutter_publish_item", { p_item_id: itemId }), |   return rpcData(await supabase.rpc("declutter_publish_items", { p_item_id: itemId }),
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown; status?: number };

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown; status?: number }[] = [];
  const queries: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const store: unknown[][] = [];
  const invokes: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };

  const makeBuilder = (table: string) => {
    const q: { table: string; ops: [string, unknown[]][] } = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "limit", "eq", "neq", "maybeSingle"]) {
      b[m] = (...args: unknown[]) => {
        q.ops.push([m, args]);
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
    return b;
  };

  const supabase = {
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, ...args: unknown[]) => {
      rpcs.push([name, ...args]);
      return Promise.resolve(next());
    },
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => {
          store.push(["upload", bucket, ...a]);
          return Promise.resolve(next());
        },
        remove: (...a: unknown[]) => {
          store.push(["remove", bucket, ...a]);
          return Promise.resolve(next());
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      }),
    },
    functions: {
      invoke: (...a: unknown[]) => {
        invokes.push(a);
        return Promise.resolve(next());
      },
    },
    // LEAD-RESUME-REPOSTS: who is signed in, read locally (no queue entry).
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "me" } } }, error: null }) },
  };
  return { queue, queries, rpcs, store, invokes, supabase, clean: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/declutter/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: h.clean,
}));

import { FULL_LISTING_COPY } from "./photoRules";
import {
  AlreadyPosted,
  addPhotoSteadily,
  answerQuestion,
  askQuestion,
  attestItem,
  createDraft,
  fetchItem,
  fetchLiveItems,
  fetchMyItemPrivate,
  fetchMyItemReview,
  fetchMyItems,
  fetchMySales,
  fetchMyPickupWindows,
  fetchPendingForAdmin,
  fetchPhotos,
  fetchQuestions,
  fetchSellerCard,
  fetchSellerItems,
  fetchSellerRating,
  fetchSimilarItems,
  fetchWatching,
  photoPublicUrl,
  publishItem,
  removePhoto,
  requestAiCheck,
  requestAiDraft,
  requestAiDraftFromPhotos,
  setDropPct,
  setHandovers,
  AI_DRAFT_PHOTOS,
  AI_TIMEOUT_MS,
  reviewListing,
  setPickupWindows,
  setWatch,
  updateDraft,
  withdrawItem,
  type DraftFields,
} from "./api";
import { DECLUTTER_ERROR_COPY, DECLUTTER_CLIENT_ERROR_COPY, ListingPhotoError, declutterErrorMessage } from "./errors";

const ok = (data: unknown): Result => ({ data, error: null });
const refused = (message: string, extra: Record<string, unknown> = {}): Result => ({ data: null, error: { message, ...extra } });

const COLUMNS =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";

const FIELDS: DraftFields = {
  title: "Oak desk",
  description: "Solid oak, two drawers.",
  category: "furniture",
  conditionStars: 4,
  deliverySize: "large",
  priceCents: 12000,
  floorPriceCents: 9000,
  areaLabel: "Lafayette",
  pickupAddress: "1 Main St",
  pickupLat: 30.22,
  pickupLng: -92.02,
};
const DRAFT_ARGS = {
  p_title: "Oak desk",
  p_description: "Solid oak, two drawers.",
  p_category: "furniture",
  p_condition_stars: 4,
  p_delivery_size: "large",
  p_price_cents: 12000,
  p_floor_price_cents: 9000,
  p_area_label: "Lafayette",
  p_pickup_address: "1 Main St",
  p_pickup_lat: 30.22,
  p_pickup_lng: -92.02,
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.queue.length = 0;
  h.queries.length = 0;
  h.rpcs.length = 0;
  h.store.length = 0;
  h.invokes.length = 0;
  h.clean.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

/** What the call rejected with (fails the test when it resolved). */
async function rejection(p: Promise<unknown>): Promise<Error & { userMessage?: string; code?: string; status?: number }> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

describe("reads", () => {
  it("fetchLiveItems asks for live and reserved listings, newest first, capped at 500", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    h.queue.push(ok(rows));
    await expect(fetchLiveItems()).resolves.toEqual(rows);
    expect(h.queries).toEqual([
      {
        table: "declutter_items",
        ops: [
          ["select", [COLUMNS]],
          ["in", ["status", ["live", "reserved"]]],
          ["order", ["live_at", { ascending: false }]],
          ["limit", [500]],
        ],
      },
    ]);
  });

  it("fetchSellerItems reads the seller's other live and reserved listings, newest first, capped at 12", async () => {
    const rows = [{ id: "b" }];
    h.queue.push(ok(rows));
    await expect(fetchSellerItems("seller-1", "item-a")).resolves.toEqual(rows);
    expect(h.queries).toEqual([
      {
        table: "declutter_items",
        ops: [
          ["select", [COLUMNS]],
          ["eq", ["seller_id", "seller-1"]],
          ["in", ["status", ["live", "reserved"]]],
          ["neq", ["id", "item-a"]],
          ["order", ["live_at", { ascending: false }]],
          ["limit", [12]],
        ],
      },
    ]);
    h.queue.push(ok(null));
    await expect(fetchSellerItems("seller-1", "item-a")).resolves.toEqual([]);
  });

  it("fetchSimilarItems reads other sellers' live listings in the same category, newest first, capped at 12", async () => {
    const rows = [{ id: "c" }];
    h.queue.push(ok(rows));
    await expect(fetchSimilarItems("furniture", "item-a", "seller-1")).resolves.toEqual(rows);
    expect(h.queries).toEqual([
      {
        table: "declutter_items",
        ops: [
          ["select", [COLUMNS]],
          ["eq", ["category", "furniture"]],
          ["in", ["status", ["live", "reserved"]]],
          ["neq", ["id", "item-a"]],
          ["neq", ["seller_id", "seller-1"]],
          ["order", ["live_at", { ascending: false }]],
          ["limit", [12]],
        ],
      },
    ]);
    h.queue.push(refused("permission denied", { code: "42501" }));
    await expect(fetchSimilarItems("furniture", "item-a", "seller-1")).rejects.toBeTruthy();
  });

  it("fetchSellerCard shows only the row for the requested seller, public fields only", async () => {
    h.queue.push(
      ok([
        { user_id: "someone-else", full_name: "Wrong Person", avatar_url: "x", created_at: "2020-01-01" },
        { user_id: "seller-1", full_name: "Ada", avatar_url: "https://cdn.test/a.png", created_at: "2026-01-02T00:00:00Z" },
      ]),
    );
    await expect(fetchSellerCard("seller-1")).resolves.toEqual({ name: "Ada", avatarUrl: "https://cdn.test/a.png", joinedAt: "2026-01-02T00:00:00Z" });
    expect(h.rpcs).toEqual([["get_safe_profiles", { user_ids: ["seller-1"] }]]);
    h.queue.push(ok([{ user_id: "seller-1" }]));
    await expect(fetchSellerCard("seller-1")).resolves.toEqual({ name: null, avatarUrl: null, joinedAt: null });
    h.queue.push(ok([{ user_id: "someone-else", full_name: "Wrong Person" }]));
    await expect(fetchSellerCard("seller-1")).resolves.toBeNull();
    h.queue.push(ok(null));
    await expect(fetchSellerCard("seller-1")).resolves.toBeNull();
  });

  it("fetchMyItems filters by seller, newest first, and gives [] for a null body", async () => {
    h.queue.push(ok([{ id: "mine" }]));
    await expect(fetchMyItems("u1")).resolves.toEqual([{ id: "mine" }]);
    expect(h.queries[0]).toEqual({
      table: "declutter_items",
      ops: [
        // B48 live check 2026-10-29: the seller's own list also reads the ticked ways (handovers).
        ["select", [`${COLUMNS}, handovers`]],
        ["eq", ["seller_id", "u1"]],
        ["order", ["created_at", { ascending: false }]],
      ],
    });
    h.queue.push(ok(null));
    await expect(fetchMyItems("u1")).resolves.toEqual([]);
  });

  it("fetchMySales: the seller's PAID lines, newest first; the newest line per item wins; a refusal throws (SE-5, #60)", async () => {
    h.queue.push(ok([
      { item_id: "i1", price_cents: 3200, order_id: "o2" },
      { item_id: null, price_cents: 999, order_id: "o9" },
      { item_id: "i1", price_cents: 4000, order_id: "o1" },
      { item_id: "i2", price_cents: 0, order_id: null },
    ]));
    const sales = await fetchMySales("u1");
    expect([...sales.entries()]).toEqual([["i1", { cents: 3200, orderId: "o2" }], ["i2", { cents: 0, orderId: null }]]);
    expect(h.queries[0]).toEqual({
      table: "declutter_cart_items",
      ops: [
        ["select", ["item_id, price_cents, order_id"]],
        ["eq", ["seller_id", "u1"]],
        ["eq", ["status", "paid"]],
        ["order", ["closed_at", { ascending: false }]],
      ],
    });
    h.queue.push(ok(null));
    expect((await fetchMySales("u1")).size).toBe(0);
    h.queue.push(refused("permission denied", { code: "42501" }));
    await expect(fetchMySales("u1")).rejects.toBeTruthy();
  });

  it("fetchItem reads one row by id, and null when there is none", async () => {
    h.queue.push(ok({ id: "i1" }));
    await expect(fetchItem("i1")).resolves.toEqual({ id: "i1" });
    expect(h.queries[0]).toEqual({
      table: "declutter_items",
      ops: [
        ["select", [COLUMNS]],
        ["eq", ["id", "i1"]],
        ["maybeSingle", []],
      ],
    });
    h.queue.push(ok(null));
    await expect(fetchItem("gone")).resolves.toBeNull();
  });

  it("row 101 deploy window: porch_ok missing on the server (42703) reads again without it, porch on", async () => {
    h.queue.push({ data: null, error: { code: "42703", message: "column declutter_items.porch_ok does not exist" }, status: 400 });
    h.queue.push(ok({ id: "i1" }));
    await expect(fetchItem("i1")).resolves.toEqual({ id: "i1", porch_ok: true });
    expect(h.queries.map((q) => q.ops[0])).toEqual([["select", [COLUMNS]], ["select", [COLUMNS.replace(", porch_ok", "")]]]);
    h.queue.push({ data: null, error: { code: "42703", message: "column declutter_items.porch_ok does not exist" }, status: 400 });
    h.queue.push(ok([{ id: "a" }]));
    await expect(fetchLiveItems()).resolves.toEqual([{ id: "a", porch_ok: true }]);
  });

  it("smart offers deploy window: accepts_offers missing (42703) reads again without it, offers on; both missing too", async () => {
    expect(COLUMNS).toMatch(/, accepts_offers$/);
    h.queue.push({ data: null, error: { code: "42703", message: "column declutter_items.accepts_offers does not exist" }, status: 400 });
    h.queue.push(ok({ id: "i1", porch_ok: false }));
    await expect(fetchItem("i1")).resolves.toEqual({ id: "i1", porch_ok: false, accepts_offers: true });
    expect(h.queries.map((q) => q.ops[0])).toEqual([["select", [COLUMNS]], ["select", [COLUMNS.replace(", accepts_offers", "")]]]);
    h.queue.push({ data: null, error: { code: "42703", message: "column declutter_items.porch_ok does not exist" }, status: 400 });
    h.queue.push({ data: null, error: { code: "42703", message: "column declutter_items.accepts_offers does not exist" }, status: 400 });
    h.queue.push(ok([{ id: "a" }]));
    await expect(fetchLiveItems()).resolves.toEqual([{ id: "a", porch_ok: true, accepts_offers: true }]);
    expect(h.queries[h.queries.length - 1].ops[0]).toEqual(["select", [COLUMNS.replace(", porch_ok", "").replace(", accepts_offers", "")]]);
  });

  it("any other read refusal still throws (no second read)", async () => {
    h.queue.push({ data: null, error: { code: "42501", message: "permission denied for table declutter_items" }, status: 403 });
    await expect(fetchItem("i1")).rejects.toThrow(/permission denied/);
    expect(h.queries).toHaveLength(1);
  });

  it("fetchPhotos sends no query at all for an empty id list", async () => {
    await expect(fetchPhotos([])).resolves.toEqual([]);
    expect(h.queries).toHaveLength(0);
  });

  it("fetchPhotos reads the photos of the given items in position order", async () => {
    const rows = [{ id: "p1", item_id: "i1", storage_path: "s/1.jpg", position: 0 }];
    h.queue.push(ok(rows));
    await expect(fetchPhotos(["i1", "i2"])).resolves.toEqual(rows);
    expect(h.queries[0]).toEqual({
      table: "declutter_item_photos",
      ops: [
        ["select", ["id, item_id, storage_path, position"]],
        ["in", ["item_id", ["i1", "i2"]]],
        ["order", ["position", { ascending: true }]],
      ],
    });
    h.queue.push(ok(null));
    await expect(fetchPhotos(["i1"])).resolves.toEqual([]);
  });

  it("fetchQuestions reads one item's questions through declutter_item_questions, never the asker (Q2278)", async () => {
    h.queue.push(ok([{ id: "q1" }]));
    await expect(fetchQuestions("i1")).resolves.toEqual([{ id: "q1" }]);
    expect(h.rpcs[0]).toEqual(["declutter_item_questions", { p_item_id: "i1" }]);
    expect(h.queries).toEqual([]);
    h.queue.push(ok(null));
    await expect(fetchQuestions("i1")).resolves.toEqual([]);
  });

  // Owner 2026-10-28: before 20261028235247 deploys only porch can be recorded (setPorchOk), never a refused save.
  // @mutate src/lib/declutter/api.ts |     await setPorchOk(itemId, ways.includes("porch")); |     await setPorchOk(itemId, true);
  it("setHandovers before its RPC is deployed: records porch through setPorchOk", async () => {
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_set_handovers(p_handovers, p_item_id) in the schema cache", hint: null } });
    h.queue.push(ok(false));
    await expect(setHandovers("i1", ["meetup"])).resolves.toEqual(["meetup"]);
    expect(h.rpcs).toEqual([
      ["declutter_set_handovers", { p_item_id: "i1", p_handovers: ["meetup"] }],
      ["declutter_set_porch_ok", { p_item_id: "i1", p_porch_ok: false }],
    ]);
  });

  // Owner 2026-10-28, money review #1: before 20261028160637 deploys, 5% and off are already what the server does; another step is refused in words.
  // @mutate src/lib/declutter/api.ts |     if (pct === 0 \|\| pct === 5) return pct; |     return pct;
  it("setDropPct before its RPC is deployed: 5% and off pass, any other step says it is not ready", async () => {
    const missing = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_set_drop_pct(p_item_id, p_pct) in the schema cache", hint: null } });
    h.queue.push(missing());
    await expect(setDropPct("i1", 5)).resolves.toBe(5);
    h.queue.push(missing());
    await expect(setDropPct("i1", 0)).resolves.toBe(0);
    h.queue.push(missing());
    const e = await rejection(setDropPct("i1", 15));
    expect(e.message).toBe("drop_pct_unavailable");
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_CLIENT_ERROR_COPY.drop_pct_unavailable);
  });

  it("fetchQuestions falls back to the table read without asker_id only while the RPC is not deployed (PGRST202 naming it)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.queue.push({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_item_questions(p_item_id) in the schema cache", hint: null } });
    h.queue.push(ok([{ id: "q2" }]));
    await expect(fetchQuestions("i1")).resolves.toEqual([{ id: "q2" }]);
    expect(h.queries[0]).toEqual({
      table: "declutter_questions",
      ops: [
        ["select", ["id, item_id, question, answer, answered_at, created_at"]],
        ["eq", ["item_id", "i1"]],
        ["order", ["created_at", { ascending: true }]],
      ],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("fetchQuestions throws the RPC's own refusal with its words (no silent fallback)", async () => {
    h.queue.push({ data: null, error: { code: "42501", message: "feature_disabled" } });
    const err = (await fetchQuestions("i1").catch((e: unknown) => e)) as { userMessage?: string };
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.userMessage).toBe("string");
    expect(h.queries).toEqual([]);
  });

  it("fetchWatching returns the watched item ids as a Set", async () => {
    h.queue.push(ok([{ item_id: "a" }, { item_id: "b" }, { item_id: "a" }]));
    const set = await fetchWatching("u1");
    expect(set).toBeInstanceOf(Set);
    expect([...set].sort()).toEqual(["a", "b"]);
    expect(h.queries[0]).toEqual({
      table: "declutter_watchlist",
      ops: [
        ["select", ["item_id"]],
        ["eq", ["user_id", "u1"]],
      ],
    });
    h.queue.push(ok(null));
    expect((await fetchWatching("u1")).size).toBe(0);
  });

  it("fetchMyPickupWindows reads the seller's windows by weekday", async () => {
    const rows = [{ weekday: 1, starts_local: "09:00", ends_local: "12:00" }];
    h.queue.push(ok(rows));
    await expect(fetchMyPickupWindows("u1")).resolves.toEqual(rows);
    expect(h.queries[0]).toEqual({
      table: "declutter_pickup_windows",
      ops: [
        ["select", ["weekday, starts_local, ends_local"]],
        ["eq", ["seller_id", "u1"]],
        ["order", ["weekday", { ascending: true }]],
      ],
    });
    h.queue.push(ok(null));
    await expect(fetchMyPickupWindows("u1")).resolves.toEqual([]);
  });

  it("photoPublicUrl is the public URL in the job-photos bucket", () => {
    expect(photoPublicUrl("u/declutter/i/x.jpg")).toBe("https://cdn.test/job-photos/u/declutter/i/x.jpg");
  });

  it("fetchSellerRating asks the public profile stats for this seller only", async () => {
    h.queue.push(ok([
      { user_id: "other", avg_rating: 1, review_count: 99 },
      { user_id: "s1", avg_rating: "4.5", review_count: 12 },
    ]));
    await expect(fetchSellerRating("s1")).resolves.toEqual({ avg: 4.5, count: 12 });
    expect(h.rpcs[0]).toEqual(["get_public_profile_stats", { p_user_ids: ["s1"] }]);
  });

  it("fetchSellerRating treats a null average and count as 0, and no row as null", async () => {
    h.queue.push(ok([{ user_id: "s1", avg_rating: null, review_count: null }]));
    await expect(fetchSellerRating("s1")).resolves.toEqual({ avg: 0, count: 0 });
    h.queue.push(ok([{ user_id: "other", avg_rating: 5, review_count: 1 }]));
    await expect(fetchSellerRating("s1")).resolves.toBeNull();
    h.queue.push(ok(null));
    await expect(fetchSellerRating("s1")).resolves.toBeNull();
  });

  const readers: [string, () => Promise<unknown>][] = [
    ["fetchLiveItems", () => fetchLiveItems()],
    ["fetchMyItems", () => fetchMyItems("u1")],
    ["fetchItem", () => fetchItem("i1")],
    ["fetchPhotos", () => fetchPhotos(["i1"])],
    ["fetchQuestions", () => fetchQuestions("i1")],
    ["fetchWatching", () => fetchWatching("u1")],
    ["fetchMyPickupWindows", () => fetchMyPickupWindows("u1")],
    ["fetchSellerRating", () => fetchSellerRating("s1")],
  ];

  it.each(readers)("%s surfaces a Supabase error (with its status) instead of an empty result", async (_name, call) => {
    h.queue.push({ data: null, error: { message: "permission denied", code: "42501" }, status: 403 });
    const e = await rejection(call());
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("permission denied");
    expect(e.code).toBe("42501");
    expect(e.status).toBe(403);
  });
});

describe("RPC writes", () => {
  interface Case {
    label: string;
    call: () => Promise<unknown>;
    rpc: string;
    args: unknown[];
    data: unknown;
    want: unknown;
    /** A code this RPC can raise and the words RPC_ERROR_COPY has for it. */
    code: string;
  }
  const windows = [{ weekday: 2, starts: "09:00", ends: "11:00" }];
  const cases: Case[] = [
    { label: "setWatch", call: () => setWatch("i1", true), rpc: "declutter_set_watch", args: [{ p_item_id: "i1", p_watch: true }], data: "watching", want: "watching", code: "own_item" },
    { label: "setWatch off", call: () => setWatch("i1", false), rpc: "declutter_set_watch", args: [{ p_item_id: "i1", p_watch: false }], data: "unwatched", want: "unwatched", code: "own_item" },
    { label: "askQuestion", call: () => askQuestion("i1", "Still here?"), rpc: "declutter_ask_question", args: [{ p_item_id: "i1", p_question: "Still here?" }], data: "q1", want: "q1", code: "question_rate_limited" },
    { label: "answerQuestion", call: () => answerQuestion("q1", "Yes"), rpc: "declutter_answer_question", args: [{ p_question_id: "q1", p_answer: "Yes" }], data: "q1", want: "q1", code: "question_not_found" },
    { label: "createDraft", call: () => createDraft(FIELDS), rpc: "declutter_create_item", args: [DRAFT_ARGS], data: "new-id", want: "new-id", code: "area_looks_like_address" },
    { label: "updateDraft", call: () => updateDraft("i1", FIELDS), rpc: "declutter_update_draft", args: [{ p_item_id: "i1", ...DRAFT_ARGS }], data: "i1", want: "i1", code: "item_not_editable" },
    {
      label: "attestItem",
      call: () => attestItem("i1"),
      rpc: "declutter_attest_item",
      args: [{
        p_item_id: "i1",
        p_bought_for_personal_use: true,
        p_not_in_the_business: true,
        p_not_a_frequent_seller: true,
        p_keeps_item_until_handover: true,
      }],
      data: null,
      want: undefined,
      code: "attestation_incomplete",
    },
    { label: "setPickupWindows", call: () => setPickupWindows(windows), rpc: "declutter_set_pickup_windows", args: [{ p_windows: windows }], data: 1, want: 1, code: "invalid_pickup_windows" },
    { label: "publishItem", call: () => publishItem("i1"), rpc: "declutter_publish_item", args: [{ p_item_id: "i1" }], data: "pending_review", want: "pending_review", code: "photos_required" },
    { label: "fetchMyItemPrivate", call: () => fetchMyItemPrivate("i1"), rpc: "declutter_seller_item_private", args: [{ p_item_id: "i1" }], data: [{ pickup_address: "1 Main St" }, { x: 1 }], want: { pickup_address: "1 Main St" }, code: "item_not_found" },
    { label: "fetchMyItemReview", call: () => fetchMyItemReview("i1"), rpc: "declutter_my_item_review", args: [{ p_item_id: "i1" }], data: [{ note: "blurry photo" }], want: { note: "blurry photo" }, code: "item_not_found" },
    { label: "fetchPendingForAdmin", call: () => fetchPendingForAdmin(), rpc: "declutter_admin_pending_items", args: [{ p_include_test: false }], data: [{ id: "i1" }], want: [{ id: "i1" }], code: "not_admin" },
    { label: "reviewListing approve", call: () => reviewListing("i1", true, "looks fine"), rpc: "declutter_admin_review_item", args: [{ p_item_id: "i1", p_approve: true, p_note: "looks fine" }], data: "live", want: "live", code: "review_note_required" },
    { label: "removePhoto", call: () => removePhoto("p1"), rpc: "declutter_remove_item_photo", args: [{ p_photo_id: "p1" }], data: null, want: undefined, code: "photo_not_found" },
    { label: "withdrawItem", call: () => withdrawItem("i1"), rpc: "declutter_withdraw_item", args: [{ p_item_id: "i1" }], data: null, want: undefined, code: "item_not_editable" },
    { label: "setHandovers", call: () => setHandovers("i1", ["porch", "meetup"]), rpc: "declutter_set_handovers", args: [{ p_item_id: "i1", p_handovers: ["porch", "meetup"] }], data: ["meetup", "porch"], want: ["meetup", "porch"], code: "invalid_handovers" },
    { label: "setDropPct", call: () => setDropPct("i1", 10), rpc: "declutter_set_drop_pct", args: [{ p_item_id: "i1", p_pct: 10 }], data: 10, want: 10, code: "invalid_drop_pct" },
  ];

  it.each(cases)("$label calls $rpc with exactly its arguments and returns the result", async (c) => {
    h.queue.push(ok(c.data));
    await expect(c.call()).resolves.toEqual(c.want);
    expect(h.rpcs).toEqual([[c.rpc, ...c.args]]);
  });

  it.each(cases)("$label surfaces a refusal as an Error carrying the plain words", async (c) => {
    h.queue.push(refused(c.code, { code: "P0001" }));
    const e = await rejection(c.call());
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe(c.code);
    expect(e.code).toBe("P0001");
    expect(e.userMessage).toBe(DECLUTTER_ERROR_COPY[c.code]);
    expect(e.userMessage).toBeTruthy();
    // ...and a screen shows exactly those words.
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_ERROR_COPY[c.code]);
    // The RPC was the only thing called: a refused write touches no storage.
    expect(h.rpcs).toHaveLength(1);
    expect(h.store).toHaveLength(0);
  });

  it.each(cases)("$label rethrows a refusal it has no words for, without inventing a message", async (c) => {
    h.queue.push(refused("some_future_code"));
    const e = await rejection(c.call());
    expect(e.message).toBe("some_future_code");
    expect(e.userMessage).toBeUndefined();
    expect(declutterErrorMessage(e)).toBe("Something went wrong. Please try again.");
  });

  it("keeps the HTTP status of a refused write", async () => {
    h.queue.push({ data: null, error: { message: "own_item" }, status: 400 });
    const e = await rejection(setWatch("i1", true));
    expect(e.status).toBe(400);
    expect(e.userMessage).toBe(DECLUTTER_ERROR_COPY.own_item);
  });

  it("rethrows a refusal whose error object cannot be extended, unchanged", async () => {
    const frozen = Object.freeze(new Error("own_item"));
    h.queue.push({ data: null, error: frozen });
    const e = await rejection(setWatch("i1", true));
    expect(e).toBe(frozen);
    expect("userMessage" in e).toBe(false);
  });

  it("the words come from the RPC's own table: a code another RPC raises gets none here", async () => {
    // declutter_set_watch can raise own_item but never review_note_required.
    h.queue.push(refused("review_note_required"));
    const e = await rejection(setWatch("i1", true));
    expect(e.userMessage).toBeUndefined();
  });

  it("reviewListing sends an empty note, never null, when there is none", async () => {
    h.queue.push(ok("rejected"));
    await expect(reviewListing("i1", false, null)).resolves.toBe("rejected");
    expect(h.rpcs).toEqual([["declutter_admin_review_item", { p_item_id: "i1", p_approve: false, p_note: "" }]]);
  });

  it("fetchMyItemPrivate and fetchMyItemReview give null for no row or a null body", async () => {
    for (const read of [fetchMyItemPrivate, fetchMyItemReview]) {
      h.queue.push(ok([]));
      await expect(read("i1")).resolves.toBeNull();
      h.queue.push(ok(null));
      await expect(read("i1")).resolves.toBeNull();
    }
  });

  it("fetchPendingForAdmin gives [] for a null body", async () => {
    h.queue.push(ok(null));
    await expect(fetchPendingForAdmin()).resolves.toEqual([]);
  });
});

// LEAD-POST-SLOW (a), review of 62f90f3368 (4): a first Post whose answer was lost already made the draft with the
// app's id. The second Post reuses that draft (saving its fields again), never a second draft that would upload the
// photos twice; an id taken by anything else still gets a fresh draft.
// @mutate src/lib/declutter/api.ts |     if (mine === "draft") { |     if (false) {
// @mutate src/lib/declutter/api.ts |   if (row.status === "draft") return "draft"; |   if (row.status === "draft") return null;
// LEAD-RESUME-REPOSTS (owner 2026-10-31, prod duplicates c87b7de4 / 019dd0b3): Post again with an id that is already the
// seller's POSTED item makes no second copy; it says "Already posted" (AlreadyPosted, with the id to open).
// @mutate src/lib/declutter/api.ts |     if (mine) throw new AlreadyPosted(withId); |     void mine;
// @mutate src/lib/declutter/api.ts |   return row.seller_id === me ? row.status : null; |   return null;
describe("createDraft with the app's own id", () => {
  const taken = { data: null, error: { code: "22023", message: "item_id_taken" } };
  it("makes the draft with that id", async () => {
    h.queue.push(ok("app-id"));
    await expect(createDraft(FIELDS, "app-id")).resolves.toBe("app-id");
    expect(h.rpcs).toEqual([["declutter_create_item_with_id", { p_item_id: "app-id", ...DRAFT_ARGS }]]);
  });
  it("the id is the caller's own draft already: that draft is saved again and reused", async () => {
    h.queue.push(taken, ok({ id: "app-id", status: "draft" }), ok("app-id"));
    await expect(createDraft(FIELDS, "app-id")).resolves.toBe("app-id");
    expect(h.rpcs.map((r) => r[0])).toEqual(["declutter_create_item_with_id", "declutter_update_draft"]);
    expect(h.rpcs[1]).toEqual(["declutter_update_draft", { p_item_id: "app-id", ...DRAFT_ARGS }]);
  });
  it("LEAD-RESUME-REPOSTS: post, then Post again with the same id: no second copy, 'Already posted' with its id", async () => {
    for (const status of ["live", "pending_review", "reserved", "paused"]) {
      h.rpcs.length = 0;
      h.queue.push(taken, ok({ id: "app-id", status, seller_id: "me" }));
      const err = await createDraft(FIELDS, "app-id").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AlreadyPosted);
      expect((err as AlreadyPosted).itemId).toBe("app-id");
      expect((err as AlreadyPosted).userMessage).toBe("Already posted. It's under Selling.");
      expect(h.rpcs.map((r) => r[0])).toEqual(["declutter_create_item_with_id"]);
    }
  });
  it("the id is taken by a row that isn't the caller's: a fresh draft", async () => {
    for (const read of [ok(null), ok({ id: "app-id", status: "live", seller_id: "someone-else" })]) {
      h.rpcs.length = 0;
      h.queue.push(taken, read, ok("fresh"));
      await expect(createDraft(FIELDS, "app-id")).resolves.toBe("fresh");
      expect(h.rpcs.map((r) => r[0])).toEqual(["declutter_create_item_with_id", "declutter_create_item"]);
    }
  });
  // Lead review 10-31: a failed read said null, so a taken id got a fresh one; with the run's status read failed too,
  // the item was posted twice. Now it stops this item, makes nothing, and says why.
  // @mutate src/lib/declutter/api.ts |   if (r.error) throw Object.assign(new Error(`item_read_failed: ${r.error.message}`), { userMessage: CANT_CHECK }); |   if (r.error) return null;
  it("the id is taken and the check of it fails: nothing is made, never a fresh id (it may be posted)", async () => {
    h.rpcs.length = 0;
    h.queue.push(taken, { data: null, error: { code: "500", message: "boom" } });
    const err = await createDraft(FIELDS, "app-id").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AlreadyPosted);
    expect((err as { userMessage?: string }).userMessage).toBe("We couldn't check whether this item is already posted. Try again.");
    expect(h.rpcs.map((r) => r[0])).toEqual(["declutter_create_item_with_id"]);
  });
});

// @mutate src/lib/declutter/api.ts |       if (again && /already exists\|duplicate/i.test(error.message)) return; |       void again;
// @mutate src/lib/declutter/api.ts |       if (isNetworkFailure(error)) throw new Error(error.message); |       void isNetworkFailure;
// @mutate src/lib/declutter/api.ts | .eq("item_id", itemId).eq("storage_path", path).maybeSingle(); | .eq("item_id", itemId).maybeSingle();
// @mutate src/lib/declutter/api.ts | status >= 400 && status < 500 && status !== 408 && status !== 429) throw new PhotoUploadRefused("photo_not_uploaded"); | status >= 400 && status < 500 && status !== 408 && status !== 429) throw new Error("photo_not_uploaded");
// @mutate src/lib/declutter/api.ts | const { size = BUNCH_UPLOAD_SIZE, quality = BUNCH_UPLOAD_QUALITY, uploadedPath, ...hooks } = options; | const { size = 1920, quality = 0.82, uploadedPath, ...hooks } = options;
describe("addPhotoSteadily", () => {
  const file = new File(["raw"], "raw.png", { type: "image/png" });
  const cleaned = new File(["clean"], "clean.jpg", { type: "image/jpeg" });
  const quiet = { pause: async () => {}, whenBack: async () => {}, awayCount: () => 0 };
  const path = "seller-1/declutter/item-1/uuid-1.jpg";
  const dropped = { data: null, error: { message: "TypeError: Load failed", code: "" } };

  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    h.clean.mockResolvedValue(cleaned);
  });

  it("makes one smaller copy, and a dropped upload goes again to the same name", async () => {
    h.queue.push({ error: { message: "Load failed" } }, { error: null }, ok("photo-id"));
    await expect(addPhotoSteadily("seller-1", "item-1", file, quiet)).resolves.toBe("photo-id");
    expect(h.clean).toHaveBeenCalledTimes(1);
    expect(h.clean).toHaveBeenCalledWith(file, 1600, 0.78);
    expect(h.store.map((s) => s[2])).toEqual([path, path]);
    expect(h.rpcs).toHaveLength(1);
  });

  it("an upload whose answer was lost counts as done when the next try finds it there", async () => {
    h.queue.push({ error: { message: "Load failed" } }, { error: { message: "The resource already exists", status: 400 } }, ok("photo-id"));
    await expect(addPhotoSteadily("seller-1", "item-1", file, quiet)).resolves.toBe("photo-id");
    expect(h.rpcs).toHaveLength(1);
  });

  it("storage refusing the file isn't tried again", async () => {
    h.queue.push({ error: { message: "Payload too large", status: 413 } });
    const e = await rejection(addPhotoSteadily("seller-1", "item-1", file, quiet));
    expect(e.message).toBe("photo_not_uploaded");
    expect(h.store).toHaveLength(1);
    expect(h.rpcs).toHaveLength(0);
  });

  it("a lost answer from attaching asks about this photo first, and adds no second row", async () => {
    h.queue.push({ error: null }, dropped, ok({ id: "already-there" }));
    await expect(addPhotoSteadily("seller-1", "item-1", file, quiet)).resolves.toBe("already-there");
    expect(h.rpcs).toHaveLength(1);
    expect(h.queries[h.queries.length - 1].ops).toContainEqual(["eq", ["storage_path", path]]);
    // Its file is on the listing: never removed.
    expect(h.store.map((s) => s[0])).toEqual(["upload"]);
  });

  it("attaches again when the first try really didn't land", async () => {
    h.queue.push({ error: null }, dropped, ok(null), ok("photo-id"));
    await expect(addPhotoSteadily("seller-1", "item-1", file, quiet)).resolves.toBe("photo-id");
    expect(h.rpcs).toHaveLength(2);
  });

  it("a refused attach removes the file, isn't tried again, and keeps its words", async () => {
    h.queue.push({ error: null }, refused("too_many_photos", { code: "P0001" }), { error: null });
    const e = await rejection(addPhotoSteadily("seller-1", "item-1", file, quiet));
    expect(e.userMessage).toBe(DECLUTTER_ERROR_COPY.too_many_photos);
    expect(h.rpcs).toHaveLength(1);
    expect(h.store.map((s) => s[0])).toEqual(["upload", "remove"]);
  });
});

describe("addPhotoSteadily, the one-item form's copy", () => {
  const file = new File(["raw"], "raw.png", { type: "image/png" });
  const cleaned = new File(["clean"], "clean.jpg", { type: "image/jpeg" });
  const addPhoto = (seller: string, item: string, f: File) => addPhotoSteadily(seller, item, f, { ...FULL_LISTING_COPY, pause: async () => {}, whenBack: async () => {}, awayCount: () => 0 });

  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    h.clean.mockResolvedValue(cleaned);
  });

  it("cleans, uploads under the seller's folder, then attaches by path", async () => {
    h.queue.push({ data: null, error: null }); // upload
    h.queue.push(ok("photo-id")); // attach
    await expect(addPhoto("seller-1", "item-1", file)).resolves.toBe("photo-id");
    expect(h.clean).toHaveBeenCalledWith(file, 1920, 0.82);
    const path = "seller-1/declutter/item-1/uuid-1.jpg";
    expect(h.store).toEqual([
      ["upload", "job-photos", path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" }],
    ]);
    expect(h.rpcs).toEqual([["declutter_add_item_photo", { p_item_id: "item-1", p_storage_path: path }]]);
  });

  it("falls back to a timestamp name when randomUUID is not available", async () => {
    vi.stubGlobal("crypto", {});
    h.queue.push({ data: null, error: null });
    h.queue.push(ok("photo-id"));
    await addPhoto("seller-1", "item-1", file);
    const uploaded = h.store[0][2] as string;
    expect(uploaded).toMatch(/^seller-1\/declutter\/item-1\/\d+\.jpg$/);
    expect(h.rpcs[0][1]).toEqual({ p_item_id: "item-1", p_storage_path: uploaded });
  });

  it("refuses a result that is not a JPEG: nothing is uploaded or attached", async () => {
    h.clean.mockResolvedValue(new File(["x"], "x.heic", { type: "image/heic" }));
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    expect(e.message).toBe("photo_not_uploaded");
    expect(h.store).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
  });

  it("lets the cleaning refusal through untouched, uploading nothing", async () => {
    h.clean.mockRejectedValue(new ListingPhotoError("That photo could not be cleaned."));
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    expect(e).toBeInstanceOf(ListingPhotoError);
    expect(declutterErrorMessage(e)).toBe("That photo could not be cleaned.");
    expect(h.store).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
  });

  it("a failed upload throws photo_not_uploaded and never attaches", async () => {
    for (let i = 0; i < 12; i++) h.queue.push(refused("storage down"));
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    h.queue.length = 0;
    expect(e.message).toBe("photo_not_uploaded");
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_ERROR_COPY.photo_not_uploaded);
    expect(h.rpcs).toHaveLength(0);
    // Tried again to the same name, by itself, and nothing else was touched.
    expect(new Set(h.store.map((s) => s[0]))).toEqual(new Set(["upload"]));
    expect(new Set(h.store.map((s) => s[2])).size).toBe(1);
  });

  it("a refused attach deletes the uploaded object again and throws the refusal with its words", async () => {
    h.queue.push({ data: null, error: null }); // upload
    h.queue.push(refused("too_many_photos", { code: "P0001" })); // attach
    h.queue.push({ data: null, error: null }); // remove
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    const path = "seller-1/declutter/item-1/uuid-1.jpg";
    expect(h.store.map((s) => s[0])).toEqual(["upload", "remove"]);
    expect(h.store[1]).toEqual(["remove", "job-photos", [path]]);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("too_many_photos");
    expect(e.code).toBe("P0001");
    expect(e.userMessage).toBe(DECLUTTER_ERROR_COPY.too_many_photos);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a refusal with no words still throws, and carries no userMessage", async () => {
    h.queue.push({ data: null, error: null });
    h.queue.push(refused("some_future_code"));
    h.queue.push({ data: null, error: null });
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    expect(e.message).toBe("some_future_code");
    expect("userMessage" in e).toBe(false);
    expect(h.store.map((s) => s[0])).toEqual(["upload", "remove"]);
  });

  it("when the cleanup delete also fails it says so in the log and still throws the real refusal", async () => {
    h.queue.push({ data: null, error: null });
    h.queue.push(refused("item_not_editable"));
    h.queue.push(refused("could not delete"));
    const e = await rejection(addPhoto("seller-1", "item-1", file));
    expect(e.message).toBe("item_not_editable");
    expect(e.userMessage).toBe(DECLUTTER_ERROR_COPY.item_not_editable);
    expect(warn).toHaveBeenCalledWith("[declutter] could not remove a refused photo upload", "could not delete");
  });
});

describe("removePhoto and withdrawItem storage cleanup", () => {
  it("removePhoto deletes the object the server detached", async () => {
    h.queue.push(ok("s1/declutter/i1/a.jpg"));
    h.queue.push({ data: null, error: null });
    await removePhoto("p1");
    expect(h.store).toEqual([["remove", "job-photos", ["s1/declutter/i1/a.jpg"]]]);
  });

  it("removePhoto touches storage only when the server returned a path", async () => {
    h.queue.push(ok(null));
    await removePhoto("p1");
    expect(h.store).toHaveLength(0);
  });

  it("removePhoto warns, and still resolves, when the object cannot be deleted", async () => {
    h.queue.push(ok("s1/declutter/i1/a.jpg"));
    h.queue.push(refused("storage down"));
    await expect(removePhoto("p1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[declutter] photo objects not removed", "storage down");
  });

  it("withdrawItem deletes every detached object in one call", async () => {
    h.queue.push(ok(["a.jpg", "b.jpg"]));
    h.queue.push({ data: null, error: null });
    await withdrawItem("i1");
    expect(h.store).toEqual([["remove", "job-photos", ["a.jpg", "b.jpg"]]]);
  });

  it("withdrawItem does not touch storage for an empty or missing list", async () => {
    h.queue.push(ok([]));
    await withdrawItem("i1");
    h.queue.push(ok(null));
    await withdrawItem("i1");
    expect(h.store).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("withdrawItem warns, and still resolves, when the objects cannot be deleted", async () => {
    h.queue.push(ok(["a.jpg"]));
    h.queue.push(refused("storage down"));
    await expect(withdrawItem("i1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[declutter] photo objects not removed", "storage down");
  });
});

describe("the AI helpers", () => {
  const failing = (context?: unknown): Result => ({
    data: null,
    error: { message: "Edge Function returned a non-2xx status code", ...(context === undefined ? {} : { context }) },
  });

  it("requestAiDraft invokes declutter-ai-draft in draft mode and returns the suggestions", async () => {
    const draft = { title: "Oak desk", description: "d", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false };
    h.queue.push(ok(draft));
    await expect(requestAiDraft("i1")).resolves.toEqual(draft);
    expect(h.invokes).toEqual([["declutter-ai-draft", { body: { itemId: "i1", mode: "draft" }, timeout: AI_TIMEOUT_MS }]]);
    // Owner 2026-10-29: the price hint's point goes along, so the server grounds Claude's price in our sold prices.
    h.invokes.length = 0;
    h.queue.push(ok(draft));
    await requestAiDraft("i1", { lat: 30.45, lng: -91.15 });
    expect(h.invokes).toEqual([["declutter-ai-draft", { body: { itemId: "i1", mode: "draft", at: { lat: 30.45, lng: -91.15 } }, timeout: AI_TIMEOUT_MS }]]);
  });

  it("the photo tool has a client timeout above the edge function's own worst case, and a timeout says so", async () => {
    // declutter-ai-draft: 25 s model call + a short pause + one 25 s retry on a busy answer, plus its own reads.
    expect(AI_TIMEOUT_MS).toBeGreaterThan(51_500);
    expect(AI_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    // Aborted before the headers: functions-js wraps the AbortError.
    h.queue.push(failing(new DOMException("signal is aborted without reason", "AbortError")));
    const e = await rejection(requestAiDraft("i1"));
    expect(e.message).toBe("ai_timed_out");
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_timed_out);
    // Aborted while the body was read: the AbortError itself comes back.
    h.queue.push({ data: null, error: new DOMException("signal is aborted without reason", "AbortError") });
    expect((await rejection(requestAiCheck("i1"))).message).toBe("ai_timed_out");
  });

  // Owner 2026-10-28: a NEW listing has no draft, so its held photos go in the body (cleaned, never uploaded).
  it("requestAiDraftFromPhotos cleans up to 4 held photos and sends them in the body, uploading nothing", async () => {
    h.clean.mockImplementation(async (f: File) => new File([`clean-${f.name}`], f.name, { type: "image/jpeg" }));
    const draft = { title: "Oak desk", description: "d", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false };
    h.queue.push(ok(draft));
    const files = ["a", "b", "c", "d", "e"].map((n) => new File([n], `${n}.jpg`, { type: "image/jpeg" }));
    await expect(requestAiDraftFromPhotos(files)).resolves.toEqual(draft);
    expect(AI_DRAFT_PHOTOS).toBe(4);
    expect(h.clean).toHaveBeenCalledTimes(4);
    for (const call of h.clean.mock.calls) expect(call.slice(1)).toEqual([1280, 0.75]);
    expect(h.invokes).toEqual([["declutter-ai-draft", {
      body: { mode: "draft", photos: ["a", "b", "c", "d"].map((n) => btoa(`clean-${n}.jpg`)) },
      timeout: AI_TIMEOUT_MS,
    }]]);
    expect(h.store).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
    await expect(requestAiDraftFromPhotos([])).rejects.toThrow("ai_photos_required");
  });

  it("requestAiCheck invokes the same function in check mode", async () => {
    h.queue.push(ok({ checked: true, flagged: false }));
    await expect(requestAiCheck("i1")).resolves.toEqual({ checked: true, flagged: false });
    expect(h.invokes).toEqual([["declutter-ai-draft", { body: { itemId: "i1", mode: "check" }, timeout: AI_TIMEOUT_MS }]]);
  });

  it.each([
    ["requestAiDraft", requestAiDraft],
    ["requestAiCheck", requestAiCheck],
  ] as const)("%s throws the code the function sent in its JSON body", async (_n, call) => {
    h.queue.push(failing({ json: async () => ({ error: "ai_photos_required" }) }));
    const e = await rejection(call("i1"));
    expect(e.message).toBe("ai_photos_required");
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_photos_required);
  });

  it.each([
    ["our own limit's words", { error: "Too many requests. Please try again later." }],
    ["the model's limit, sent as ai_unavailable", { error: "ai_unavailable" }],
  ])("a 429 is the rate limit, whatever the body says: %s", async (_label, body) => {
    h.queue.push(failing({ status: 429, json: async () => body }));
    const e = await rejection(requestAiDraft("i1"));
    expect(e.message).toBe("ai_rate_limited");
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_rate_limited);
  });

  it("an error body that is not JSON warns and becomes ai_unavailable", async () => {
    const parseErr = new SyntaxError("Unexpected token");
    h.queue.push(failing({ json: async () => { throw parseErr; } }));
    const e = await rejection(requestAiDraft("i1"));
    expect(e.message).toBe("ai_unavailable");
    expect(warn).toHaveBeenCalledWith("[declutter] AI error body was not JSON", parseErr);
    expect(declutterErrorMessage(e)).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_unavailable);
  });

  it.each([
    ["no context at all", undefined],
    ["a context without json()", {}],
    ["a body with no error field", { json: async () => ({}) }],
    ["a null body", { json: async () => null }],
    ["a non-string error field", { json: async () => ({ error: 500 }) }],
    ["an empty error string", { json: async () => ({ error: "" }) }],
  ])("%s becomes ai_unavailable", async (_label, context) => {
    h.queue.push(failing(context));
    const e = await rejection(requestAiCheck("i1"));
    expect(e.message).toBe("ai_unavailable");
  });
});
