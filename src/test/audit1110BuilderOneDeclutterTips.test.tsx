/**
 * Whole-app audit 11-10, Builder 1 (W3 F343, W4 F400): two Declutter screens whose helper text read as noise.
 *
 *  F343 — Moving out sale opened with Sell a bunch's intro word for word, so a first-timer could not tell what was
 *         different; and the "Hire a Helpr for moving day" line only appeared after a date was picked. The intro now
 *         says what a move-out date does, and the moving-day help sits under the date from the start (its links fall
 *         back to a dateless moving job: movingDayPostJobPath("") is ?movingDay=1).
 *  F400 — "Not selling? In 12 days you can have a Helpr haul it away." sat under every one of nine listings, free
 *         mason jars included (a free item cannot "sell"). The tip is drawn once at the top of Your listings, with the
 *         soonest day count; when every waiting item is free it says "Nobody's claimed it?" instead.
 *
 * @mutate src/components/declutter/DeclutterBunchView.tsx | export const bunchIntro = (moving: boolean) => (moving ? t("lp.mv.intro") : t("lp.bv.intro")); | export const bunchIntro = (moving: boolean) => (moving ? t("lp.bv.intro") : t("lp.bv.intro"));
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |   const waiting = rows.filter((r) => r.state === "too_soon"); |   const waiting = rows.filter((r) => r.state === "too_soon").slice(0, 0);
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |   const allFree = waiting.every((r) => isFree(r.item_id)); |   const allFree = false;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";

vi.mock("@/lib/declutter/moves", () => ({
  fetchMyMoveItems: vi.fn(async () => []),
  fetchMyMoveOutDate: vi.fn(async () => null),
  formatMoveDate: (d: string) => d,
  moveDateProblem: () => null,
  setMoveOutDate: vi.fn(),
}));
vi.mock("@/components/declutter/DeclutterMovingSaleDetails", () => ({ MovingSaleDetails: () => null }));
vi.mock("@/components/declutter/DeclutterDonate", () => ({ DonatePicker: () => null, DonationReceipts: () => null }));

import { BunchMovingSale } from "@/components/declutter/DeclutterBunchMovingSale";
import { HaulAwayItemLine, HaulAwayTooSoonTip } from "@/components/declutter/DeclutterHaulAway";

afterEach(cleanup);
const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8")).replace(/\s+/g, " ");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("F343: Moving out sale reads as its own thing", () => {
  it("the Sell a bunch page picks a moving-sale intro when moving, and the two intros differ", async () => {
    const mod = await import("@/components/declutter/DeclutterBunchMovingSale");
    expect(mod.bunchIntro(true)).toMatch(/^Moving\? /);
    expect(mod.bunchIntro(true)).toContain("move-out date");
    expect(mod.bunchIntro(true)).not.toBe(mod.bunchIntro(false));
    expect(code("src/components/declutter/DeclutterBunchView.tsx")).toContain("{bunchIntro(moving)}");
  });
  it("the moving-day help shows under the date before any date is picked, linking a dateless moving job", async () => {
    wrap(<BunchMovingSale userId="u1" date="" setDate={() => {}} today="2026-11-10" />);
    expect(document.querySelector("[data-bunch-moving-day]")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hire a Helpr for moving day" }).getAttribute("href")).toBe("/post-job?movingDay=1");
    // No sale yet: End the moving sale stays off.
    expect(screen.queryByRole("button", { name: "End the moving sale" })).toBeNull();
  });
});

const row = (p: Partial<HaulAwayRow>): HaulAwayRow => ({
  item_id: "i1", title: "Jars", description: "", delivery_size: "small", item_status: "live", state: "too_soon",
  eligible_at: new Date(Date.now() + 12 * 86_400_000 - 60_000).toISOString(), job_id: null, pickup_group: "g", photo_paths: [], hold: null, ...p,
} as HaulAwayRow);

describe("F400: the haul-away tip is said once, and free items are not told to sell", () => {
  it("a too-soon row draws no line of its own any more", () => {
    const { container } = wrap(<HaulAwayItemLine row={row({})} />);
    expect(container.textContent).toBe("");
  });
  it("one tip at the top, with the soonest day count", () => {
    wrap(<HaulAwayTooSoonTip rows={[row({ item_id: "a" }), row({ item_id: "b", eligible_at: new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString() }), row({ item_id: "c", state: "eligible" })]} isFree={() => false} />);
    const tips = document.querySelectorAll("[data-haul-tip='too_soon']");
    expect(tips.length).toBe(1);
    expect(tips[0].textContent).toBe("Not selling? In 3 days you can have a Helpr haul away what hasn't sold.");
  });
  it("free items only: asks whether anyone claimed it; nothing waiting: no tip", () => {
    wrap(<HaulAwayTooSoonTip rows={[row({ item_id: "a" })]} isFree={(id) => id === "a"} />);
    expect(document.querySelector("[data-haul-tip='too_soon']")?.textContent).toBe("Nobody's claimed it? In 12 days you can have a Helpr haul it away.");
    cleanup();
    const { container } = wrap(<HaulAwayTooSoonTip rows={[row({ state: "eligible" })]} isFree={() => false} />);
    expect(container.textContent).toBe("");
  });
  it("Your listings mounts the tip once, above the list, fed by the free flag", () => {
    const src = code("src/components/declutter/DeclutterHomeView.tsx");
    expect(src).toContain("<HaulAwayTooSoonTip rows={haul.data?.rows ?? []} isFree={(id) => freeIds.has(id)} />");
    expect(src.indexOf("<HaulAwayTooSoonTip")).toBeLessThan(src.indexOf("data-selling-list"));
  });
});
