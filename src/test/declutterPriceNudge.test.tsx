/**
 * CMP-5 (lead decision 2026-10-30 05:00Z), the screen half: a paid listing live 14 days with no sale and no accepted
 * offer shows "Hasn't sold yet. Drop the price?" in Selling; it opens Manage at Change price with about 15% off filled
 * in (whole dollars, never below the lowest price). Free items and items with a price drop planned never show it. The
 * notice the server sweep sends links to `?tab=selling&manage=<id>&drop=1`, which opens the same sheet.
 *
 * @mutate src/lib/declutter/priceNudge.ts |   const cents = Math.max(target, lowest); |   const cents = target;
 * @mutate src/lib/declutter/priceNudge.ts |   const target = Math.floor((currentCents * (100 - PRICE_NUDGE_PCT)) / 100 / 100) * 100; |   const target = Math.round((currentCents * (100 - PRICE_NUDGE_PCT)) / 100);
 * @mutate src/lib/declutter/priceNudge.ts |   if (item.status !== "live" \|\| item.current_price_cents <= 0 \|\| dropsOn \|\| item.is_seed) return false; |   if (item.status !== "live" \|\| dropsOn) return false;
 * @mutate src/lib/declutter/priceNudge.ts |   return Number.isFinite(live) && now - live >= PRICE_NUDGE_DAYS * 86_400_000; |   return Number.isFinite(live);
 * @mutate src/components/declutter/DeclutterPriceNudge.tsx |   return items.filter((item) => priceNudgeDue(item, dropOutlook(item, dropStates?.get(item.id)).planned)); |   return items.filter((item) => priceNudgeDue(item, false));
 * @mutate src/components/declutter/DeclutterManageListing.tsx |   const [price, setPrice] = useState(centsToDollars(initialCents ?? item.current_price_cents)); |   const [price, setPrice] = useState(centsToDollars(item.current_price_cents));
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       {!searching && <PriceNudgeSummary due={priceNudgeItems(list, myDrops.data)} onOpen={openNudge} />} |
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   usePriceNudgeLink(mine.data, openNudge);\n |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { priceNudgeDue, priceNudgePath, readPriceNudgeLink, suggestedDropCents } from "@/lib/declutter/priceNudge";
import { PriceNudgeSummary, priceNudgeItems, usePriceNudgeLink } from "@/components/declutter/DeclutterPriceNudge";
import type { DeclutterItem } from "@/lib/declutter/api";

const NOW = Date.parse("2026-10-30T18:00:00Z");
const DAY = 86_400_000;
const ID = "a0000000-0000-4000-8000-000000000001";
const item = (over: Partial<DeclutterItem> = {}) => ({
  id: ID, status: "live", current_price_cents: 4000, price_cents: 4000, live_at: new Date(NOW - 15 * DAY).toISOString(),
  sale_mode: "offers", ...over,
}) as unknown as DeclutterItem;
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("CMP-5: the suggested price", () => {
  it("about 15% lower, whole dollars, never below the lowest price or $1; null when it cannot go lower", () => {
    const cases: [number, number | null, number | null][] = [
      [4000, null, 3400], [4000, 3000, 3400], [4000, 3500, 3500], [4000, 3550, 3600], [1000, null, 800],
      [2599, null, 2200], [150, null, 100], [100, null, null], [4000, 4000, null], [4000, 4500, null], [0, null, null],
    ];
    expect(cases.length).toBeGreaterThan(8);
    for (const [cur, floor, want] of cases) expect(suggestedDropCents(cur, floor), `${cur} floor ${floor}`).toBe(want);
  });
});

describe("CMP-5: which listings are due", () => {
  it("live, priced, 14+ days, no drop planned, not test data", () => {
    expect(priceNudgeDue(item(), false, NOW)).toBe(true);
    expect(priceNudgeDue(item({ live_at: new Date(NOW - 13 * DAY).toISOString() }), false, NOW)).toBe(false);
    expect(priceNudgeDue(item({ current_price_cents: 0 }), false, NOW), "free").toBe(false);
    expect(priceNudgeDue(item(), true, NOW), "drops on").toBe(false);
    expect(priceNudgeDue(item({ status: "reserved" }), false, NOW), "a sale or accepted offer reserves it").toBe(false);
    expect(priceNudgeDue(item({ live_at: null }), false, NOW)).toBe(false);
    expect(priceNudgeDue({ ...item(), is_seed: true }, false, NOW), "test data").toBe(false);
  });

  it("the notice's link reads back to the item; anything else opens nothing", () => {
    expect(readPriceNudgeLink(new URLSearchParams(priceNudgePath(ID).split("?")[1]))).toBe(ID);
    expect(readPriceNudgeLink(new URLSearchParams(`manage=${ID}`))).toBeNull();
    expect(readPriceNudgeLink(new URLSearchParams("manage=x&drop=1"))).toBeNull();
  });
});

// Polish audit 11-27 #11: ONE line above Selling's list ("2 listings haven't sold in 2 weeks. Drop prices"), not a line
// on every row; its button opens the first due listing.
describe("CMP-5: Selling's nudge and the link", () => {
  it("due listings make one line that opens the first; a listing with a drop planned is not counted", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const onOpen = vi.fn();
    const planned = item({ id: "planned", sale_mode: "offers" } as Partial<DeclutterItem>);
    const due = priceNudgeItems([item(), item({ id: "second" } as Partial<DeclutterItem>), planned],
      new Map([["planned", { sale_mode: "offers", last_price_drop_on: "2026-10-30", drop_pct: 5 }]]));
    expect(due.map((d) => d.id)).toEqual([ID, "second"]);
    const { unmount } = render(<PriceNudgeSummary due={due} onOpen={onOpen} />);
    expect(screen.getByText(/2 listings haven't sold in 2 weeks\./)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-price-nudge]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Drop prices" }));
    expect(onOpen).toHaveBeenCalledWith(ID);
    unmount();
    render(<PriceNudgeSummary due={priceNudgeItems([planned], new Map([["planned", { sale_mode: "offers", last_price_drop_on: "2026-10-30", drop_pct: 5 }]]))} onOpen={onOpen} />);
    expect(document.querySelector("[data-price-nudge]")).toBeNull();
    vi.useRealTimers();
  });

  // Q2638 (audit 1102c R13): "Hasn't sold yet. Drop the price?" read as a warning (terracotta ink); it is a neutral hint.
  // @mutate src/components/declutter/DeclutterPriceNudge.tsx |     <p className="text-ds-13 text-muted-foreground" data-price-nudge={due.length}> |     <p className="text-ds-13 text-[hsl(var(--sienna-ink))]" data-price-nudge={due.length}>
  it("Q2638: the price nudge is in a neutral tone, not the warning ink", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    render(<PriceNudgeSummary due={[item()]} onOpen={vi.fn()} />);
    const line = document.querySelector("[data-price-nudge]") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.className).toContain("text-muted-foreground");
    expect(line.className).not.toMatch(/sienna|destructive|warning|alert/);
    vi.useRealTimers();
  });

  it("the notice's link opens the live listing once and leaves the address clean", () => {
    const open = vi.fn();
    let where = "";
    function Probe({ items }: { items: DeclutterItem[] }) {
      usePriceNudgeLink(items, open);
      where = useLocation().search;
      return null;
    }
    render(<MemoryRouter initialEntries={[priceNudgePath(ID)]}><Routes><Route path="/declutter" element={<Probe items={[item()]} />} /></Routes></MemoryRouter>);
    expect(open).toHaveBeenCalledWith(ID);
    expect(open).toHaveBeenCalledTimes(1);
    expect(where).toBe("?tab=selling");
  });

  it("Manage opens at Change price with the suggestion worked out from the lowest price as it is now", () => {
    const sheet = code("src/components/declutter/DeclutterManageListing.tsx");
    expect(sheet).toContain("initialCents={suggestDrop ? suggestedDropCents(item.current_price_cents, manage.floor_price_cents) : null}");
    expect(sheet).toContain("const [price, setPrice] = useState(centsToDollars(initialCents ?? item.current_price_cents));");
    const home = code("src/components/declutter/DeclutterHomeView.tsx");
    expect(home).toContain('startOn={suggestDrop ? "price" : "menu"}');
    expect(home).toContain("usePriceNudgeLink(mine.data, openNudge);");
    expect(home).toContain("{!searching && <PriceNudgeSummary due={priceNudgeItems(list, myDrops.data)} onOpen={openNudge} />}");
  });
});
