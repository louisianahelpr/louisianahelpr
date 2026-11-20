/**
 * Declutter top 5 #5 (owner 11-19): bulk actions and away mode.
 * Server behaviour: src/test/pglite/declutterBulkAndAway.pglite.mjs (29 PASS applied 3x; NEW_MIGRATION=skip RED; a
 * planted return that puts back every paused listing, not only the ones the away paused, 3 FAIL). Here: the newest
 * definitions keep the rules, and the bar, the away card and the public banner behave.
 *
 * @mutate supabase/migrations/20261120015456_declutter_bulk_and_away.sql |         WHERE id = v_id AND seller_id = p_seller AND status = 'paused'; |         WHERE seller_id = p_seller AND status = 'paused';
 * @mutate supabase/migrations/20261120015456_declutter_bulk_and_away.sql |     v_cents := greatest(100, COALESCE(r.floor_price_cents, 100),\n                        round(r.current_price_cents * (100 - p_percent_off) / 100.0)::integer); |     v_cents := greatest(100,\n                        round(r.current_price_cents * (100 - p_percent_off) / 100.0)::integer);
 * @mutate src/components/declutter/BulkActions.tsx | export const bulkPickable = (i: Pick<DeclutterItem, "status">) => i.status === "live" \|\| i.status === "paused"; | export const bulkPickable = (i: Pick<DeclutterItem, "status">) => i.status !== "draft";
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => ({ paused: [] as string[], away: null as null | { back_on: string }, until: null as string | null }));
vi.mock("@/lib/declutter/api", () => ({
  pauseListing: async (id: string) => { if (id === "bad") throw new Error("item_not_editable"); calls.paused.push(id); return "paused"; },
  relistListing: async () => "live",
  markSoldElsewhere: async () => undefined,
  fetchMyAway: async () => calls.away,
  fetchSellerAwayUntil: async () => calls.until,
}));

import { BulkBar, bulkPickable, runEach } from "./BulkActions";
import { AwayBanner, AwayCard } from "./AwayMode";
import { calendarDayWords, dateInDays } from "@/lib/declutter/sellerTools";
import type { DeclutterItem } from "@/lib/declutter/api";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const item = (id: string, status: string) => ({ id, status, title: id, current_price_cents: 2000 }) as unknown as DeclutterItem;

describe("Declutter top 5 #5: bulk actions and away mode", () => {
  it("the newest definitions: bulk discount never below the lowest price; away pauses as Pause and returns only what it paused", () => {
    const bulk = flat(newestFunction("declutter_bulk_discount").body);
    expect(bulk).toContain("AND i.seller_id = v_uid AND i.status IN ('live', 'paused') AND i.current_price_cents >= 200");
    expect(bulk).toContain("v_cents := greatest(100, COALESCE(r.floor_price_cents, 100),");
    const go = flat(newestFunction("declutter_go_away").body);
    expect(go).toContain("PERFORM public.declutter_pause_listing(r.id);");
    const ret = flat(newestFunction("declutter_away_return").body);
    expect(ret).toContain("v_ok := EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = p_seller) AND NOT public.declutter_seller_out(p_seller);");
    expect(ret).toContain("WHERE id = v_id AND seller_id = p_seller AND status = 'paused';");
  });

  it("only listings for sale or paused can be ticked", () => {
    expect(["live", "paused", "draft", "reserved", "sold", "pending_review"].map((s) => bulkPickable({ status: s } as DeclutterItem))).toEqual([true, true, false, false, false, false]);
  });

  it("one action over many counts what went through and what was refused", async () => {
    expect(await runEach(["a", "bad", "b"], async (id) => { if (id === "bad") throw new Error("no"); })).toEqual({ done: 2, failed: 1 });
  });

  it("the bar offers Pause only with a live listing ticked and pauses each one", async () => {
    calls.paused = [];
    const onDone = vi.fn();
    wrap(<BulkBar items={[item("a", "live"), item("b", "paused"), item("c", "live")]} picked={new Set(["a", "b"])} onDone={onDone} />);
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByText("Put back on sale")).toBeTruthy();
    fireEvent.click(screen.getByText("Pause"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.paused).toEqual(["a"]);
  });

  it("away: the card offers Go away, and while away says until when with I'm back; the public page shows the date", async () => {
    calls.away = null;
    const a = wrap(<AwayCard userId="u1" />);
    expect(await screen.findByText("Go away")).toBeTruthy();
    a.unmount();
    calls.away = { back_on: "2026-11-30" };
    const b = wrap(<AwayCard userId="u1" />);
    expect(await screen.findByText("You're away until Mon, Nov 30. Your listings are paused and come back that day.")).toBeTruthy();
    expect(screen.getByText("I'm back")).toBeTruthy();
    b.unmount();
    calls.until = "2026-11-30";
    wrap(<AwayBanner sellerId="s1" />);
    expect(await screen.findByText("Away until Mon, Nov 30")).toBeTruthy();
  });

  it("dates are calendar days, never shifted by the time zone", () => {
    expect(calendarDayWords("2026-11-30")).toBe("Mon, Nov 30");
    expect(dateInDays(7, new Date(2026, 10, 19, 23, 30))).toBe("2026-11-26");
  });
});
