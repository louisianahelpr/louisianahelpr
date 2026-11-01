/**
 * Board 164, the buyer's view of a moving sale (the banner on the seller's
 * profile): the area and move-out line, each item's price in rust over its
 * title, and "Share sale" sharing the profile where the sale lives. Never an address.
 *
 * @mutate src/components/declutter/MovingSaleBanner.tsx | url: `${getPublicOrigin()}/user/${sellerId}` | url: getPublicOrigin()
 * Q2269: the seller's sale name and dates; "Follow sale" watches every item (the price-drop alert), never on your own sale.
 * @mutate src/components/declutter/MovingSaleBanner.tsx | {sale.data.saleName ?? "Moving sale"} | Moving sale
 * @mutate src/components/declutter/MovingSaleBanner.tsx |   const canFollow = on && !!user && user.id !== sellerId; |   const canFollow = on && !!user;
 * @mutate src/components/declutter/MovingSaleBanner.tsx |       const todo = ids.filter((id) => (watching.data?.has(id) ?? false) !== next); |       const todo = ids.slice(0, 1);
 * @mutate src/components/declutter/MovingSaleBanner.tsx |             if (code !== "item_not_found" && code !== "own_item" && code !== "item_not_available") throw err; |             throw err;
 * @mutate src/components/declutter/MovingSaleBanner.tsx |   const area = areas.size === 1 ? [...areas][0] : null; |   const area = [...areas][0] ?? null;
 * @mutate src/components/declutter/MovingSaleBanner.tsx | <p className="text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(it.current_price_cents)}</p> | <p className="text-ds-15 font-bold tabular-nums">{itemPriceLabel(it.current_price_cents)}</p>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const shared: unknown[] = [];
const watchCalls: [string, boolean][] = [];
const viewer = { id: "u9" as string | null };
const watched = new Set<string>();
const sold = new Set<string>();
const toasts = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
const sale = { moveOutOn: "2026-11-01", saleName: null as string | null, startsOn: null as string | null, more: false, items: [] as Record<string, unknown>[] };
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/authRedirects", () => ({ getPublicOrigin: () => "https://louisianahelpr.com" }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: async (c: unknown) => { shared.push(c); return "shared"; } }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: viewer.id ? { id: viewer.id } : null }) }));
vi.mock("@/lib/declutter/api", () => ({
  fetchPhotos: async () => [],
  photoPublicUrl: (p: string) => p, photoCardUrl: (p: string) => p, CARD_PHOTO_PX: 480,
  fetchWatching: async () => new Set(watched),
  setWatch: async (id: string, on: boolean) => {
    watchCalls.push([id, on]);
    if (sold.has(id)) throw new Error("item_not_found");
    if (on) watched.add(id); else watched.delete(id);
    return on ? "watching" : "not_watching";
  },
}));
vi.mock("@/lib/declutter/movingSale", () => ({
  fetchSellerMovingSale: async () => sale,
  louisianaToday: () => "2026-10-20",
  movingSaleWhen: (start: string | null) => (start ? "Oct 30 – Nov 1 · 2 items for sale" : "Moving out Nov 1. 2 items for sale."),
}));

import { MovingSaleBanner } from "./MovingSaleBanner";

const item = (id: string, title: string, cents: number, area = "Delcambre") => ({ id, title, current_price_cents: cents, area_label: area, category: "furniture", status: "live" });

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MovingSaleBanner sellerId="s1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  shared.length = 0;
  watchCalls.length = 0;
  watched.clear();
  sold.clear();
  toasts.mockClear();
  toasts.error.mockClear();
  viewer.id = "u9";
  sale.saleName = null;
  sale.startsOn = null;
  sale.items = [item("a", "Sofa, 3 seat", 12000), item("b", "Dining table", 9000)];
});

describe("board 164: the moving sale, as a buyer sees it", () => {
  it("area + move-out line, rust prices over titles, Share sale shares the profile", async () => {
    renderIt();
    expect(await screen.findByText("Delcambre · Moving out Nov 1. 2 items for sale.")).toBeInTheDocument();
    const price = screen.getByText("$120");
    expect(price.className).toContain("--burnt-sienna");
    expect(price.nextElementSibling?.textContent).toBe("Sofa, 3 seat");
    fireEvent.click(screen.getByRole("button", { name: "Share sale" }));
    await waitFor(() => expect(shared).toEqual([expect.objectContaining({ url: "https://louisianahelpr.com/user/s1" })]));
  });

  it("items in different areas: no area in the line", async () => {
    sale.items = [item("a", "Sofa", 12000, "Delcambre"), item("b", "Table", 9000, "Erath")];
    renderIt();
    expect(await screen.findByText("Moving out Nov 1. 2 items for sale.")).toBeInTheDocument();
  });

  it("Q2269: the seller's name and dates; Follow sale watches every item, then reads Following", async () => {
    sale.saleName = "Moving to Lafayette · everything goes";
    sale.startsOn = "2026-10-30";
    renderIt();
    expect(await screen.findByRole("heading", { name: "Moving to Lafayette · everything goes" })).toBeInTheDocument();
    expect(screen.getByText("Delcambre · Oct 30 – Nov 1 · 2 items for sale")).toBeInTheDocument();
    expect(screen.getByText(/so you're told if their prices drop\. Items added later aren't included\./)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Follow sale" }));
    await waitFor(() => expect(watchCalls).toEqual([["a", true], ["b", true]]));
    expect(await screen.findByRole("button", { name: "Following" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Q2269 review #5: an item that sold since the page loaded is skipped, never a stop, and the toast says so", async () => {
    sold.add("a");
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Follow sale" }));
    await waitFor(() => expect(toasts).toHaveBeenCalledWith("Following 1 of 2 items. The others aren't for sale anymore."));
    expect(watchCalls.map(([id]) => id).sort()).toEqual(["a", "b"]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("Q2269: no Follow on your own sale, nor signed out", async () => {
    viewer.id = "s1";
    const { unmount } = renderIt();
    expect(await screen.findByRole("button", { name: "Share sale" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Follow/ })).toBeNull();
    unmount();
    viewer.id = null;
    renderIt();
    expect(await screen.findByRole("button", { name: "Share sale" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Follow/ })).toBeNull();
  });
});
