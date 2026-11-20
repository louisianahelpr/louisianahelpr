/**
 * Declutter top 5 #2 (owner 11-19): the Selling home. Server behaviour: src/test/pglite/declutterSellingHome.pglite.mjs
 * (12 PASS applied 3x; NEW_MIGRATION=skip RED; a planted body that counts refunded orders as sales 1 FAIL). Here: the
 * newest definition keeps the rules, and the card draws the to-dos and honest week-on-week words.
 *
 * @mutate supabase/migrations/20261120121830_declutter_views_coalesce_uuid.sql |      AND o.status IN ('paid', 'handed_over') |      AND true
 * @mutate src/lib/declutter/sellerTools.ts |   if (last === 0) return { dir: "new", pct: 0 }; |   if (last === 0) return { dir: "up", pct: 100 };
 * @mutate src/components/declutter/SellingHome.tsx |   return rows.filter((r) => r.n > 0 && !(away && NOT_WHILE_AWAY.has(r.key))); |   return rows;
 *
 * Post-merge check 11-20 (~/.lh-shots/declutter-top5-1120): #6 the to-do, the Pickups chip and the Sold heading read
 * ONE count of sales to hand over (on-hold sales left out); #9 while away nothing nudges a price or an offer; #1 the
 * row's label fills it so the chevron sits at the right edge; #5 only the to-dos sit at the top of Selling.
 * @mutate src/components/declutter/SellingHome.tsx | const NOT_WHILE_AWAY = new Set(["savers", "drops", "relist"]); | const NOT_WHILE_AWAY = new Set(["relist"]);
 * @mutate src/components/declutter/SellingHome.tsx |     { key: "handover", n: handOver ?? todo?.salesOpen ?? 0, | { key: "handover", n: todo?.salesOpen ?? 0,
 * @mutate src/components/declutter/useSalesToHandOver.ts |   return Math.max(0, declutterTodo(lines, []).salesOpen - held); |   return declutterTodo(lines, []).salesOpen;
 * @mutate src/components/declutter/SellingHome.tsx | <span className="min-w-0 flex-1" data-selling-todo-label=""> | <span className="min-w-0" data-selling-todo-label="">
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {only === null && hasListings && <SellingTodo | {only === null && hasListings && <SellingWeek />}{only === null && hasListings && <SellingTodo
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { weekChange } from "@/lib/declutter/sellerTools";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { salesToHandOver } from "./useSalesToHandOver";

const home = {
  week: { sales: 2, earnings_cents: 6500, views: 30, saves: 0 },
  last_week: { sales: 1, earnings_cents: 6500, views: 40, saves: 0 },
  todo: { to_relist: 1, price_drops: 2, savers_to_offer: 0 },
  live_count: 3,
  live_value_cents: 5100,
};
const awayState = vi.hoisted(() => ({ away: null as null | { back_on: string } }));
vi.mock("@/lib/declutter/api", () => ({ fetchSellingHome: async () => home, fetchMyAway: async () => awayState.away }));

import { SellingTodo, SellingWeek, sellingTodoRows } from "./SellingHome";

const SellingHome = ({ todo, userId, onPick, handOver = null }: { todo: never; userId: string; onPick: (g: string) => void; handOver?: number | null }) => (
  <><SellingTodo todo={todo} handOver={handOver} userId={userId} onPick={onPick} /><SellingWeek /></>
);

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("Declutter top 5 #2: Selling home", () => {
  it("the newest declutter_selling_home: own selling only, real sales only, the nudge's own price-drop rule", () => {
    const d = newestFunction("declutter_selling_home");
    expect(d.file).toContain("20261120121830"); // restated by the uuid views count fix (42804)
    const b = flat(d.body);
    for (const part of [
      "WHERE o.seller_id = v_uid AND o.status IN ('paid', 'handed_over')",
      "WHERE i.seller_id = v_uid AND w.user_id <> v_uid",
      "AND i.live_at + interval '14 days' <= v_now AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))",
      "WHERE s.item_id = i.id AND s.created_at > v_now - interval '24 hours'",
    ]) expect(b, part).toContain(part);
  });

  it("week-on-week words never invent a percent from zero", () => {
    expect(weekChange(2, 1)).toEqual({ dir: "up", pct: 100 });
    expect(weekChange(30, 40)).toEqual({ dir: "down", pct: 25 });
    expect(weekChange(5, 0)).toEqual({ dir: "new", pct: 0 });
    expect(weekChange(0, 0)).toEqual({ dir: "same", pct: 0 });
  });

  it("to-dos in the order to do them, empty ones left out", () => {
    const rows = sellingTodoRows({ sellerOffers: 2, salesOpen: 1 }, home);
    expect(rows.map((r) => [r.key, r.n])).toEqual([["handover", 1], ["offers", 2], ["drops", 2], ["relist", 1]]);
    expect(sellingTodoRows(null, null)).toEqual([]);
  });

  it("11-20 #9: while away only the sales and offers are to-dos; no price nudge, no saver offer, no put back up", () => {
    const busy = { todo: { to_relist: 1, price_drops: 2, savers_to_offer: 3 } };
    expect(sellingTodoRows({ sellerOffers: 1, salesOpen: 1 }, busy).map((r) => r.key)).toEqual(["handover", "offers", "savers", "drops", "relist"]);
    expect(sellingTodoRows({ sellerOffers: 1, salesOpen: 1 }, busy, true).map((r) => r.key)).toEqual(["handover", "offers"]);
  });

  it("11-20 #6: the to-do's hand-over count is the shared one, which leaves out a sale on hold for a problem", () => {
    const line = (order_id: string, extra: Record<string, unknown> = {}) => ({ my_side: "seller", status: "paid", order_id, order_status: "paid", handover: "pickup", ...extra }) as never;
    const lines = [line("o1"), line("o2"), line("o3"), line("o4")];
    expect(salesToHandOver(lines, new Set<string>())).toBe(4);
    expect(salesToHandOver(lines, new Set(["o2"]))).toBe(3);
    // The to-do row says the shared number, not the cart's raw salesOpen.
    expect(sellingTodoRows({ sellerOffers: 0, salesOpen: 4 }, null, false, 3)).toEqual([expect.objectContaining({ key: "handover", n: 3 })]);
    // The chip and the Sold heading read the same count (source pins; the behaviour is in declutterTabs/sellingDash).
    const dash = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    expect(dash).toContain('{ key: "sold", label: t("decl.mv.pickups"), count: handOver ?? todo?.salesOpen ?? 0, hot: true }');
    expect(dash).toContain("<SellingTodo todo={todo} handOver={handOver}");
    const parts = blankComments(readFileSync("src/components/declutter/DeclutterTabParts.tsx", "utf8"));
    expect(parts).toContain("const toHandOver = salesToHandOver(lines, problems);");
  });

  it("11-20 #5: only the to-dos sit above the chips; the week's numbers, Shop sale and Away come after the lists", () => {
    const dash = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    const at = (s: string) => { const i = dash.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const chips = at("<StatusChips");
    expect(at("<SellingTodo")).toBeLessThan(chips);
    for (const below of ["<SellingWeek />", "<ShopSaleCard userId={userId} />", "<AwayCard userId={userId} />"]) {
      expect(at(below), below).toBeGreaterThan(at("{!soldFirst && sold}"));
    }
  });

  it("draws the to-dos, the four numbers with their change, and a to-do opens its list", async () => {
    const onPick = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SellingHome todo={{ sellerOffers: 2, salesOpen: 0 } as never} userId="u1" onPick={onPick} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Answer 2 offers")).toBeTruthy();
    expect(screen.getByText("1 paused listing to put back up")).toBeTruthy();
    // 11-20 #1: the label fills the row, so ListRow's trailing chevron sits at the right edge, not after the words.
    const label = screen.getByText("Answer 2 offers");
    expect(label.className.split(/\s+/)).toContain("flex-1");
    expect(label.closest("button")!.lastElementChild!.tagName.toLowerCase()).toBe("svg");
    expect(screen.queryByText(/send their savers/)).toBeNull();
    expect(screen.getByText("Up 100% on last week")).toBeTruthy(); // sales 2 vs 1
    expect(screen.getByText("Down 25% on last week")).toBeTruthy(); // views 30 vs 40
    expect(screen.getAllByText("Same as last week").length).toBe(2); // earned, saves
    expect(screen.getByText(/3 items for sale, worth \$51 if they all sell\./)).toBeTruthy();
    fireEvent.click(screen.getByText("Answer 2 offers"));
    expect(onPick).toHaveBeenCalledWith("offers");
  });

  it("while away, paused listings are not a to-do (they come back by themselves)", async () => {
    awayState.away = { back_on: "2026-11-30" };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SellingHome todo={{ sellerOffers: 2, salesOpen: 0 } as never} userId="u1" onPick={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Answer 2 offers")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("1 paused listing to put back up")).toBeNull();
    awayState.away = null;
  });
});
