/**
 * Board 158: the Manage a listing sheet and the paused card. Each row makes the
 * one real call (migration 20261020064354_declutter_manage_listing.sql; its
 * backend proof is ~/.lh-pglite/b3b-manage-listing.mjs, PGlite 3x), and the
 * rows the server can't do yet ("Edit listing" for a live item) are not shown.
 *
 * @mutate src/components/declutter/DeclutterManageListing.tsx |   const deployed = state.data !== "not_deployed"; |   const deployed = true;
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                   onCheckedChange={(on) => drops.mutate(!on)} |                   onCheckedChange={(on) => drops.mutate(on)}
 * @mutate src/components/declutter/DeclutterManageListing.tsx |       if (relist) await relistListing(item.id); |
 * @mutate src/components/declutter/DeclutterManageListing.tsx |         if (!problem) save.mutate(undefined); |         save.mutate(undefined);
 * @mutate src/components/declutter/DeclutterManageListing.tsx |       : priceCents > item.price_cents | : false
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                   <RowText title="Pause listing">Hide it without losing it. Open offers close.</RowText> |                   <RowText title="Pause listing">Hide it without losing it.</RowText>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: unknown[][] = [];
const manage = { floor_price_cents: 3000, drops_stopped: false };
let deployed = true;
const stateReads = vi.hoisted(() => ({ n: 0 }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/api", () => ({
  // Records that the manage-state read RESOLVED, so a test can wait for the data before asserting an absence.
  fetchManageState: async () => { const r = deployed ? manage : "not_deployed"; stateReads.n++; return r; },
  setListingPrice: async (...a: unknown[]) => { calls.push(["price", ...a]); return a[1]; },
  setListingDrops: async (...a: unknown[]) => { calls.push(["drops", ...a]); return a[1]; },
  pauseListing: async (...a: unknown[]) => { calls.push(["pause", ...a]); return "paused"; },
  relistListing: async (...a: unknown[]) => { calls.push(["relist", ...a]); return "live"; },
  withdrawItem: async (...a: unknown[]) => { calls.push(["withdraw", ...a]); },
}));

import { ManageListingSheet, SellerListingPanel } from "./DeclutterManageListing";

const item = (over: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "me", status: "live", title: "Mid-century lamp", description: "", category: "home_decor",
  condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 3800, area_label: "Delcambre",
  area_lat: 29.9, area_lng: -91.9, created_at: "2026-10-18T00:00:00Z", porch_ok: true, ...over,
});
function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const sheet = (over: Record<string, unknown> = {}) =>
  wrap(<ManageListingSheet item={item(over) as never} coverUrl={null} open onOpenChange={() => {}} />);

beforeEach(() => {
  calls.length = 0;
  manage.drops_stopped = false;
  deployed = true;
});

describe("Manage a listing (board 158)", () => {
  it("shows only the rows the server can do, with the real price and lowest price", async () => {
    sheet();
    expect(await screen.findByText("Now $38 · lowest $30")).toBeTruthy();
    for (const t of ["Change price or lowest price", "Stop price drops", "Pause listing", "Mark sold elsewhere", "Delete listing"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.queryByText("Edit listing")).toBeNull();
    expect(screen.getByText("Hide it without losing it. Open offers close.")).toBeTruthy();
  });

  it("before the migration reaches prod, only taking it down is offered", async () => {
    deployed = false;
    sheet();
    expect(await screen.findByText("Mark sold elsewhere")).toBeTruthy();
    // Wait for the DATA (the manage-state read resolved and React settled), then assert the absence.
    await waitFor(() => expect(stateReads.n).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByText("Change price or lowest price")).toBeNull();
    expect(screen.queryByText("Stop price drops")).toBeNull();
    expect(screen.queryByText("Pause listing")).toBeNull();
    expect(screen.getByText("Delete listing")).toBeTruthy();
  });

  it("the switch stops the drops (on = stopped)", async () => {
    sheet();
    const sw = await screen.findByRole("switch", { name: "Stop price drops" });
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    await waitFor(() => expect(calls).toContainEqual(["drops", "i1", false]));
  });

  it("pause calls pause; a paused listing offers Relist instead", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Pause listing"));
    await waitFor(() => expect(calls).toContainEqual(["pause", "i1"]));
    calls.length = 0;
    sheet({ status: "paused" });
    expect(screen.queryAllByText("Pause listing").length).toBeGreaterThan(0); // the first sheet is still mounted
    fireEvent.click(screen.getAllByText("Relist")[0]);
    await waitFor(() => expect(calls).toContainEqual(["relist", "i1"]));
  });

  it("delete and sold-elsewhere ask first, then take it down", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Delete listing"));
    expect(calls).toEqual([]);
    expect(screen.getByText(/This can't be undone/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete listing" }));
    await waitFor(() => expect(calls).toContainEqual(["withdraw", "i1"]));
  });

  it("a lowest price above the price is refused before any call", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Change price or lowest price"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(calls).toContainEqual(["price", "i1", 2500, 2000]));
  });
});

describe("Never above the listed price (authz/money review, 2026-10-20)", () => {
  it("a price above the one it was listed at is refused before any call (no fake 'was' price)", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Change price or lowest price"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/raise it back up to \$40/);
    expect(calls).toEqual([]);
  });
});

describe("Paused card (board 158)", () => {
  it("Relist puts it back; Relist at a new price saves the price THEN relists", async () => {
    wrap(<SellerListingPanel item={item({ status: "paused" }) as never} coverUrl={null} />);
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Relist" }));
    await waitFor(() => expect(calls).toContainEqual(["relist", "i1"]));
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Relist at a new price" }));
    const price = await screen.findByLabelText("Price");
    await waitFor(() => expect((screen.getByLabelText("Lowest you'll take") as HTMLInputElement).value).toBe("30"));
    fireEvent.change(price, { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Relist at this price" }));
    await waitFor(() => expect(calls).toEqual([["price", "i1", 3500, 3000], ["relist", "i1"]]));
  });

  it("a live listing gets one Manage listing button", () => {
    wrap(<SellerListingPanel item={item() as never} coverUrl={null} />);
    expect(screen.getByRole("button", { name: "Manage listing" })).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
  });
});
