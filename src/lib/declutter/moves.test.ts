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
 * @mutate src/lib/declutter/moves.ts |       floor_price_cents: f.floorPriceCents, |       floor_price_cents: 100,
 * @mutate src/lib/declutter/moves.ts |       if (gap > 0) await wait(gap); |       if (false) await wait(gap);
 * @mutate src/lib/declutter/moves.ts |   if (error) rpcFail(error, rpcErrorMessage("declutter_create_move_drafts", error)); |   if (false) rpcFail(error, rpcErrorMessage("declutter_create_move_drafts", error));
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // The real retry helper calls its own module's requestAiCheck, which this mock cannot reach; mapped here so the
  // order tests read the mocked check (asked twice on a failure, as the helper does).
  requestAiCheckWithRetry: async (id: string) => {
    for (let i = 0; i < 2; i++) {
      try {
        return await h.api.requestAiCheck(id);
      } catch (err) {
        // A failed try is the case under test; the second try or null follows.
        void err;
      }
    }
    return null;
  },
  publishItem: h.api.publishItem,
}));

import {
  AI_CHECK_GAP_MS,
  createMoveDraft,
  daysBetween,
  fetchMyMoveItems,
  fetchMyMoveOutDate,
  formatMoveDate,
  louisianaToday,
  moveDateProblem,
  moveDollarsToCents,
  moveRowProblem,
  publishMany,
  PUBLISH_AT_ONCE,
  setMoveOutDate,
} from "./moves";
import { fetchSellerMovingSale, movingSaleLine } from "./movingSale";
import { declutterErrorMessage, DECLUTTER_ERROR_COPY } from "./errors";

const row = (o: Partial<{ title: string; price: string; floor: string }> = {}) => ({ title: "Oak dresser", price: "80", floor: "", ...o });
const FIELDS = { title: "Oak dresser", description: "Six drawers.", category: "furniture", conditionStars: 4, deliverySize: "large" as const, priceCents: 8000, floorPriceCents: 4000 };
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
});

describe("server calls", () => {
  it("createMoveDraft sends one item with the date and returns its id", async () => {
    h.queue.push({ data: ["a"], error: null });
    expect(await createMoveDraft("2026-11-14", PLACE, FIELDS)).toBe("a");
    expect(h.rpcs[0][0]).toBe("declutter_create_move_drafts");
    expect(h.rpcs[0][1]).toMatchObject({ p_move_out_on: "2026-11-14", p_area_label: "Mid-City", p_pickup_address: "1 Main St", p_pickup_lat: 30.45, p_pickup_lng: -91.15 });
    expect((h.rpcs[0][1] as { p_items: unknown[] }).p_items).toEqual([
      { title: "Oak dresser", description: "Six drawers.", category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 8000, floor_price_cents: 4000 },
    ]);
  });

  it("an answer with no id is a fault, and a refusal surfaces with the plain words (never swallowed)", async () => {
    h.queue.push({ data: [], error: null });
    await expect(createMoveDraft("2026-11-14", PLACE, FIELDS)).rejects.toThrow("invalid_items");
    h.queue.push({ data: null, error: { message: "move_draft_limit" } });
    const err = await createMoveDraft("2026-11-14", PLACE, FIELDS).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(declutterErrorMessage(err)).toBe(DECLUTTER_ERROR_COPY.move_draft_limit);
    h.queue.push({ data: null, error: { message: "under_18" } });
    expect(declutterErrorMessage(await createMoveDraft("2026-11-14", PLACE, FIELDS).catch((e) => e))).toBe(DECLUTTER_ERROR_COPY.under_18);
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

describe("publishMany", () => {
  // lh-silent-failure review of the Q2352 rebase #3: the setup fee is an account refusal; nothing not started yet is tried.
  // @mutate src/lib/declutter/moves.ts |           if (setupFeeRefusal(error)) accountRefusal = { error }; |           void setupFeeRefusal;
  it("stops at the first setup_fee_required_to_list: no item after it is tried, and no photo check is spent", async () => {
    h.api.publishItem.mockRejectedValue(new Error("setup_fee_required_to_list"));
    const checks: string[] = [];
    h.api.requestAiCheck.mockImplementation(async (id: string) => void checks.push(id));
    const progress: string[] = [];
    let now = 0;
    let after: Promise<void> = Promise.resolve();
    const out = await publishMany(["a", "b", "c", "d", "e"], (d, t) => progress.push(`${d}/${t}`), async (ms) => void (now += ms), () => now, (p) => { after = p; });
    await after;
    // The first three start together (PUBLISH_AT_ONCE); the two after them are never tried.
    expect(h.api.publishItem).toHaveBeenCalledTimes(PUBLISH_AT_ONCE);
    expect(checks).toEqual([]);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.every((o) => "error" in o)).toBe(true);
    expect(progress[progress.length - 1]).toBe("5/5");
  });

  // LEAD-BUNCH-34-SLOW (owner 10-31, "very slow to list them after you click post"): a few at once, and Post never
  // waits for the photo check (publish first, as the one-item form, LEAD-POST-SLOW).
  // @mutate src/lib/declutter/moves.ts |   await Promise.all(Array.from({ length: Math.min(PUBLISH_AT_ONCE, itemIds.length) }, worker)); |   await worker();
  // @mutate src/lib/declutter/moves.ts |   afterChecks(checks);\n  return out; |   await checks;\n  afterChecks(checks);\n  return out;
  it("lists PUBLISH_AT_ONCE at a time, each through the one-item calls, and returns before any photo check", async () => {
    expect(PUBLISH_AT_ONCE).toBe(3);
    const calls: string[] = [];
    let open = 0;
    let most = 0;
    h.api.attestItem.mockImplementation(async (id: string) => { open += 1; most = Math.max(most, open); calls.push(`attest ${id}`); await new Promise((r) => setTimeout(r, 5)); });
    // The photo tool is slow: each check answers only when let go. Post must not wait for one.
    const letGo: (() => void)[] = [];
    h.api.requestAiCheck.mockImplementation(async (id: string) => { calls.push(`check ${id}`); await new Promise<void>((r) => letGo.push(r)); });
    h.api.publishItem.mockImplementation(async (id: string) => {
      open -= 1;
      calls.push(`publish ${id}`);
      return id === "b" ? "pending_review" : "live";
    });
    const progress: string[] = [];
    let now = 0;
    let after: Promise<void> = Promise.resolve();
    const out = await publishMany(["a", "b", "c", "d"], (d, t, i) => progress.push(`${d}/${t}#${i}`), async (ms) => void (now += ms), () => now, (p) => { after = p; });
    expect(most).toBe(3);
    // Every item was published before the first check began, and publishMany came back with that check still out.
    expect(calls.findIndex((c) => c.startsWith("check"))).toBeGreaterThan(calls.lastIndexOf("publish d"));
    expect(calls.filter((c) => c.startsWith("check")).length).toBeLessThanOrEqual(1);
    expect(out).toEqual([{ id: "a", status: "live" }, { id: "b", status: "pending_review" }, { id: "c", status: "live" }, { id: "d", status: "live" }]);
    expect(progress.map((p) => p.split("#")[0])).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    expect(progress.map((p) => Number(p.split("#")[1])).sort()).toEqual([0, 1, 2, 3]);
    for (let n = 0; n < 4; n++) {
      await new Promise((r) => setTimeout(r, 0));
      letGo.splice(0).forEach((go) => go());
    }
    await after;
    expect(calls.filter((c) => c.startsWith("check"))).toEqual(["check a", "check b", "check c", "check d"]);
  });

  it("spaces the photo checks under the AI per-minute limit", async () => {
    h.api.publishItem.mockResolvedValue("live");
    let now = 0;
    const waits: number[] = [];
    let after: Promise<void> = Promise.resolve();
    await publishMany(["a", "b", "c"], () => {}, async (ms) => { waits.push(ms); now += ms; }, () => now, (p) => { after = p; });
    await after;
    expect(waits).toEqual([AI_CHECK_GAP_MS, AI_CHECK_GAP_MS]);
    // LEAD-BUNCH-34-SLOW: the gap is the edge function's own per-minute limit, read from its source (12 a minute).
    const edge = readFileSync(resolve(process.cwd(), "supabase/functions/declutter-ai-draft/index.ts"), "utf8");
    const perMinute = Number(/windowMs: 60_000, maxRequests: (\d+), keyPrefix: "declutter-ai-draft"/.exec(edge)?.[1]);
    expect(perMinute).toBe(12);
    expect(Math.ceil(60_000 / AI_CHECK_GAP_MS)).toBeLessThanOrEqual(perMinute);
  });

  it("a failed photo check never stops a listing (the server's fail-safe); a refused publish is reported, the rest go on", async () => {
    h.api.requestAiCheck.mockRejectedValue(new Error("ai_unavailable"));
    h.api.publishItem.mockImplementation(async (id: string) => {
      if (id === "a") throw Object.assign(new Error("photos_required"), { userMessage: DECLUTTER_ERROR_COPY.photos_required });
      return "pending_review";
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 0;
    let after: Promise<void> = Promise.resolve();
    const out = await publishMany(["a", "b"], () => {}, async (ms) => void (now += ms), () => now, (p) => { after = p; });
    await after;
    warn.mockRestore();
    expect("error" in out[0] && declutterErrorMessage(out[0].error)).toBe(DECLUTTER_ERROR_COPY.photos_required);
    expect(out[1]).toEqual({ id: "b", status: "pending_review" });
  });
});
