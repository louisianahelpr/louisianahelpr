/**
 * Board 192, after listing: "Copy link for local groups" and the link-card
 * preview, on board 80's What next sheet. Only a LIVE listing is shareable
 * (never paused or in review); the link is the item's public page; the card
 * shows the area, never an address.
 *
 * @mutate src/components/declutter/ListedWhatNext.tsx |   const shareable = live && it.status === "live"; |   const shareable = true;
 * @mutate src/components/declutter/DeclutterShareCard.tsx | const listingLink = (id: string) => `${getPublicOrigin()}/declutter/item/${id}`; | const listingLink = (id: string) => `${getPublicOrigin()}/declutter`;
 * @mutate src/components/declutter/DeclutterShareCard.tsx | <p className="truncate text-ds-13 text-muted-foreground">{item.area_label} · on Louisiana Helpr</p> | <p className="truncate text-ds-13 text-muted-foreground">on Louisiana Helpr</p>
 * @mutate src/components/declutter/DeclutterShareCard.tsx |   if (await copyToClipboard(url)) { |   if (false) {
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const copied: string[] = [];
const shared: unknown[] = [];
let clipboardOk = true;
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
// LEAD-TOAST3: "Link copied" is the bare toast(), so the mock must be callable.
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/authRedirects", () => ({ getPublicOrigin: () => "https://louisianahelpr.com" }));
vi.mock("@/lib/nativeShare", () => ({
  copyToClipboard: async (t: string) => { copied.push(t); return clipboardOk; },
  shareNative: async (c: unknown) => { shared.push(c); return "shared"; },
}));
const items: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async (id: string) => items[id] ?? null,
  fetchItemDropState: async () => ({ sale_mode: "fixed", last_price_drop_on: null }),
  fetchPhotos: async () => [{ storage_path: "u1/declutter/a/1.jpg" }],
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
}));

import { toast } from "sonner";
import { ListedWhatNext } from "./ListedWhatNext";

function renderListed(itemId: string, status: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: "/declutter", search: "?view=selling", state: { justListed: { itemId, status } } }]}>
        <ListedWhatNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const LAMP = { id: "a", title: "Mid-century lamp", status: "live", sale_mode: "fixed", category: "home", area_label: "Delcambre", current_price_cents: 4000, live_at: new Date().toISOString() };

beforeEach(() => {
  copied.length = 0;
  shared.length = 0;
  clipboardOk = true;
});

describe("board 192: share after listing", () => {
  it("live: the link card shows title, price and area (no address), and the button copies the item's public link", async () => {
    items.a = { ...LAMP, pickup_address: "1234 Example St" };
    renderListed("a", "live");
    const card = await screen.findByRole("group", { name: "Preview of the link" });
    expect(card.textContent).toContain("Mid-century lamp · $40");
    expect(card.textContent).toContain("Delcambre · on Louisiana Helpr");
    expect(card.textContent).not.toContain("Example St");
    fireEvent.click(within(screen.getByTestId("what-next-sheet")).getByRole("button", { name: "Copy link for local groups" }));
    await waitFor(() => expect(copied).toEqual(["https://louisianahelpr.com/declutter/item/a"]));
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith("Link copied. Paste it in your local groups."));
    expect(shared).toEqual([]);
  });

  it("clipboard refused: falls back to the share path with the same link", async () => {
    clipboardOk = false;
    items.a = LAMP;
    renderListed("a", "live");
    fireEvent.click(await screen.findByRole("button", { name: "Copy link for local groups" }));
    await waitFor(() => expect(shared).toEqual([expect.objectContaining({ url: "https://louisianahelpr.com/declutter/item/a" })]));
  });

  it("in review or paused: nothing to share", async () => {
    items.r = { ...LAMP, id: "r", status: "pending_review" };
    const { unmount } = renderListed("r", "pending_review");
    expect(await screen.findByRole("heading", { name: "Sent for a review" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy link for local groups" })).toBeNull();
    unmount();
    items.p = { ...LAMP, id: "p", status: "paused" };
    renderListed("p", "live");
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy link for local groups" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Preview of the link" })).toBeNull();
  });
});
