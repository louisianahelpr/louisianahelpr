/**
 * Home's Coming up is ONE agenda from every section and both sides (spec v2
 * §5.4, board 7): jobs I hired for or am working, Declutter pickups I am
 * buying or selling (the BOOKED slot), and Shops orders I placed or my shop
 * must fill (the accepted order's ready day). Real rule, no mocks: nothing
 * without a real date shows, and the rows sort by when.
 *
 * @mutate src/pages/home/homeDashboard/comingUp.ts |     if (!at \|\| Number.isNaN(at.getTime())) continue; |     if (!at \|\| Number.isNaN(at.getTime())) { rows.push({ id: `d-${orderId}`, section: "declutter", role: "buying", title: "x", at: now, day: "", time: null, to: "" }); continue; }
 * @mutate src/pages/home/homeDashboard/comingUp.ts |     if (l.status !== "paid" \|\| !l.order_id \|\| l.order_status === "handed_over" \|\| l.handover === "delivery") continue; |     if (l.status !== "paid" \|\| !l.order_id) continue;
 * @mutate src/pages/home/homeDashboard/comingUp.ts |     const buyer = lines[0].my_side === "buyer"; |     const buyer = true;
 * @mutate src/pages/home/homeDashboard/comingUp.ts |     if (o.status !== "accepted" \|\| !/^\d{4}-\d{2}-\d{2}$/.test(o.ready_date ?? "")) return null; |     if (!/^\d{4}-\d{2}-\d{2}$/.test(o.ready_date ?? "")) return null;
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   return rows.filter((r) => r.at >= from).sort((x, y) => x.at - y.at); |   return rows.filter((r) => r.at >= from);
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   for (const o of i.shopOrders) { const r = shopRow(o, "shop"); if (r) rows.push(r); } |   void shopRow;
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   if (days > 1 && days < 7) return day.toLocaleDateString("en-US", { weekday: "short" }); |   if (days > 1 && days < 8) return day.toLocaleDateString("en-US", { weekday: "short" });
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |       cart: (declutterOn ? cart.data : undefined) ?? [], |       cart: [],
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { deriveComingUp, COMING_UP_ROLE } from "@/pages/home/homeDashboard/comingUp";

type ComingUpInputs = Parameters<typeof deriveComingUp>[0];
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { CartLine } from "@/lib/declutter/api";
import type { ShopOrder } from "@/lib/shops/orders";

// Noon on Tue Oct 20 2026, device time; every row below is later this week.
const NOW = new Date(2020, 9, 20, 12, 0, 0).getTime(); // 2020: Oct 20 2020 is a Tuesday like Oct 20 2026, so every weekday label holds; a past literal never ages (jobDayFixtureTimezone).
const iso = (d: number, h: number, m = 0) => new Date(2020, 9, d, h, m).toISOString();

const job = (over: Partial<Job>): Job =>
  ({
    id: "j", title: "Mow the lawn", status: "accepted", payment_status: "escrow", helper_id: "h", customer_id: "me",
    date_needed: "2020-10-23", start_time: "14:00:00", updated_at: "2020-10-01T00:00:00Z", helper_confirmed_at: "2020-10-02T00:00:00Z", ...over,
  }) as Job;
const line = (over: Partial<CartLine>): CartLine =>
  ({
    line_id: "l", item_id: "i", item_title: "Oak rocking chair", my_side: "buyer", seller_id: "s", price_cents: 4000,
    status: "paid", checkout_by: iso(20, 0), order_id: "o1", order_status: "paid", handover: "pickup_home",
    premium_cents: 0, total_cents: 4270, porch_ok: true, ...over,
  }) as CartLine;
const order = (over: Partial<ShopOrder>): ShopOrder =>
  ({
    id: "so", buyer_id: "me", seller_id: "s", shop_id: "sh", status: "accepted", close_reason: null, ready_date: "2020-10-22",
    items_cents: 1200, total_cents: 1300, shop_order_lines: [{ id: "x", item_id: "y", title: "Pecan pralines", kind: "product", unit_cents: 600, quantity: 2, line_cents: 1200 }],
    ...over,
  }) as ShopOrder;
const none: ComingUpInputs = { postedJobs: [], appliedApps: [], cart: [], bookings: [], myOrders: [], shopOrders: [] };

describe("Coming up mixes every section and both sides (spec v2 §5.4)", () => {
  // The job buckets read the clock (an overdue booking is a to-do, not Coming up).
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("is not vacuous: every role has a caption, and the hook feeds the Declutter and Shops reads in", () => {
    expect(Object.keys(COMING_UP_ROLE).length).toBeGreaterThan(5);
    const hook = blankComments(readFileSync(resolve(__dirname, "../pages/home/homeDashboard/useHomeSummary.ts"), "utf8"));
    expect(hook).toMatch(/cart: \(declutterOn \? cart\.data : undefined\) \?\? \[\]/);
    expect(hook).toMatch(/bookings: bookings\.data \?\? \[\]/);
    expect(hook).toMatch(/myOrders: \(shopsOn \? orders\.data : undefined\) \?\? \[\]/);
    expect(hook).toMatch(/shopOrders: \(shopsOn \? shopOrders\.data : undefined\) \?\? \[\]/);
  });

  it("a booked Declutter pickup shows for the buyer and the seller, with the slot's own day and time", () => {
    const rows = deriveComingUp({
      ...none,
      cart: [line({ order_id: "o1" }), line({ order_id: "o2", line_id: "l2", my_side: "seller", item_title: "Brass lamp", handover: "porch" })],
      bookings: [
        { order_id: "o1", slot_start: iso(21, 18), slot_end: iso(21, 18, 30), porch_mode: null, porch_until: null },
        { order_id: "o2", slot_start: iso(22, 9), slot_end: iso(22, 9, 30), porch_mode: "all_day", porch_until: null },
      ],
    }, NOW);
    expect(rows.map((r) => [r.section, r.role, r.title, r.to])).toEqual([
      ["declutter", "buying", "Pick up Oak rocking chair", "/declutter?tab=buying"],
      ["declutter", "selling", "Put out Brass lamp", "/declutter?tab=selling"],
    ]);
    expect(rows[0].day).toBe("Tomorrow");
    expect(rows[0].time).toBe("6:00 PM");
    expect(COMING_UP_ROLE[rows[0].role]).toBe("You're buying");
  });

  it("no booked slot, a Helpr delivery, or a finished handover: no Declutter row (nothing guessed)", () => {
    const rows = deriveComingUp({
      ...none,
      cart: [
        line({ order_id: "unbooked" }),
        line({ order_id: "delivery", handover: "delivery" }),
        line({ order_id: "done", order_status: "handed_over" }),
        line({ order_id: "unpaid", status: "in_cart" }),
      ],
      bookings: [
        { order_id: "delivery", slot_start: iso(21, 10), slot_end: null, porch_mode: null, porch_until: null },
        { order_id: "done", slot_start: iso(21, 10), slot_end: null, porch_mode: null, porch_until: null },
        { order_id: "unpaid", slot_start: iso(21, 10), slot_end: null, porch_mode: null, porch_until: null },
      ],
    }, NOW);
    expect(rows).toEqual([]);
  });

  it("a several-item order is one row", () => {
    const rows = deriveComingUp({
      ...none,
      cart: [line({ line_id: "a" }), line({ line_id: "b", item_title: "Side table" }), line({ line_id: "c", item_title: "Rug" })],
      bookings: [{ order_id: "o1", slot_start: iso(21, 18), slot_end: null, porch_mode: null, porch_until: null }],
    }, NOW);
    expect(rows.map((r) => r.title)).toEqual(["Pick up Oak rocking chair + 2 more"]);
  });

  it("shop orders: accepted ones on their ready day, from both sides; a held order is not booked yet", () => {
    const rows = deriveComingUp({
      ...none,
      myOrders: [order({ id: "mine" }), order({ id: "held", status: "held" })],
      shopOrders: [order({ id: "fill", buyer_id: "b", seller_id: "me", ready_date: "2020-10-24" })],
    }, NOW);
    expect(rows.map((r) => [r.id, r.role, r.title, r.day, r.time, r.to])).toEqual([
      ["o-mine", "ordered", "Pick up Pecan pralines", "Thu", null, "/shops/orders"],
      ["s-fill", "shop", "Get Pecan pralines ready", "Sat", null, "/shops/dashboard"],
    ]);
  });

  it("everything sorts into one agenda by when, and yesterday drops off", () => {
    const rows = deriveComingUp({
      ...none,
      postedJobs: [job({ id: "sat", title: "Assemble a bookshelf", date_needed: "2020-10-24", start_time: "13:00:00" })],
      cart: [line({})],
      bookings: [{ order_id: "o1", slot_start: iso(21, 18), slot_end: null, porch_mode: null, porch_until: null }],
      myOrders: [order({ id: "thu" }), order({ id: "old", ready_date: "2020-10-19" })],
    }, NOW);
    expect(rows.map((r) => r.id)).toEqual(["d-o1", "o-thu", "p-sat"]);
    expect(rows[2].role).toBe("posted");
    expect(rows[2].to).toBe("/jobs/sat");
  });

  it("the day reads as boards 7 and 11 do: Today, Tomorrow, the weekday this week, then the date", () => {
    const at = (d: number, mo = 9) => ({ order_id: `o${mo}-${d}`, slot_start: new Date(2020, mo, d, 18).toISOString(), slot_end: null, porch_mode: null, porch_until: null });
    const days = [20, 21, 26, 27].map((d) => at(d)).concat([at(1, 10)]);
    const rows = deriveComingUp({
      ...none,
      cart: days.map((b, n) => line({ line_id: `l${n}`, order_id: b.order_id })),
      bookings: days,
    }, NOW);
    expect(rows.map((r) => `${r.day} ${r.time}`)).toEqual(["Today 6:00 PM", "Tomorrow 6:00 PM", "Mon 6:00 PM", "Tue, Oct 27 6:00 PM", "Sun, Nov 1 6:00 PM"]);
  });

  it("the Helpr's side of a job: an accepted application on a hired job", () => {
    const app = { id: "a1", helper_id: "me", status: "accepted", job: job({ id: "w1", helper_id: "me", customer_id: "p" }) } as unknown as AppliedApp;
    const rows = deriveComingUp({ ...none, appliedApps: [app] }, NOW);
    expect(rows.map((r) => [r.id, r.role])).toEqual([["a-a1", "working"]]);
  });
});
