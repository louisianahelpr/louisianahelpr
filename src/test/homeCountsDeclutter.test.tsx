/**
 * A3-81 (audit 11-01, HIGH): Home's Next up / To do and every nav badge left out Declutter. A seller with a $30 offer
 * waiting on her answer (20 h left) and a buyer with an item in the cart (20.5 h to check out) were both told "You're
 * all caught up". Home's list now takes the Declutter Buying / Selling sources (cart + offers, the same reads and the
 * same rules as the tab badges, src/lib/declutter/tabs.ts) and the bridge publishes their count to the navs.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   for (const d of declutterTodos(i.declutterCart ?? [], i.declutterOffers ?? [], now, i.declutterRefunds ?? [], i.declutterFreeAsks ?? [])) { |   for (const d of declutterTodos([], [], now, i.declutterRefunds ?? [], i.declutterFreeAsks ?? [])) {
 *
 * The remainder (B124): (a) a refund request waiting on the member (the seller's answer, due by answer_by; or the
 * buyer's answer to a part offer), from the new member-wide read declutter_my_refund_todos (20261102002217); (b) the
 * free giver's "Pick who gets <item>", with how many asked.
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   for (const d of declutterTodos(i.declutterCart ?? [], i.declutterOffers ?? [], now, i.declutterRefunds ?? [], i.declutterFreeAsks ?? [])) { |   for (const d of declutterTodos(i.declutterCart ?? [], i.declutterOffers ?? [], now)) {
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     if (!Number.isFinite(due) \|\| due < now) continue;\n    const seller = r.my_side === "seller"; |     const seller = r.my_side === "seller";
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         meta: `${seller ? "Selling" : "Buying"} · ${what} · by ${byWhen(due)}`, |         meta: `${seller ? "Selling" : "Buying"} · ${what}`,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         meta: `Free · ${f.asked} asked`, |         meta: "Free",
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     if (f.asked < 1) continue; |     continue;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     if (o.status !== "open" \|\| o.awaiting !== o.my_side) continue; |     if (o.status !== "open") continue;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |     if (l.my_side !== "buyer" \|\| l.status !== "in_cart" \|\| !(Date.parse(l.checkout_by) > now)) continue; |     if (l.my_side !== "buyer" \|\| l.status !== "in_cart") continue;
 * @mutate src/components/NeedsYouBridge.tsx |   const declutter = todos.filter((t) => t.section === "declutter").length; |   const declutter = 0;
 * @mutate src/components/DesktopSidebarNav.tsx |     if (key === "todoDeclutter") return todo.declutter; |     if (key === "todoDeclutter") return 0;
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ShopOrder } from "@/lib/shops/orders";
import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { blankComments } from "./helpers/blankNonCode";

// Sun Nov 1 2026, 10:00 AM in Louisiana (16:00Z).
const NOW = Date.parse("2026-11-01T16:00:00Z");
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const none = { postedJobs: [] as Job[], pendingApplicantCounts: {} as Record<string, number>, appliedApps: [] as AppliedApp[], shopOrders: [] as ShopOrder[], backout: new Map() };

const offer = (over: Partial<MyOffer>): MyOffer => ({
  offer_id: "o1", item_id: "i1", item_title: "Oak rocking chair", my_side: "seller", amount_cents: 3000, awaiting: "seller", status: "open",
  respond_by: inHours(20), counter_count: 0, current_price_cents: 4000, floor_price_cents: null, updated_at: inHours(-1), ...over,
});
const line = (over: Partial<CartLine>): CartLine => ({
  line_id: "l1", item_id: "i2", item_title: "Box of kids books", my_side: "buyer", seller_id: "s1", price_cents: 800, status: "in_cart",
  checkout_by: inHours(20.5), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true, ...over,
});

const refund = (over: Partial<MyRefundTodo>): MyRefundTodo => ({
  request_id: "r1", order_id: "ord9", my_side: "seller", status: "open", due_at: inHours(20), title: "Oak rocking chair", item_count: 1, ...over,
});
const ask = (over: Partial<FreeAskToPick>): FreeAskToPick => ({ item_id: "f1", title: "Patio chairs", asked: 3, first_at: inHours(-2), ...over });

describe("Home counts Declutter (A3-81)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("the audit's seller: a $30 offer due in 20 h is a to-do with its deadline, ranked under 24 h", () => {
    const todos = deriveNeedsYouTodos({ ...none, declutterOffers: [offer({})] }, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ section: "declutter", title: "Answer a $30 offer", action: "Answer offer", to: "/declutter?tab=selling" });
    // The amount is in the task: no money line repeats it as an "order total".
    expect(todos[0].money).toBeUndefined();
    expect(todos[0].meta).toMatch(/^Selling · Oak rocking chair · by Mon /);
  });

  it("the audit's buyer: a cart checkout due in 20.5 h is a to-do (one per seller), with its deadline", () => {
    const todos = deriveNeedsYouTodos({ ...none, declutterCart: [line({}), line({ line_id: "l2", item_title: "Lamp" })] }, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ section: "declutter", title: "Check out 2 items", action: "Check out", to: "/declutter?tab=buying" });
    expect(todos[0].meta).toMatch(/^Buying · by Mon /);
  });

  it("only what is the member's move: an offer awaiting the other side, an expired checkout and a Helpr delivery are not to-dos", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      declutterOffers: [offer({ awaiting: "buyer" }), offer({ offer_id: "o2", status: "accepted" })],
      declutterCart: [
        line({ checkout_by: inHours(-1) }),
        line({ line_id: "l3", my_side: "seller" }),
        line({ line_id: "l4", status: "paid", order_id: "ord1", order_status: "paid", handover: "delivery" }),
      ],
    }, NOW);
    expect(todos).toEqual([]);
  });

  it("a paid pickup still in its handover is a to-do for each side", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      declutterCart: [
        line({ status: "paid", order_id: "ord1", order_status: "paid", handover: "porch" }),
        line({ line_id: "l5", my_side: "seller", item_title: "Desk", status: "paid", order_id: "ord2", order_status: "paid", handover: "pickup" }),
      ],
    }, NOW);
    expect(todos.map((t) => t.title).sort()).toEqual(["Hand over Desk", "Pick up Box of kids books"]);
  });

  it("(a) a refund request waiting on the seller is a to-do with its answer-by deadline, under 24 h", () => {
    const todos = deriveNeedsYouTodos({ ...none, declutterRefunds: [refund({})] }, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ section: "declutter", title: "Answer a refund request", action: "Answer request", to: "/declutter?tab=selling" });
    // 16:00Z + 20 h = Mon 12:00Z = 6:00 AM in Louisiana (CST from Nov 1).
    expect(todos[0].meta).toBe("Selling · Oak rocking chair · by Mon 6:00 AM");
  });

  it("(a) the buyer's answer to the seller's part offer is a to-do; a lapsed request is not", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      declutterRefunds: [
        refund({ request_id: "r2", my_side: "buyer", status: "offered", due_at: inHours(5), title: "Lamp", item_count: 3 }),
        refund({ request_id: "r3", due_at: inHours(-0.1) }),
      ],
    }, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ title: "Answer the seller's refund offer", to: "/declutter?tab=buying" });
    expect(todos[0].meta).toMatch(/^Buying · Lamp \+ 2 more · by Sun /);
  });

  it("(a) a refund answer due sooner ranks ahead of a free pick and a later offer", () => {
    const todos = deriveNeedsYouTodos({ ...none, declutterRefunds: [refund({ due_at: inHours(3) })], declutterOffers: [offer({})], declutterFreeAsks: [ask({})] }, NOW);
    expect(todos.map((t) => t.title)).toEqual(["Answer a refund request", "Answer a $30 offer", "Pick who gets Patio chairs"]);
  });

  it("(b) the free giver's pick is a to-do with how many asked; a listing with no asks is not", () => {
    const todos = deriveNeedsYouTodos({ ...none, declutterFreeAsks: [ask({}), ask({ item_id: "f2", title: "Rug", asked: 0 })] }, NOW);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ section: "declutter", title: "Pick who gets Patio chairs", meta: "Free · 3 asked", action: "Pick", to: "/declutter/item/f1" });
  });

  it("the badges count them: the bridge publishes a declutter share and the sidebar's Declutter row reads it", () => {
    const root = resolve(__dirname, "../..");
    const bridge = blankComments(readFileSync(resolve(root, "src/components/NeedsYouBridge.tsx"), "utf8"));
    expect(bridge).toContain('const declutter = todos.filter((t) => t.section === "declutter").length;');
    expect(bridge).toContain("total: jobs + shops + declutter");
    const rail = blankComments(readFileSync(resolve(root, "src/components/DesktopSidebarNav.tsx"), "utf8"));
    expect(rail).toContain('sec.key === "declutter" ? ("todoDeclutter" as const)');
    expect(rail).toContain('if (key === "todoDeclutter") return todo.declutter;');
  });
});
