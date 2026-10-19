/**
 * Rentals S1 admin card (Admin -> Settings -> "Rentals: ownership proof").
 * AdminSettings.test stubs this card, so its own states are pinned here: hidden
 * while the 'rentals' switch is off, the queue's loading / empty / error states,
 * and that Approve and Reject send the property id, the decision and the note.
 * The server side (admin-only, never one's own property, reason required to
 * reject, audit log) is proven by src/test/pglite/rentalsMaintenance.pglite.mjs.
 *
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |   if (!on) return null; |
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |         <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(false)}> |         <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(true)}>
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |       {q.isError ? ( |       {false ? (
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |           open: (url, target) => window.open(url, target), |           open: () => null,
 * Landlord ID beside the proof (owner 2026-10-19):
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |         <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}> |         <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |   return [...groups.values()].filter((g) => g.id?.status === "pending_review" \|\| g.properties.length > 0); |   return [...groups.values()].filter((g) => g.properties.length > 0);
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx |         {r.back_path && <OpenFile path={r.back_path} label="Open ID (back)" />} |         {null}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  pending: [] as unknown[] | Error,
  pendingIds: [] as unknown[],
  ownerIds: [] as unknown[],
};
const reviewOwnership = vi.fn(async () => undefined);
const reviewLandlordId = vi.fn(async () => undefined);

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/components/ui/ReportErrorScreen", () => ({ ReportErrorScreen: () => <p>report</p> }));
vi.mock("@/lib/rentals/api", () => ({
  fetchPendingOwnership: async () => {
    if (state.pending instanceof Error) throw state.pending;
    return state.pending;
  },
  reviewOwnership: (...args: unknown[]) => reviewOwnership(...(args as [])),
  fetchPendingLandlordIds: async () => state.pendingIds,
  fetchLandlordIds: async (ids: string[]) => (state.ownerIds as { user_id: string }[]).filter((r) => ids.includes(r.user_id)),
  reviewLandlordId: (...args: unknown[]) => reviewLandlordId(...(args as [])),
  signedFileUrl: async () => "https://signed/x",
}));

import { RentalsOwnershipCard } from "./RentalsOwnershipCard";

const PROPERTY = {
  id: "p1",
  owner_id: "l1",
  label: "Oak Street duplex",
  street_address: "12 Oak St",
  city: "Lafayette",
  zip_code: "70501",
  ownership_proof_path: "owner/proof.pdf",
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RentalsOwnershipCard />
    </QueryClientProvider>,
  );
}

describe("RentalsOwnershipCard", () => {
  beforeEach(() => {
    state.feature = true;
    state.pending = [];
    state.pendingIds = [];
    state.ownerIds = [];
    reviewOwnership.mockClear();
    reviewLandlordId.mockClear();
  });

  it("renders nothing while the 'rentals' switch is off", () => {
    state.feature = false;
    const { container } = renderCard();
    expect(container.textContent).toBe("");
  });

  it("says when nothing is waiting", async () => {
    expect(renderCard().getByText("Rentals: ownership proof")).toBeTruthy();
    expect(await screen.findByText("Nothing waiting.")).toBeTruthy();
  });

  it("shows a load failure instead of an empty queue", async () => {
    state.pending = new Error("boom");
    renderCard();
    expect(await screen.findByText("Couldn't load the queue.")).toBeTruthy();
    expect(screen.queryByText("Nothing waiting.")).toBeNull();
  });

  it("lists a waiting property and sends approve and reject with the note", async () => {
    state.pending = [PROPERTY];
    renderCard();
    expect(await screen.findByText("Oak Street duplex")).toBeTruthy();
    expect(screen.getByText(/12 Oak St, Lafayette/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open ownership proof" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviewOwnership).toHaveBeenCalledWith("p1", true, ""));

    fireEvent.change(screen.getByLabelText("Note (required to reject)"), { target: { value: "Name on the deed differs" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(reviewOwnership).toHaveBeenLastCalledWith("p1", false, "Name on the deed differs"));
  });

  it("opens the proof tab inside the click, then points it at the signed link (Q295: WebKit blocks a tab opened after an await)", async () => {
    state.pending = [PROPERTY];
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    try {
      renderCard();
      fireEvent.click(await screen.findByRole("button", { name: "Open ownership proof" }));
      expect(open).toHaveBeenCalledWith("", "_blank");
      await waitFor(() => expect(tab.location.href).toBe("https://signed/x"));
      expect(tab.opener).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  describe("landlord ID beside the ownership proof (owner 2026-10-19)", () => {
    const ID = { user_id: "l1", status: "pending_review", front_path: "l1/landlord-id/1-front.jpg", back_path: "l1/landlord-id/1-back.jpg", review_note: null, submitted_at: "2026-10-19T01:00:00Z" };

    it("shows the ID and the proof side by side and approves / rejects the ID with its note", async () => {
      state.pending = [PROPERTY];
      state.pendingIds = [ID];
      renderCard();
      const group = await screen.findByTestId("landlord-review-group");
      expect(group.textContent).toContain("Photo ID");
      expect(group.textContent).toContain("Ownership proof");
      expect(screen.getByRole("button", { name: "Open ID (front)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open ID (back)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open ownership proof" })).toBeTruthy();
      expect(screen.getAllByTestId("landlord-review-group")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Approve ID" }));
      // The decision names the submission the admin opened (a newer photo is refused: review_changed).
      await waitFor(() => expect(reviewLandlordId).toHaveBeenCalledWith("l1", true, "", "2026-10-19T01:00:00Z"));
      expect(reviewOwnership).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("ID note (required to reject)"), { target: { value: "Photo is blurry" } });
      fireEvent.click(screen.getByRole("button", { name: "Reject ID" }));
      await waitFor(() => expect(reviewLandlordId).toHaveBeenLastCalledWith("l1", false, "Photo is blurry", "2026-10-19T01:00:00Z"));
    });

    it("an ID waiting with no proof waiting still shows (a new photo after a rejection)", async () => {
      state.pendingIds = [ID];
      renderCard();
      expect(await screen.findByRole("button", { name: "Approve ID" })).toBeTruthy();
      expect(screen.getByText("No proof waiting.")).toBeTruthy();
    });

    it("a proof whose landlord's ID is already approved shows the ID status, no ID buttons", async () => {
      state.pending = [PROPERTY];
      state.ownerIds = [{ ...ID, status: "approved" }];
      renderCard();
      expect(await screen.findByText("ID approved.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve ID" })).toBeNull();
    });
  });
});
