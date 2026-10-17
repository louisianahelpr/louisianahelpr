/**
 * Declutter moving-out mode, client half (src/lib/declutter/moves.ts;
 * docs/specs/declutter-moving-out.md). The pure rules mirror the server's
 * (declutter_move_out_date_problem, declutter_create_item's price rules); the
 * calls must surface every refusal with plain words, and listing many items
 * must go through the one-item calls, spaced under the AI rate limit.
 *
 * The Supabase client is a recording fake (as in api.test.ts): the server's
 * behaviour is proven in src/test/pglite/declutterMovingOut.pglite.mjs.
 *
 * @mutate src/lib/declutter/moves.ts |   if (d > MOVE_DATE_MAX_DAYS) return "Pick a move-out date within the next 6 months."; |   if (false) return "Pick a move-out date within the next 6 months.";
 * @mutate src/lib/declutter/moves.ts |   if (price === null \|\| price < 100 \|\| price > 100_000) return | if (price === null \|\| price < 100) return
 * @mutate src/lib/declutter/moves.ts |       floor_price_cents: r.floor.trim() ? moveDollarsToCents(r.floor)! : price, |       floor_price_cents: 100,
 * @mutate src/lib/declutter/moves.ts |       if (gap > 0) await wait(gap); |       if (false) await wait(gap);
 * @mutate src/lib/declutter/moves.ts |     if (status === 429) throw new Error("ai_rate_limited"); |     if (false) throw new Error("ai_rate_limited");
 * @mutate src/lib/declutter/moves.ts |   if (error) rpcFail(error, rpcErrorMessage("declutter_create_move_drafts", error)); |   if (false) rpcFail(error, rpcErrorMessage("declutter_create_move_drafts", error));
 * @mutate src/lib/declutter/moves.ts |   if (!Array.isArray(items)) throw new Error("ai_unavailable"); |   if (!Array.isArray(items)) return [];
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const queries: { table: string; ops: [string, unknown[]][] }[] = [];
  const rpcs: unknown[][] = [];
  const invokes: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const makeBuilder = (table: string) => {
    const q: { table: string; ops: [string, unknown[]][] } = { table, ops: [] };
    queries.push(q);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "limit", "eq", "not"]) {
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
    functions: {
      invoke: (...a: unknown[]) => {
        invokes.push(a);
        return Promise.resolve(next());
      },
    },
  };
  const api = { attestItem: vi.fn(), requestAiCheck: vi.fn(), publishItem: vi.fn() };
  return { queue, queries, rpcs, invokes, supabase, clean: vi.fn(), api };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/declutter/photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/photos")>()),
  cleanListingPhoto: h.clean,
}));
vi.mock("@/lib/declutter/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/declutter/api")>()),
  attestItem: h.api.attestItem,
  requestAiCheck: h.api.requestAiCheck,
  publishItem: h.api.publishItem,
}));

import {
  AI_CHECK_GAP_MS,
  chunk,
  createMoveDrafts,
  daysBetween,
  fetchMyMoveItems,
  fetchMyMoveOutDate,
  formatMoveDate,
  louisianaToday,
  moveDateProblem,
  moveDollarsToCents,
  moveRowProblem,
  publishMany,
  scanRoom,
  setMoveOutDate,
  toMovePayload,
  toMoveRows,
  type MoveRow,
  type RoomItem,
} from "./moves";
import { fetchSellerMovingSale, movingSaleLine } from "./movingSale";
import { declutterErrorMessage, DECLUTTER_CLIENT_ERROR_COPY, DECLUTTER_ERROR_COPY } from "./errors";

const FOUND: RoomItem = { title: "Oak dresser", description: "Six drawers.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false };
const row = (o: Partial<MoveRow> = {}): MoveRow => ({ ...FOUND, key: "r-0", keep: true, price: "80", floor: "", ...o });
const PLACE = { areaLabel: "Mid-City", pickupAddress: "1 Main St", pickupLat: 30.45, pickupLng: -91.15 };

beforeEach(() => {
  h.queue.length = 0;
  h.queries.length = 0;
  h.rpcs.length = 0;
  h.invokes.length = 0;
  h.clean.mockReset();
  h.api.attestItem.mockReset();
  h.api.requestAiCheck.mockReset();
  h.api.publishItem.mockReset();
});

describe("dates", () => {
  it("today is Louisiana's day, not the device's or UTC's", () => {
    // 03:00 UTC on Nov 2 is still Nov 1 in Louisiana (CDT, UTC-5).
    expect(louisianaToday(new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-01");
    expect(louisianaToday(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-02");
  });

  it("counts whole days, across a month and a DST change", () => {
    expect(daysBetween("2026-10-16", "2026-10-16")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-10-16", "2027-04-14")).toBe(180);
  });

  it("accepts today to 180 days out, as the server does", () => {
    const today = "2026-10-16";
    expect(moveDateProblem("2026-10-16", today)).toBeNull();
    expect(moveDateProblem("2027-04-14", today)).toBeNull();
    expect(moveDateProblem("2026-10-15", today)).toMatch(/past/);
    expect(moveDateProblem("2027-04-15", today)).toMatch(/6 months/);
    expect(moveDateProblem("", today)).toMatch(/Pick your move-out date/);
    expect(moveDateProblem("10/20/2026", today)).toMatch(/Pick your move-out date/);
  });

  it("reads a date as a calendar day (no time-zone shift to the day before)", () => {
    expect(formatMoveDate("2026-11-14")).toBe("Saturday, Nov 14");
  });

  it("the banner line gives the exact date, in plain words (owner 2026-10-17)", () => {
    expect(movingSaleLine("2026-11-14", 12, "2026-10-16")).toBe("Moving out Saturday, Nov 14. 12 items for sale.");
    expect(movingSaleLine("2026-10-17", 1, "2026-10-16")).toBe("Moving out tomorrow. 1 item for sale.");
    expect(movingSaleLine("2026-10-16", 2, "2026-10-16")).toBe("Moving out today. 2 items for sale.");
    expect(movingSaleLine("2027-01-09", 100, "2026-10-16", true)).toBe("Moving out Saturday, Jan 9. 100+ items for sale.");
  });
});

describe("rows and prices", () => {
  it("dollars as typed become whole cents; blanks and junk do not", () => {
    expect(moveDollarsToCents("$1,000")).toBe(100_000);
    expect(moveDollarsToCents("12.5")).toBe(1250);
    expect(moveDollarsToCents("")).toBeNull();
    expect(moveDollarsToCents("free")).toBeNull();
    expect(moveDollarsToCents("-5")).toBeNull();
  });

  it("each kept row needs a name and a price from $1 to $1,000, and a lowest price within it", () => {
    expect(moveRowProblem(row())).toBeNull();
    expect(moveRowProblem(row({ title: "ab" }))).toMatch(/name/);
    expect(moveRowProblem(row({ price: "" }))).toMatch(/price between \$1 and \$1,000/);
    expect(moveRowProblem(row({ price: "1000.01" }))).toMatch(/\$1,000/);
    expect(moveRowProblem(row({ price: "0.50" }))).toMatch(/\$1/);
    expect(moveRowProblem(row({ floor: "90" }))).toMatch(/lowest price/);
    expect(moveRowProblem(row({ floor: "0.5" }))).toMatch(/lowest price/);
    expect(moveRowProblem(row({ floor: "40" }))).toBeNull();
  });

  it("found items start kept and unpriced (no price is guessed)", () => {
    const rows = toMoveRows([FOUND, { ...FOUND, title: "Lamp" }], "room1");
    expect(rows.map((r) => [r.key, r.keep, r.price, r.floor])).toEqual([["room1-0", true, "", ""], ["room1-1", true, "", ""]]);
  });

  it("the server payload drops unkept rows; a blank lowest price is the price", () => {
    const p = toMovePayload([row(), row({ key: "r-1", keep: false }), row({ key: "r-2", title: " Lamp ", price: "15", floor: "10" })]);
    expect(p).toEqual([
      { title: "Oak dresser", description: "Six drawers.", category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 8000, floor_price_cents: 8000 },
      { title: "Lamp", description: "Six drawers.", category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 1500, floor_price_cents: 1000 },
    ]);
  });

  it("chunks into the server's batch size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(Array.from({ length: 31 }, (_, i) => i), 15).map((c) => c.length)).toEqual([15, 15, 1]);
    expect(chunk([], 15)).toEqual([]);
  });
});

describe("server calls", () => {
  it("createMoveDrafts sends one all-or-nothing call and returns the ids", async () => {
    h.queue.push({ data: ["a", "b"], error: null });
    expect(await createMoveDrafts("2026-11-14", PLACE, [row(), row({ key: "r-1", title: "Lamp" })])).toEqual(["a", "b"]);
    expect(h.rpcs[0][0]).toBe("declutter_create_move_drafts");
    expect(h.rpcs[0][1]).toMatchObject({ p_move_out_on: "2026-11-14", p_area_label: "Mid-City", p_pickup_address: "1 Main St", p_pickup_lat: 30.45, p_pickup_lng: -91.15 });
    expect((h.rpcs[0][1] as { p_items: unknown[] }).p_items).toHaveLength(2);
  });

  it("a refusal surfaces with the plain words (never swallowed)", async () => {
    h.queue.push({ data: null, error: { message: "move_draft_limit" } });
    const err = await createMoveDrafts("2026-11-14", PLACE, [row()]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(declutterErrorMessage(err)).toBe(DECLUTTER_ERROR_COPY.move_draft_limit);
    h.queue.push({ data: null, error: { message: "under_18" } });
    expect(declutterErrorMessage(await createMoveDrafts("2026-11-14", PLACE, [row()]).catch((e) => e))).toBe(DECLUTTER_ERROR_COPY.under_18);
  });

  it("setMoveOutDate sends the date (or null to end) and returns the count", async () => {
    h.queue.push({ data: 3, error: null }, { data: 0, error: null }, { data: null, error: { message: "invalid_move_out_date" } });
    expect(await setMoveOutDate("2026-11-20")).toBe(3);
    expect(await setMoveOutDate(null)).toBe(0);
    expect(h.rpcs.map((r) => r[1])).toEqual([{ p_move_out_on: "2026-11-20" }, { p_move_out_on: null }]);
    expect(declutterErrorMessage(await setMoveOutDate("2020-01-01").catch((e) => e))).toBe(DECLUTTER_ERROR_COPY.invalid_move_out_date);
  });

  it("reads the seller's own moving-sale items and date, and a seller's sale for the banner", async () => {
    h.queue.push({ data: [{ id: "a" }], error: null });
    expect(await fetchMyMoveItems("me")).toEqual([{ id: "a" }]);
    const mine = h.queries[0];
    expect(mine.table).toBe("declutter_items");
    expect(mine.ops).toContainEqual(["eq", ["seller_id", "me"]]);
    expect(mine.ops).toContainEqual(["eq", ["in_moving_sale", true]]);
    h.queue.push({ data: "2026-11-14", error: null }, { data: null, error: null });
    expect(await fetchMyMoveOutDate()).toBe("2026-11-14");
    expect(await fetchMyMoveOutDate()).toBeNull();

    // The coarse reader first, then the items (RLS).
    h.queue.push({ data: [{ move_out_on: "2026-11-14" }], error: null }, { data: [{ id: "x" }, { id: "y" }], error: null });
    const sale = await fetchSellerMovingSale("seller");
    expect(sale).toMatchObject({ moveOutOn: "2026-11-14", more: false });
    expect(sale?.items).toHaveLength(2);
    expect(h.rpcs[h.rpcs.length - 1]).toEqual(["declutter_seller_moving_sale", { p_seller_id: "seller" }]);
    expect(h.queries[h.queries.length - 1].ops).toContainEqual(["in", ["status", ["live", "reserved"]]]);

    // No sale (none, ended, past, hidden, blocked): no items read at all.
    const before = h.queries.length;
    h.queue.push({ data: [], error: null });
    expect(await fetchSellerMovingSale("nobody")).toBeNull();
    expect(h.queries.length).toBe(before);

    h.queue.push({ data: [{ move_out_on: "2026-10-20" }], error: null }, { data: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })), error: null });
    const big = await fetchSellerMovingSale("busy");
    expect([big?.items.length, big?.more]).toEqual([100, true]);
  });

  it("a refused coarse read surfaces (never 'no sale')", async () => {
    h.queue.push({ data: null, error: { message: "feature_disabled" } });
    expect(declutterErrorMessage(await fetchSellerMovingSale("seller").catch((e) => e))).toBe(DECLUTTER_ERROR_COPY.feature_disabled);
  });

  it("a failed read throws (unwrap), it is never an empty list", async () => {
    h.queue.push({ data: [{ move_out_on: "2026-10-20" }], error: null }, { data: null, error: { message: "boom", code: "42501" } });
    await expect(fetchSellerMovingSale("seller")).rejects.toBeTruthy();
  });
});

describe("scanRoom", () => {
  const file = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], name, { type: "image/jpeg" });

  it("cleans each photo smaller, sends them in the body (never uploads), returns the items", async () => {
    h.clean.mockImplementation(async (f: File) => f);
    h.queue.push({ data: { items: [FOUND] }, error: null });
    expect(await scanRoom([file("a.jpg"), file("b.jpg")])).toEqual([FOUND]);
    expect(h.clean).toHaveBeenCalledTimes(2);
    expect(h.clean.mock.calls[0].slice(1)).toEqual([1280, 0.75]);
    const [fn, opts] = h.invokes[0] as [string, { body: { mode: string; photos: string[] } }];
    expect(fn).toBe("declutter-ai-draft");
    expect(opts.body.mode).toBe("room");
    expect(opts.body.photos).toHaveLength(2);
    expect(opts.body.photos[0]).toBe("/9j/AQID");
  });

  it("refuses 0 or more than 4 photos before sending anything", async () => {
    await expect(scanRoom([])).rejects.toThrow("room_photos_invalid");
    await expect(scanRoom([1, 2, 3, 4, 5].map((n) => file(`${n}.jpg`)))).rejects.toThrow("room_photos_invalid");
    expect(h.invokes).toHaveLength(0);
    expect(declutterErrorMessage(new Error("room_photos_invalid"))).toBe(DECLUTTER_CLIENT_ERROR_COPY.room_photos_invalid);
  });

  it("a 429 is the rate-limit words; a refusal code comes through; anything else is ai_unavailable", async () => {
    h.clean.mockImplementation(async (f: File) => f);
    const ctx = (status: number, body: unknown) => ({ status, json: async () => body });
    h.queue.push({ data: null, error: { context: ctx(429, { error: "Too many requests. Please try again later." }) } });
    expect(declutterErrorMessage(await scanRoom([file("a.jpg")]).catch((e) => e))).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_rate_limited);
    h.queue.push({ data: null, error: { context: ctx(403, { error: "under_18" }) } });
    expect(declutterErrorMessage(await scanRoom([file("a.jpg")]).catch((e) => e))).toBe(DECLUTTER_ERROR_COPY.under_18);
    h.queue.push({ data: null, error: { context: ctx(500, { error: "Something odd" }) } });
    expect((await scanRoom([file("a.jpg")]).catch((e) => e)).message).toBe("ai_unavailable");
    h.queue.push({ data: null, error: { context: { status: 502, json: async () => { throw new Error("not json"); } } } });
    expect((await scanRoom([file("a.jpg")]).catch((e) => e)).message).toBe("ai_unavailable");
  });

  it("an answer with no list is a fault (never 'nothing found'); an empty list is empty", async () => {
    h.clean.mockImplementation(async (f: File) => f);
    h.queue.push({ data: {}, error: null });
    expect((await scanRoom([file("a.jpg")]).catch((e) => e)).message).toBe("ai_unavailable");
    h.queue.push({ data: { items: [] }, error: null });
    expect(await scanRoom([file("a.jpg")])).toEqual([]);
  });
});

describe("publishMany", () => {
  it("lists each item through the one-item calls, in order, reporting progress", async () => {
    const calls: string[] = [];
    h.api.attestItem.mockImplementation(async (id: string) => void calls.push(`attest ${id}`));
    h.api.requestAiCheck.mockImplementation(async (id: string) => void calls.push(`check ${id}`));
    h.api.publishItem.mockImplementation(async (id: string) => {
      calls.push(`publish ${id}`);
      return id === "b" ? "pending_review" : "live";
    });
    const progress: string[] = [];
    let now = 0;
    const out = await publishMany(["a", "b"], (d, t) => progress.push(`${d}/${t}`), async (ms) => void (now += ms), () => now);
    expect(calls).toEqual(["attest a", "check a", "publish a", "attest b", "check b", "publish b"]);
    expect(out).toEqual([{ id: "a", status: "live" }, { id: "b", status: "pending_review" }]);
    expect(progress).toEqual(["1/2", "2/2"]);
  });

  it("spaces the photo checks under the AI per-minute limit", async () => {
    h.api.publishItem.mockResolvedValue("live");
    let now = 0;
    const waits: number[] = [];
    await publishMany(["a", "b", "c"], () => {}, async (ms) => { waits.push(ms); now += ms; }, () => now);
    expect(waits).toEqual([AI_CHECK_GAP_MS, AI_CHECK_GAP_MS]);
    expect(Math.floor(60_000 / AI_CHECK_GAP_MS)).toBeLessThanOrEqual(6);
  });

  it("a failed photo check still publishes (to review, the server's fail-safe); a refused publish is reported, the rest go on", async () => {
    h.api.requestAiCheck.mockRejectedValue(new Error("ai_unavailable"));
    h.api.publishItem.mockImplementation(async (id: string) => {
      if (id === "a") throw Object.assign(new Error("photos_required"), { userMessage: DECLUTTER_ERROR_COPY.photos_required });
      return "pending_review";
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 0;
    const out = await publishMany(["a", "b"], () => {}, async (ms) => void (now += ms), () => now);
    warn.mockRestore();
    expect("error" in out[0] && declutterErrorMessage(out[0].error)).toBe(DECLUTTER_ERROR_COPY.photos_required);
    expect(out[1]).toEqual({ id: "b", status: "pending_review" });
  });
});
