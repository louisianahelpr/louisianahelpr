/**
 * Declutter top 5 #3 (owner 11-19): "In demand" on listings, real counts past a threshold only.
 * Server behaviour: src/test/pglite/declutterItemDemand.pglite.mjs (9 PASS applied 3x; NEW_MIGRATION=skip RED; a planted
 * body that counts test accounts' offers 2 FAIL). Here: the newest definition keeps those rules, the thresholds hold,
 * and the item page draws only what passes them.
 *
 * @mutate supabase/migrations/20261122134941_declutter_demand_offers_off.sql |                AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)) |                AND true)
 * Deep audit 11-22 #56: an offers-off listing never reports offers, on the server (the newest definition) and on the page.
 * @mutate supabase/migrations/20261122134941_declutter_demand_offers_off.sql |            CASE WHEN i.accepts_offers THEN |            CASE WHEN true THEN
 * @mutate src/lib/declutter/demand.ts |   if (offersOn && d.offers_week >= DEMAND_MIN.offersWeek) | if (d.offers_week >= DEMAND_MIN.offersWeek)
 * @mutate src/components/declutter/DeclutterItemView.tsx | <DemandLine itemId={it.id} offersOn={it.accepts_offers !== false} /> | <DemandLine itemId={it.id} />
 * @mutate src/lib/declutter/demand.ts |   if (d.saves >= DEMAND_MIN.saves) out.push({ key: "saves", n: d.saves }); |   if (d.saves >= 1) out.push({ key: "saves", n: d.saves });
 * @mutate src/lib/declutter/demand.ts |   return d.offers_week >= DEMAND_MIN.offersWeek; |   return d.offers_week >= 1;
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
// DemandLine relies on the item page to register its words (i18nDictionariesRideWithTheirScreens); a standalone render does it here.
import "@/lib/i18n/enItemPage";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({ demand: null as null | { saves: number; offers_week: number; views_today: number } }));
vi.mock("@/lib/declutter/demand", async (orig) => ({ ...(await orig<object>()), fetchItemDemand: async () => state.demand }));

import { DEMAND_MIN, demandLines, isInDemand } from "@/lib/declutter/demand";
import { DemandLine } from "./DemandLine";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const draw = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DemandLine itemId="i1" />
  </QueryClientProvider>,
);

describe("Declutter top 5 #3: in demand", () => {
  it("the newest declutter_item_demand: save counts' visibility, test people never counted, numbers only", () => {
    const d = newestFunction("declutter_item_demand");
    expect(d.file).toContain("20261122134941"); // restated by the shop sale (#4), the uuid views fix (42804), then #56
    const b = flat(d.body);
    for (const part of [
      "IF NOT public.declutter_open_to_guests() THEN RETURN;",
      "AND NOT (i.seller_id = ANY (COALESCE((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))",
      "WHERE w.item_id = i.id AND w.user_id <> i.seller_id",
      "WHERE o.item_id = i.id AND o.created_at > now() - interval '7 days'",
      "AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)",
      "AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v.viewer_id)",
      "AND (v.viewer_id IS NULL OR v.viewer_id <> i.seller_id)",
      // #56: offers off -> 0 offers this week.
      "CASE WHEN i.accepts_offers THEN (SELECT count(DISTINCT o.buyer_id)::integer FROM public.declutter_offers o",
      "ELSE 0 END,",
    ]) expect(b, part).toContain(part);
  });

  it("#56: a listing with offers off never says offers, even with a count; the item page passes accepts_offers", async () => {
    expect(demandLines({ saves: 8, offers_week: 3, views_today: 12 }, false)).toEqual([{ key: "saves", n: 8 }, { key: "views", n: 12 }]);
    state.demand = { saves: 1, offers_week: 4, views_today: 1 };
    const r = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DemandLine itemId="i1" offersOn={false} />
      </QueryClientProvider>,
    );
    await new Promise((res) => setTimeout(res, 20));
    expect(r.container.textContent).not.toMatch(/offer/i);
    const page = blankSqlComments(readFileSync(resolve(__dirname, "DeclutterItemView.tsx"), "utf8"));
    expect(page).toContain("<DemandLine itemId={it.id} offersOn={it.accepts_offers !== false} />");
  });

  it("thresholds: small numbers never show", () => {
    expect(DEMAND_MIN).toEqual({ saves: 3, offersWeek: 2, viewsToday: 5 });
    expect(demandLines({ saves: 2, offers_week: 1, views_today: 4 })).toEqual([]);
    expect(demandLines({ saves: 8, offers_week: 3, views_today: 12 })).toEqual([{ key: "offers", n: 3 }, { key: "saves", n: 8 }, { key: "views", n: 12 }]);
    expect(isInDemand({ offers_week: 1 })).toBe(false);
    expect(isInDemand({ offers_week: 2 })).toBe(true);
  });

  it("the item page draws the lines that pass, and nothing for a quiet listing", async () => {
    state.demand = { saves: 8, offers_week: 1, views_today: 12 };
    const { unmount } = draw();
    expect(await screen.findByText("8 people saved this · 12 views today")).toBeTruthy();
    unmount();
    state.demand = { saves: 1, offers_week: 0, views_today: 2 };
    const { container } = draw();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-item-demand]")).toBeNull();
  });
});
