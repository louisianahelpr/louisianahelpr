/**
 * VERIFY 2026-11-20 (~/.lh-shots/declutter-top5-1120/VERIFY.md, the live check of #4792):
 *   #8 PARTLY: at 375/390 the Away sheet's "Pause my shop" stacked on top of "Not now" (en + es), and so did the Spanish
 *      End-sale sheet ("Terminar oferta"): the shared footer stacks once a label is wider than half the card. Every new
 *      #4779 sheet is a `pair` ConfirmSheet: two halves side by side at every width, a long label wraps inside its half.
 *   Medium: with Away on, the to-do drew 4 rows and dropped to 1 when the away read landed (CLS 0.14-0.15 at 375/390).
 *   Medium: the Selling tab shifted while it loaded (CLS 0.12-0.13 at 375/390): the to-do card popped in above the
 *      chips and the sales ("statusChips" and "paidOrdersLoading" were the moved nodes) once the listings read answered.
 *      The tab now holds its bones until the listings, Selling home and away reads have answered.
 * jsdom cannot lay out a wrap or measure a shift, so the footer is pinned by its classes and the shifts by what is on
 * screen at each stage of the reads (bones, never the rows that would then move or drop).
 *
 *   Measured (dev server, prod data for poster-e2e, writes aborted; ~/.lh-shots/declutter-selling-shift-1120): the rest
 *      of the 0.12-0.13 was the first paid card drawing with no booking and growing 277 -> 568px when it came, moving its
 *      door tips 31px down. PaidOrdersSection now draws a card-height box per card until bookings, payouts and the open
 *      problems answer. Selling CLS at 375/390: 0.118/0.136 -> 0.0003 (away off), 0.277/0.292 -> 0.0003 (away on).
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |   const cardsWait = waitingOnReads \|\| !problemsAnswered; |   const cardsWait = false as boolean;
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {!cardsWait && shown.map((o) => ( |       {shown.map((o) => (
 * @mutate src/components/declutter/AwayMode.tsx | <ConfirmSheet pair open plain title={t("dt5.away.sheetTitle")} | <ConfirmSheet open plain title={t("dt5.away.sheetTitle")}
 * @mutate src/components/declutter/ShopSaleCard.tsx | <ConfirmSheet pair open={ending} | <ConfirmSheet open={ending}
 * @mutate src/components/declutter/DeclutterConfirmSheet.tsx |   "grid grid-cols-2 [&>button]:!min-w-0 | "[&>button]:!min-w-0
 * @mutate src/components/declutter/DeclutterConfirmSheet.tsx | [&>button]:whitespace-normal [&>button]:text-center | [&>button]:text-center
 * @mutate src/components/declutter/SellingHome.tsx |   if (home.isPending \|\| away.isPending) return | if (home.isPending) return
 * @mutate src/components/declutter/SellingHome.tsx |   return !on \|\| (!waiting(home) && !waiting(away)); |   return !on \|\| !waiting(home);
 * @mutate src/components/declutter/SellingHome.tsx |     q.isPending && q.failureCount === 0 && q.errorUpdateCount === 0; |     q.isPending && q.failureCount === 0;
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   if (mine.isPending \|\| !topSettled) return <DeclutterTabBones />; |   if (mine.isPending) return <DeclutterTabBones />;
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   if (mine.isPending \|\| !topSettled) return <DeclutterTabBones />; |   if (!topSettled) return <DeclutterTabBones />;
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { __resetLangForTests, ensureLangLoaded, setLang } from "@/lib/i18n/language";

const gate = vi.hoisted(() => {
  let release: (v: unknown) => void = () => {};
  const state = { away: null as null | { back_on: string }, held: false, fail: false, release: (v: unknown) => release(v) };
  return { state, hold: () => new Promise((res) => { release = res; }) };
});
vi.mock("@/lib/declutter/api", () => ({
  fetchSellingHome: async () => ({
    week: { sales: 1, earnings_cents: 1000, views: 5, saves: 1 },
    last_week: { sales: 0, earnings_cents: 0, views: 2, saves: 0 },
    todo: { to_relist: 2, price_drops: 3, savers_to_offer: 4 },
    live_count: 3,
    live_value_cents: 5000,
  }),
  fetchMyAway: () => (gate.state.fail ? Promise.reject(new Error("network")) : gate.state.held ? gate.hold() : Promise.resolve(gate.state.away)),
}));

import { ConfirmSheet, PAIR_FOOTER } from "./DeclutterConfirmSheet";
import { SellingTodo, useSellingTopSettled } from "./SellingHome";

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrap = ({ children, qc }: { children: ReactNode; qc: QueryClient }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

/** Every ConfirmSheet the Declutter top 5 (#4779) added: saver offer, shop sale start + end, bulk x3 (plus Put back on sale, audit 11-20 night #8), away. */
const NEW_SHEET_FILES = {
  "src/components/declutter/SaverOffer.tsx": 2, // + Auto-offer new savers (11-25)
  "src/components/declutter/ShopSaleCard.tsx": 2,
  "src/components/declutter/BulkActions.tsx": 4,
  "src/components/declutter/AwayMode.tsx": 1,
} as const;

describe("VERIFY 11-20: Selling's new sheets and first paint", () => {
  it("#8: every new top-5 sheet keeps its two actions side by side (a pair ConfirmSheet)", () => {
    let total = 0;
    for (const [file, n] of Object.entries(NEW_SHEET_FILES)) {
      const sheets = [...code(file).matchAll(/<ConfirmSheet\b[\s\S]*?testId=/g)].map((m) => m[0]);
      expect(sheets.length, file).toBe(n);
      for (const s of sheets) expect(s, `${file}: ${s.slice(0, 80)}`).toMatch(/^<ConfirmSheet\s+pair\b/);
      total += n;
    }
    expect(total).toBeGreaterThan(6);
  });

  it("#8: a pair footer is the 2-column grid and lets a long label wrap inside its half (en + es labels)", async () => {
    for (const cls of ["grid", "grid-cols-2", "[&>button]:!min-w-0", "[&>button]:!h-auto", "[&>button]:min-h-14", "[&>button]:whitespace-normal", "[&>button]:text-center"]) {
      expect(PAIR_FOOTER.split(/\s+/), cls).toContain(cls);
    }
    for (const lang of ["en", "es"] as const) {
      await act(async () => { setLang(lang); await ensureLangLoaded(); });
      const { unmount } = render(
        <ConfirmSheet open pair plain title="Pause your shop until" confirmLabel={lang === "es" ? "Pausar mi tienda" : "Pause my shop"} onConfirm={() => {}} onClose={() => {}} testId="pair-probe">
          body
        </ConfirmSheet>,
      );
      const footer = document.querySelector("[data-sheet-pair]") as HTMLElement;
      expect(footer, lang).toBeTruthy();
      expect(footer.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-2"]));
      // [dismiss, commit] in that order: Not now on the left, the action on the right.
      const buttons = [...footer.querySelectorAll(":scope > button")].map((b) => b.textContent);
      expect(buttons).toEqual([lang === "es" ? "Ahora no" : "Not now", lang === "es" ? "Pausar mi tienda" : "Pause my shop"]);
      unmount();
    }
    __resetLangForTests();
    // Without `pair` the shared footer is untouched (every other Declutter sheet keeps its content-keyed stack).
    render(<ConfirmSheet open title="x" confirmLabel="Go" onConfirm={() => {}} onClose={() => {}} testId="plain-probe">b</ConfirmSheet>);
    expect(document.querySelector("[data-confirm-sheet='plain-probe'] [data-sheet-pair]")).toBeNull();
  });

  it("Medium (away): the to-do never draws the rows the away state would drop; bones until it is known", async () => {
    gate.state.held = true;
    const qc = client();
    render(<Wrap qc={qc}><SellingTodo todo={{ sellerOffers: 0, salesOpen: 3 } as never} handOver={3} userId="u-away" onPick={() => {}} /></Wrap>);
    // The Selling home read has answered; the away read is still on the way.
    await waitFor(() => expect(qc.getQueryState(["declutter", "selling-home"])?.status).toBe("success"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-selling-home-bones]")).toBeTruthy();
    expect(document.querySelectorAll("[data-selling-todo]").length).toBe(0);
    await act(async () => { gate.state.release({ back_on: "2026-11-30" }); });
    await waitFor(() => expect(document.querySelectorAll("[data-selling-todo]").length).toBe(1));
    expect(screen.getByText("Hand over 3 sales")).toBeTruthy();
    expect(document.querySelector("[data-selling-todo='savers']")).toBeNull();
    gate.state.held = false;
  });

  it("Medium (load shift): the tab's first paint waits for the Selling home and away reads (and lets a failure through)", async () => {
    gate.state.held = true;
    const qc = client();
    const { result } = renderHook(() => useSellingTopSettled("u-top", true), { wrapper: ({ children }) => <Wrap qc={qc}>{children}</Wrap> });
    await waitFor(() => expect(qc.getQueryState(["declutter", "selling-home"])?.status).toBe("success"));
    expect(result.current).toBe(false); // away still on the way
    await act(async () => { gate.state.release(null); });
    await waitFor(() => expect(result.current).toBe(true));
    gate.state.held = false;
    // A read that failed once lets the tab through at once, even while the app's retries (seconds of backoff) go on.
    gate.state.fail = true;
    const retrying = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } } });
    const failed = renderHook(() => useSellingTopSettled("u-fail", true), { wrapper: ({ children }) => <Wrap qc={retrying}>{children}</Wrap> });
    await waitFor(() => expect(failed.result.current).toBe(true));
    expect(retrying.getQueryState(["declutter", "away", "u-fail"])?.status).toBe("pending");
    failed.unmount();
    retrying.clear();
    // ...and stays through: a failed read with no data goes back to pending when the to-do mounts and asks again, which
    // flipped the tab between bones and content without end (seen in sellingDash.test, ~900 renders).
    const once = client();
    const held = renderHook(() => useSellingTopSettled("u-again", true), { wrapper: ({ children }) => <Wrap qc={once}>{children}</Wrap> });
    await waitFor(() => expect(once.getQueryState(["declutter", "away", "u-again"])?.status).toBe("error"));
    expect(held.result.current).toBe(true);
    const seen: boolean[] = [];
    const again = renderHook(() => { const v = useSellingTopSettled("u-again", true); seen.push(v); return v; }, { wrapper: ({ children }) => <Wrap qc={once}>{children}</Wrap> });
    await waitFor(() => expect(once.getQueryState(["declutter", "away", "u-again"])?.errorUpdateCount).toBeGreaterThan(1));
    expect(seen.every(Boolean)).toBe(true);
    again.unmount();
    held.unmount();
    gate.state.fail = false;
    // Off (a chip picked, or no listings): nothing to wait for, and no read is made.
    const qc2 = client();
    const off = renderHook(() => useSellingTopSettled("u-off", false), { wrapper: ({ children }) => <Wrap qc={qc2}>{children}</Wrap> });
    expect(off.result.current).toBe(true);
    expect(qc2.getQueryState(["declutter", "away", "u-off"])?.fetchStatus ?? "idle").toBe("idle");
    // SellingDash: bones while the listings read or the top reads are on the way, the to-do above the chips after.
    const dash = code("src/components/declutter/DeclutterMineViews.tsx");
    expect(dash).toContain("const topSettled = useSellingTopSettled(userId, only === null && hasListings);");
    const bones = dash.indexOf("if (mine.isPending || !topSettled) return <DeclutterTabBones />;");
    expect(bones).toBeGreaterThan(-1);
    expect(bones).toBeLessThan(dash.indexOf("<SellingTodo"));
  });

  it("Medium (load shift): a paid card never draws before its booking, payout and problem reads (bones until then)", () => {
    const s = code("src/components/declutter/DeclutterHandoverViews.tsx");
    expect(s).toContain("const cardsWait = waitingOnReads || !problemsAnswered;");
    expect(s).toContain('{cardsWait && shown.slice(0, 4).map((o) => <div key={o.orderId} className="h-64 rounded-[20px] border border-border bg-card" data-paid-order-bones="" aria-hidden />)}');
    expect(s).toContain("{!cardsWait && shown.map((o) => (");
    expect(s.match(/<OrderCard\b/g)?.length).toBe(1);
  });

  // Deep audit 11-22 #46: one width per tab at 1440: the to-do card and the paid-sales placeholder run the lists' width.
  it("low: the to-do card is as wide as the lists, and the bulk bar is the elevated surface", () => {
    const home = code("src/components/declutter/SellingHome.tsx");
    expect(home).toMatch(/<section className="w-full [^"]*" aria-label=\{t\("dt5\.home\.todo"\)\}/);
    expect(home).not.toMatch(/max-w-3xl/);
    expect(code("src/components/declutter/DeclutterTabParts.tsx")).toContain('<section className="space-y-3" aria-label={label} aria-busy="true" data-paid-orders-loading="">');
    const bar = code("src/components/declutter/BulkActions.tsx").match(/className="([^"]*)"[^>]*data-bulk-bar=""/);
    expect(bar?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["bg-popover", "shadow-[var(--shadow-elevated)]", "border", "border-border"]));
    expect(bar?.[1]).not.toMatch(/\bbg-card\b/);
  });
});
