/**
 * Declutter top 5 #5 (owner 11-19): bulk actions and away mode.
 * Server behaviour: src/test/pglite/declutterBulkAndAway.pglite.mjs (29 PASS applied 3x; NEW_MIGRATION=skip RED; a
 * planted return that puts back every paused listing, not only the ones the away paused, 3 FAIL). Here: the newest
 * definitions keep the rules, and the bar, the away card and the public banner behave.
 *
 * @mutate supabase/migrations/20261120015456_declutter_bulk_and_away.sql |         WHERE id = v_id AND seller_id = p_seller AND status = 'paused'; |         WHERE seller_id = p_seller AND status = 'paused';
 * @mutate supabase/migrations/20261120015456_declutter_bulk_and_away.sql |     v_cents := greatest(100, COALESCE(r.floor_price_cents, 100),\n                        round(r.current_price_cents * (100 - p_percent_off) / 100.0)::integer); |     v_cents := greatest(100,\n                        round(r.current_price_cents * (100 - p_percent_off) / 100.0)::integer);
 * @mutate supabase/migrations/20261120015456_declutter_bulk_and_away.sql |     ELSE v_uid <> p_seller_id\n         AND p_seller_id = ANY | ELSE false\n         AND p_seller_id = ANY
 * Post-merge check 11-20 (~/.lh-shots/declutter-top5-1120): #7 bulk Pause asks first; #4 the floating "+ Sell" steps
 * aside while the bar is up; #3 the tick sits beside the photo in the row; #2 "1 week", never "1 weeks"; #13 the away
 * card holds its place while it loads.
 * @mutate src/components/declutter/BulkActions.tsx | onClick={() => setAsking("pause")} data-bulk-action="pause" | onClick={() => each.mutate("pause")} data-bulk-action="pause"
 * @mutate src/components/declutter/BulkActions.tsx |       <HideSectionCreateFab />\n |
 * @mutate src/components/declutter/BulkActions.tsx |     <div className="-ml-3 flex min-w-0 flex-1 items-center" data-bulk-row={item.id}> |     <div className="-ml-3 flex min-w-0 flex-1 flex-col" data-bulk-row={item.id}>
 * @mutate src/components/declutter/AwayMode.tsx |   return days === 7 ? t("dt5.away.week1") : | return
 * @mutate src/components/declutter/AwayMode.tsx |   if (away.isPending) return <ShopToolBones name="away" />; |   if (away.isPending) return null;
 * @mutate src/components/declutter/BulkActions.tsx | export const bulkPickable = (i: Pick<DeclutterItem, "status">) => i.status === "live" \|\| i.status === "paused"; | export const bulkPickable = (i: Pick<DeclutterItem, "status">) => i.status !== "draft";
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => ({ paused: [] as string[], away: null as null | { back_on: string }, awayFails: false, until: null as string | null }));
vi.mock("@/lib/declutter/api", () => ({
  pauseListing: async (id: string) => { if (id === "bad") throw new Error("item_not_editable"); calls.paused.push(id); return "paused"; },
  relistListing: async () => "live",
  markSoldElsewhere: async () => undefined,
  fetchMyAway: async () => { if (calls.awayFails) throw new Error("network"); return calls.away; },
  fetchSellerAwayUntil: async () => calls.until,
}));

import { BulkBar, BulkPick, bulkPickable, runEach } from "./BulkActions";
import { AwayBanner, AwayCard, awayChoiceWords } from "./AwayMode";
import { useSectionCreateFabHidden } from "@/components/sections/createFabHidden";
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

  it("review 11-19 #3 and #7: no price cut on top of a running sale; the public away date follows the listings' visibility", () => {
    expect(flat(newestFunction("declutter_bulk_discount").body)).toContain("RAISE EXCEPTION 'sale_running'");
    const slp = newestFunction("declutter_set_listing_price");
    expect(slp.file).toContain("20261120015456");
    expect(flat(slp.body)).toContain("IF p_price_cents < v_item.current_price_cents AND EXISTS ( SELECT 1 FROM public.declutter_shop_sale_items x JOIN public.declutter_shop_sales s ON s.id = x.sale_id AND s.status = 'on'");
    const until = flat(newestFunction("declutter_seller_away_until").body);
    expect(until).toContain("WHEN v_uid IS NULL THEN NOT public.declutter_open_to_guests()");
    expect(until).toContain("IF v_hidden THEN RETURN NULL;");
    expect(until).toContain("p_seller_id = ANY (COALESCE((SELECT public.declutter_my_block_partners()), '{}'::uuid[]))");
    expect(until).toContain("IF v_uid IS DISTINCT FROM p_seller_id AND public.declutter_seller_out(p_seller_id) THEN RETURN NULL;");
  });

  it("only listings for sale or paused can be ticked", () => {
    expect(["live", "paused", "draft", "reserved", "sold", "pending_review"].map((s) => bulkPickable({ status: s } as DeclutterItem))).toEqual([true, true, false, false, false, false]);
  });

  it("one action over many counts what went through and what was refused", async () => {
    expect(await runEach(["a", "bad", "b"], async (id) => { if (id === "bad") throw new Error("no"); })).toMatchObject({ done: 2, failed: 1, failedIds: ["bad"] });
  });

  it("the bar offers Pause only with a live listing ticked and pauses each one", async () => {
    calls.paused = [];
    const onDone = vi.fn();
    wrap(<BulkBar items={[item("a", "live"), item("b", "paused"), item("c", "live")]} picked={new Set(["a", "b"])} onDone={onDone} />);
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByText("Put back on sale")).toBeTruthy();
    // 11-20 #7: Pause asks first in the in-app sheet; nothing is paused until it is confirmed.
    fireEvent.click(screen.getByText("Pause"));
    const sheet = await screen.findByText("Pause 1 listing?");
    expect(calls.paused).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    const confirm = [...sheet.closest("[data-confirm-sheet]")!.querySelectorAll("button")].find((b) => b.textContent === "Pause")!;
    fireEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.paused).toEqual(["a"]);
  });

  it("audit 11-20 night #8: a refused listing stays ticked, and Put back on sale asks first", async () => {
    calls.paused = [];
    const onDone = vi.fn();
    const onKeep = vi.fn();
    wrap(<BulkBar items={[item("a", "live"), item("bad", "live"), item("p", "paused")]} picked={new Set(["a", "bad", "p"])} onDone={onDone} onKeep={onKeep} />);
    fireEvent.click(screen.getByText("Pause"));
    const sheet = await screen.findByText("Pause 2 listings?");
    fireEvent.click([...sheet.closest("[data-confirm-sheet]")!.querySelectorAll("button")].find((b) => b.textContent === "Pause")!);
    await waitFor(() => expect(onKeep).toHaveBeenCalledWith(["bad"]));
    expect(onDone).not.toHaveBeenCalled();
    expect(calls.paused).toEqual(["a"]);
    // Resume opens the same in-app confirm instead of running from the button.
    fireEvent.click(screen.getByText("Put back on sale"));
    expect(await screen.findByText("Put 1 listing back on sale?")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("11-20 #4: while the bar is up the floating + Sell steps aside, and comes back when it goes", () => {
    const Probe = () => <span data-fab-hidden={String(useSectionCreateFabHidden())} />;
    const { container, unmount } = wrap(<><Probe /><BulkBar items={[item("a", "live")]} picked={new Set(["a"])} onDone={() => {}} /></>);
    expect(container.querySelector("[data-fab-hidden]")!.getAttribute("data-fab-hidden")).toBe("true");
    unmount();
    const after = wrap(<Probe />);
    expect(after.container.querySelector("[data-fab-hidden]")!.getAttribute("data-fab-hidden")).toBe("false");
  });

  it("11-20 #3: while selecting, the tick sits in the same row as the listing's link, left of it", () => {
    const { container } = wrap(
      <BulkPick item={item("a", "live")} selecting picked={false} onToggle={() => {}}><a href="/x" data-row-link="">Lamp</a></BulkPick>,
    );
    const row = container.querySelector("[data-bulk-row]")!;
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "items-center"]));
    expect(row.className).not.toMatch(/flex-col/);
    expect(row.firstElementChild!.matches("[data-bulk-pick]")).toBe(true);
    expect(row.lastElementChild!.matches("[data-row-link]")).toBe(true);
    // Not selecting (or a sold listing): the link alone, no tick.
    const off = wrap(<BulkPick item={item("b", "sold")} selecting picked={false} onToggle={() => {}}><a href="/y" data-row-link2="">Bike</a></BulkPick>);
    expect(off.container.querySelector("[data-bulk-pick]")).toBeNull();
    expect(off.container.querySelector("[data-row-link2]")).not.toBeNull();
  });

  it("11-20 #2: the away choices say 3 days, 1 week, 2 weeks", () => {
    expect([3, 7, 14].map(awayChoiceWords)).toEqual(["3 days", "1 week", "2 weeks"]);
  });

  // Audit 11-20 night #9: a failed read drew nothing, so an away seller could not see or end away mode.
  // @mutate src/components/declutter/AwayMode.tsx | if (away.isError) return <ErrorState | if (away.isError) return null; if (away.isError) return <ErrorState
  it("away: a failed read says so with Try again, and the retry brings the card back", async () => {
    calls.awayFails = true;
    calls.away = { back_on: "2026-11-30" };
    const a = wrap(<AwayCard userId="u1" />);
    expect(await screen.findByText("We couldn't load away mode.")).toBeTruthy();
    calls.awayFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("I'm back")).toBeTruthy();
    a.unmount();
  });

  it("away: the card offers Go away, and while away says until when with I'm back; the public page shows the date", async () => {
    calls.away = null;
    const a = wrap(<AwayCard userId="u1" />);
    // 11-20 #13: it holds its place while it loads (the card's own floor), never pops in.
    expect(a.container.querySelector('[data-shop-tool-bones="away"]')).not.toBeNull();
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
