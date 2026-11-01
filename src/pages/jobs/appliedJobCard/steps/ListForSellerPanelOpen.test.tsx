import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * LEAD-LIST-FOR-SELLER follow-ups (B55 handoff b, and the 375 check):
 *  - the Helpr can EDIT an unsent draft: Edit opens the form filled with that listing, and Save changes calls
 *    declutter_helpr_update_listing (helprUpdateListing) for that item, never create;
 *  - Send and Add come BEFORE the list, so on a phone they are on screen without scrolling past every listing
 *    (b55's helpr-list-for-seller-375.png had both under the bottom bar);
 *  - the Helpr reads when the job is done: once the listings are SENT for approval (SellForMeDoneNote), not when live.
 *
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx |         await helprUpdateListing(id, fields); |         await helprCreateListing(jobId, fields, "x");
 * @mutate src/pages/jobs/appliedJobCard/steps/ListForSellerPanelOpen.tsx |                     onClick={() => setEditingId(r.item_id)}>Edit</Button> |                     onClick={() => setAdding(true)}>Edit</Button>
 * @mutate src/lib/declutter/sellForMe.ts | once you've sent the listings to the seller for approval. | once the seller's listings are live on Declutter.
 */
const lib = vi.hoisted(() => ({
  fetchHelprJobListings: vi.fn(),
  helprCreateListing: vi.fn(),
  helprUpdateListing: vi.fn(),
  helprDeleteListing: vi.fn(),
  helprSendListings: vi.fn(),
  helprUploadListingPhoto: vi.fn(),
}));
vi.mock("@/lib/declutter/listForSeller", () => lib);
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "helpr-1" } }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import ListForSellerPanelOpen from "./ListForSellerPanelOpen";
import { SellForMeDoneNote } from "./PayoutPrimary";
import { SELL_FOR_ME_DONE_NOTE } from "@/lib/declutter/sellForMe";

const row = (over: Record<string, unknown> = {}) => ({
  item_id: "item-1", title: "Oak dresser", description: "Six drawers", category: "furniture", condition_stars: 4,
  delivery_size: "large", price_cents: 15000, floor_price_cents: 9000, area_label: "Mid City", status: "draft",
  photo_count: 2, sent_at: null, ...over,
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListForSellerPanelOpen jobId="job-1" job={{ category: "declutter_help" }} posterName="Ann Guidry" />
    </QueryClientProvider>,
  );

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("the Helpr's list-for-seller panel", () => {
  it("Edit opens the draft's own values and saves through the update RPC", async () => {
    lib.fetchHelprJobListings.mockResolvedValue([row(), row({ item_id: "item-2", title: "Brass lamp", status: "pending_seller_approval" })]);
    lib.helprUpdateListing.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Oak dresser" }));
    expect(screen.queryByRole("button", { name: "Edit Brass lamp" })).toBeNull(); // a sent one can't be edited
    const form = screen.getByRole("form", { name: "Edit Oak dresser" });
    expect((screen.getByDisplayValue("Oak dresser") as HTMLInputElement).form).toBe(form);
    expect(screen.getByDisplayValue("150")).toBeTruthy();
    expect(screen.getByDisplayValue("90")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("150"), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(lib.helprUpdateListing).toHaveBeenCalledTimes(1));
    expect(lib.helprUpdateListing).toHaveBeenCalledWith("item-1", expect.objectContaining({
      title: "Oak dresser", priceCents: 14000, floorPriceCents: 9000, category: "furniture", conditionStars: 4, deliverySize: "large",
    }));
    expect(lib.helprCreateListing).not.toHaveBeenCalled();
  });

  it("Send and Add come before the list (on screen at 375 without scrolling past it)", async () => {
    lib.fetchHelprJobListings.mockResolvedValue([row(), row({ item_id: "item-2", title: "Brass lamp" })]);
    const { container } = mount();
    const send = await screen.findByRole("button", { name: "Send all 2 to Ann for approval" });
    const add = screen.getByRole("button", { name: "Add listing for Ann" });
    const list = container.querySelector("ul")!;
    expect(list).toBeTruthy();
    for (const b of [send, add]) expect(b.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the done note", () => {
  it("says done once SENT for approval, on a Have a Helpr list it job only, and not after done", () => {
    expect(SELL_FOR_ME_DONE_NOTE).toMatch(/sent the listings to the seller for approval/);
    expect(SELL_FOR_ME_DONE_NOTE).not.toMatch(/live/);
    render(<SellForMeDoneNote job={{ category: "declutter_help" }} />);
    expect(screen.getByText(SELL_FOR_ME_DONE_NOTE)).toBeTruthy();
    cleanup();
    const other = render(<SellForMeDoneNote job={{ category: "yard_work" }} />);
    expect(other.container.textContent).toBe("");
    cleanup();
    const done = render(<SellForMeDoneNote job={{ category: "declutter_help", helper_completed_at: "2026-11-01T00:00:00Z" }} />);
    expect(done.container.textContent).toBe("");
  });
});
