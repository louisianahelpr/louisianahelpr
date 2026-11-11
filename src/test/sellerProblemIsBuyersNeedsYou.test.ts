/**
 * F363 side effect (b) (owner pop-up 11-11 morning): "a seller-reported problem moves the order into Needs you for the
 * buyer". Since F363 option (b), the Buying "Needs you" group is exactly the Home To-do Buying rows. No row stood for
 * a seller's problem report, so an order whose ruled bucket was Needs you (orderBucket: the problem awaits the buyer)
 * fell to Waiting. Now a seller's open report on a live purchase, with the buyer's side still missing, is a Home To-do
 * Buying row (dp-<order>). It is that order's ONE row, ahead of a refund offer or the handover. Home, the badges and the
 * chip count it once and agree. Once the buyer has added their side, or when the buyer reported it, it is Waiting
 * (buyingOrders.test.tsx openpr-2).
 *
 * Every reporter x order status x other moves on the order is built here.
 *
 * @mutate src/lib/declutter/declutterTodos.ts |     if (!l \|\| p.reporter_side !== "seller" \|\| !p.awaits_buyer \|\| ordersWithRow.has(p.order_id)) continue; |     continue;
 * @mutate src/lib/declutter/declutterTodos.ts | p.reporter_side !== "seller" \|\| !p.awaits_buyer \|\| | p.reporter_side !== "seller" \|\|
 * @mutate src/lib/declutter/declutterTodos.ts |     if (ordersWithRow.has(r.order_id)) continue;\n | \n
 * @mutate src/components/declutter/BuyingOrders.tsx | r.id.startsWith("dh-") \|\| r.id.startsWith("dp-") ? r.id.slice(3) | r.id.startsWith("dh-") ? r.id.slice(3)
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | declutterFreeAsks: freeAskRows, declutterProblems: problemRows, continueDays | declutterFreeAsks: freeAskRows, continueDays
 * @mutate src/components/declutter/BuyingOrders.tsx | refundRows, Date.now(), homeProblems); | refundRows, Date.now());
 * @mutate src/pages/home/homeDashboard/useNeedsYouTodos.ts | return !!d && d.status === "open" && !d.other_side_note; | return !!d;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { declutterBuyingTodos, declutterTodos, type TodoProblem } from "@/lib/declutter/declutterTodos";
import { buyerProblemOrderIds, isDeclutterBuyingTodo } from "@/lib/declutter/buyingTodo";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import type { CartLine } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import type { OpenProblem } from "@/lib/declutter/handover";
import { blankComments } from "./helpers/blankNonCode";

const NOW = Date.UTC(2026, 10, 11, 15, 0, 0);
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const line = (over: Partial<CartLine>): CartLine => ({
  line_id: "l1", item_id: "i1", item_title: "Brass lamp", my_side: "buyer", seller_id: "s1", price_cents: 800, status: "paid",
  checkout_by: inHours(20), order_id: "ord1", order_status: "paid", handover: "pickup_home", premium_cents: null, total_cents: 800,
  porch_ok: true, ...over,
}) as CartLine;
const refund: MyRefundTodo = { request_id: "r1", order_id: "ord1", my_side: "buyer", status: "offered", due_at: inHours(10), title: "Brass lamp", item_count: 1 };
const problem = (reporter_side: OpenProblem["reporter_side"], awaits_buyer = true): TodoProblem => ({ order_id: "ord1", reporter_side, awaits_buyer });

const read = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("F363 (owner 11-11): a seller's problem report puts the purchase under Needs you", () => {
  it("every reporter x order status x other moves: a dp row exactly for a seller's report on a live purchase, once per order", () => {
    let combos = 0;
    for (const reporter of ["seller", "buyer", "helpr", "system"] as const) {
      for (const order_status of ["paid", "handed_over", "cancelled", "refunded"]) {
        for (const withRefund of [false, true]) {
         for (const awaits of [true, false]) {
          const cart = [line({ order_status })];
          const refunds = withRefund ? [refund] : [];
          const problems = [problem(reporter, awaits)];
          const rows = declutterTodos(cart, [], NOW, refunds, [], problems).map((r) => r.item);
          const label = `${reporter} ${order_status} refund=${withRefund} awaits=${awaits}`;
          const expectDp = awaits && reporter === "seller" && (order_status === "paid" || order_status === "handed_over");
          expect(rows.some((r) => r.id === "dp-ord1"), label).toBe(expectDp);
          const aboutOrd1 = rows.filter((r) => r.id === "dp-ord1" || r.id === "dh-ord1" || r.id === "dr-r1");
          expect(aboutOrd1.length, `${label}: at most one row for the order`).toBeLessThanOrEqual(1);
          if (expectDp) {
            const dp = rows.find((r) => r.id === "dp-ord1")!;
            expect(isDeclutterBuyingTodo(dp), `${label}: a Buying row`).toBe(true);
          }
          // Home's To-do Buying rows == the chip's rows (BuyingOrders reads declutterBuyingTodos with the same problems).
          const home = deriveNeedsYouTodos({
            postedJobs: [], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map(),
            declutterCart: cart, declutterRefunds: refunds, declutterProblems: problems,
          }, NOW).filter(isDeclutterBuyingTodo);
          expect(home.map((t) => t.id), label).toEqual(declutterBuyingTodos(cart, [], refunds, NOW, problems).map((t) => t.id));
          combos++;
         }
        }
      }
    }
    expect(combos).toBeGreaterThan(40);
  });

  it("the seller's own sale is never a buyer's problem row", () => {
    const rows = declutterTodos([line({ my_side: "seller" })], [], NOW, [], [], [problem("seller")]).map((r) => r.item.id);
    expect(rows).not.toContain("dp-ord1");
  });

  it("Home and the Buying tab ask the same purchases (one rule, one key) and both pass the problems in", () => {
    expect(buyerProblemOrderIds([line({ order_id: "b" }), line({ order_id: "a" }), line({ order_id: "c", order_status: "cancelled" }), line({ order_id: "d", my_side: "seller" })]))
      .toEqual(["a", "b"]);
    const hook = read("src/pages/home/homeDashboard/useNeedsYouTodos.ts");
    expect(hook).toMatch(/const problemIds = useMemo\(\(\) => buyerProblemOrderIds\(cartLines\), \[cartLines\]\);/);
    expect(hook).toMatch(/queryKey: \["declutter", "problems", problemIds\.join\(","\)\]/);
    expect(hook).toMatch(/declutterProblems: problemRows/);
    // Whether the buyer's side is missing: the problem's own read, under the order card's key, the same test as the tab.
    expect(hook).toMatch(/queryKey: \["declutter", "problem", p\.order_id\]/);
    expect(hook).toMatch(/d\.status === "open" && !d\.other_side_note/);
    const tab = read("src/components/declutter/BuyingOrders.tsx");
    expect(tab).toMatch(/queryKey: \["declutter", "problem", id\]/);
    expect(tab).toMatch(/awaits_buyer: problemAwaitsBuyer\(/);
    expect(tab).toMatch(/return !!p && p\.status === "open" && p\.reporter_side !== "buyer" && !p\.other_side_note;/);
    expect(tab).toMatch(/declutterBuyingTodos\(lines, myOffers\.data \?\? \[\], refundRows, Date\.now\(\), homeProblems\)/);
    expect(tab).toMatch(/r\.id\.startsWith\("dp-"\)/);
  });
});
