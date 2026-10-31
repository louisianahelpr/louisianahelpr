/**
 * POST-DROPFLAG: a listing whose seller stopped price drops says nothing about a
 * coming drop, at once. Buyers couldn't read the stop (declutter_item_private), so
 * the line stayed until the next sweep passed the listing over. The server half
 * is proved in src/test/pglite/declutterDropsStoppedPublic.pglite.mjs.
 *
 * @mutate src/lib/declutter/priceDrop.ts |   if (item.drops_stopped === true) return null; |
 * @mutate src/lib/declutter/api.ts | drop_pct: r.drop_pct, drops_stopped: r.drops_stopped }); | drop_pct: r.drop_pct });
 * @mutate src/lib/declutter/api.ts | const DROP_COLUMNS = "sale_mode, last_price_drop_on, drop_pct, drops_stopped"; | const DROP_COLUMNS = "sale_mode, last_price_drop_on, drop_pct";
 * @mutate src/lib/declutter/api.ts | if (first.error?.code === "42703" && first.error.message.includes("drops_stopped")) return readDropColumnsBeforeStopped(run, extra); |
 * @mutate src/lib/declutter/api.ts | if (second.error?.code === "42703" && second.error.message.includes("drop_pct")) return unwrap(await run(extra + DROP_COLUMNS_BEFORE_PCT)); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const selects: string[] = [];
  const builder = () => {
    const b: Record<string, unknown> = {};
    b.select = (cols: string) => { selects.push(cols); return b; };
    b.in = () => b;
    b.eq = () => b;
    b.maybeSingle = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: null, error: null }).then(res);
    return b;
  };
  return { queue, selects, supabase: { from: () => builder() } };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import { fetchDropStates, fetchItemDropState } from "./api";
import { dropOutlook } from "./browseFilters";

const missing = (column: string) => ({ data: null, error: { code: "42703", message: `column declutter_items.${column} does not exist` } });

beforeEach(() => {
  h.queue.length = 0;
  h.selects.length = 0;
});

describe("Browse's drop states carry the stop", () => {
  it("asks for the column and hands it on", async () => {
    h.queue.push({ data: [{ id: "a", sale_mode: "offers", last_price_drop_on: null, drop_pct: 5, drops_stopped: true }], error: null });
    const rows = await fetchDropStates(["a"]);
    expect(h.selects).toHaveLength(1);
    expect(h.selects[0]).toContain("drops_stopped");
    expect(rows.get("a")?.drops_stopped).toBe(true);
  });

  it("the item page's read asks for it too", async () => {
    h.queue.push({ data: { sale_mode: "offers", last_price_drop_on: null, drop_pct: 5, drops_stopped: true }, error: null });
    expect((await fetchItemDropState("a"))?.drops_stopped).toBe(true);
    expect(h.selects[0]).toContain("drops_stopped");
  });

  it("deploy window: the column missing reads again without it, keeping the step", async () => {
    h.queue.push(missing("drops_stopped"), { data: { sale_mode: "offers", last_price_drop_on: null, drop_pct: 10 }, error: null });
    const row = await fetchItemDropState("a");
    expect(row?.drop_pct).toBe(10);
    expect(row?.drops_stopped).toBeUndefined();
    expect(h.selects).toHaveLength(2);
    expect(h.selects[1]).toContain("drop_pct");
    expect(h.selects[1]).not.toContain("drops_stopped");
  });

  it("deploy window: both missing reads a third time without either", async () => {
    h.queue.push(missing("drops_stopped"), missing("drop_pct"), { data: { sale_mode: "offers", last_price_drop_on: null }, error: null });
    expect((await fetchItemDropState("a"))?.sale_mode).toBe("offers");
    expect(h.selects).toHaveLength(3);
    expect(h.selects[2]).not.toContain("drop_pct");
  });

  it("any other refusal is thrown, never read as no stop", async () => {
    h.queue.push({ data: null, error: { code: "42501", message: "permission denied for column drops_stopped" } });
    await expect(fetchItemDropState("a")).rejects.toBeTruthy();
    expect(h.selects).toHaveLength(1);
  });
});

describe("a stopped listing shows no coming drop", () => {
  const NOW = new Date("2026-10-20T15:00:00Z");
  const item = {
    status: "live", category: "other", condition_stars: 4, current_price_cents: 4000, porch_ok: true,
    live_at: "2026-10-10T14:00:00Z", created_at: "2026-10-10T14:00:00Z",
  };
  // It dropped at the last run: without the flag the client has no reason yet to think it stopped (the bug).
  const state = { sale_mode: "offers", last_price_drop_on: "2026-10-19", drop_pct: 5 };

  it("the tag and the filter leave it out", () => {
    expect(dropOutlook(item, { ...state, drops_stopped: true }, NOW)).toEqual({ planned: false, tonight: false });
  });

  it("a listing still dropping keeps them", () => {
    expect(dropOutlook(item, { ...state, drops_stopped: false }, NOW).planned).toBe(true);
    expect(dropOutlook(item, state, NOW).planned).toBe(true);
  });
});
