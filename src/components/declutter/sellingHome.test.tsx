/**
 * Declutter top 5 #2 (owner 11-19): the Selling home. Server behaviour: src/test/pglite/declutterSellingHome.pglite.mjs
 * (12 PASS applied 3x; NEW_MIGRATION=skip RED; a planted body that counts refunded orders as sales 1 FAIL). Here: the
 * newest definition keeps the rules, and the card draws the to-dos and honest week-on-week words.
 *
 * @mutate supabase/migrations/20261120012050_declutter_selling_home.sql |      AND o.status IN ('paid', 'handed_over') |      AND true
 * @mutate src/lib/declutter/sellerTools.ts |   if (last === 0) return { dir: "new", pct: 0 }; |   if (last === 0) return { dir: "up", pct: 100 };
 * @mutate src/components/declutter/SellingHome.tsx |   return rows.filter((r) => r.n > 0); |   return rows;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { weekChange } from "@/lib/declutter/sellerTools";

const home = {
  week: { sales: 2, earnings_cents: 6500, views: 30, saves: 0 },
  last_week: { sales: 1, earnings_cents: 6500, views: 40, saves: 0 },
  todo: { to_relist: 1, price_drops: 2, savers_to_offer: 0 },
  live_count: 3,
  live_value_cents: 5100,
};
vi.mock("@/lib/declutter/api", () => ({ fetchSellingHome: async () => home }));

import { SellingHome, sellingTodoRows } from "./SellingHome";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("Declutter top 5 #2: Selling home", () => {
  it("the newest declutter_selling_home: own selling only, real sales only, the nudge's own price-drop rule", () => {
    const d = newestFunction("declutter_selling_home");
    expect(d.file).toContain("20261120012050");
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

  it("draws the to-dos, the four numbers with their change, and a to-do opens its list", async () => {
    const onPick = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SellingHome todo={{ sellerOffers: 2, salesOpen: 0 } as never} onPick={onPick} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Answer 2 offers")).toBeTruthy();
    expect(screen.getByText("1 paused listing to put back up")).toBeTruthy();
    expect(screen.queryByText(/send their savers/)).toBeNull();
    expect(screen.getByText("Up 100% on last week")).toBeTruthy(); // sales 2 vs 1
    expect(screen.getByText("Down 25% on last week")).toBeTruthy(); // views 30 vs 40
    expect(screen.getAllByText("Same as last week").length).toBe(2); // earned, saves
    expect(screen.getByText(/3 items for sale, worth \$51 if they all sell\./)).toBeTruthy();
    fireEvent.click(screen.getByText("Answer 2 offers"));
    expect(onPick).toHaveBeenCalledWith("offers");
  });
});
