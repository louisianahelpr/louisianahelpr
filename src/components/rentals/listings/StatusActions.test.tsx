/**
 * A lister's FIRST listing waits for an admin before it shows (owner 2026-10-19, Q2234). The server side (it
 * stays a draft, nothing reads it, the admin decides about what they saw) is proven by
 * src/test/pglite/homesFirstListingReview.pglite.mjs; this pins what the owner sees: the toast never says
 * "showing" for a listing sent to review, a waiting listing offers no second Publish, a sent-back one shows
 * the admin's reason and a "Send it again".
 *
 * @mutate src/components/rentals/listings/editorParts.tsx |         outcome === "review" |         outcome === "never"
 * @mutate src/components/rentals/listings/editorParts.tsx |   const waiting = listing.status !== "live" && listing.first_review === "pending_review"; |   const waiting = false;
 * @mutate src/components/rentals/listings/editorParts.tsx |       {sentBack && ( |       {false && (
 * @mutate src/components/rentals/listings/editorParts.tsx | sentBack ? "Send it again" : "Show my listing" | "Show my listing"
 * @mutate src/lib/rentals/listingCopy.ts |   if (l.status !== "live" && l.first_review === "pending_review") return "Waiting for review"; |   if (false) return "Waiting for review";
 * @mutate src/lib/rentals/listings.ts |   return row && row.status !== "live" && row.first_review === "pending_review" ? "review" : "done"; |   return "done";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { RentalListing } from "@/lib/rentals/listings";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

const db: { rpcError: unknown; row: Record<string, unknown> | null } = { rpcError: null, row: null };
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: null, error: db.rpcError }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }) }),
  },
}));

import { StatusActions } from "./editorParts";

const LISTING = (o: Partial<RentalListing> = {}): RentalListing =>
  ({
    id: "l1",
    kind: "rent",
    status: "draft",
    expires_at: null,
    first_review: null,
    first_review_note: null,
    first_review_submitted_at: null,
    first_review_decided_at: null,
    ...o,
  }) as unknown as RentalListing;

const renderIt = (l: RentalListing) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StatusActions listing={l} />
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("StatusActions: the first-listing review (Q2234)", () => {
  beforeEach(() => {
    db.rpcError = null;
    db.row = null;
    rpc.mockClear();
    toastSuccess.mockClear();
  });

  it("a first listing sent to review says so, never that it is showing", async () => {
    db.row = { status: "draft", first_review: "pending_review" };
    renderIt(LISTING());
    fireEvent.click(screen.getByRole("button", { name: "Show my listing" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("rentals_set_listing_status", { p_listing_id: "l1", p_status: "live" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent for review. We'll let you know when it's live."));
  });

  it("a trusted lister's listing that went live gets the usual toast", async () => {
    db.row = { status: "live", first_review: null };
    renderIt(LISTING());
    fireEvent.click(screen.getByRole("button", { name: "Show my listing" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Your listing is showing for 30 days."));
  });

  it("while it waits: the status says so, a line explains, and there is no second Publish", () => {
    renderIt(LISTING({ first_review: "pending_review" } as Partial<RentalListing>));
    expect(screen.getByText("Status: Waiting for review")).toBeTruthy();
    expect(screen.getByTestId("first-listing-waiting").textContent).toContain("checks everyone's first listing before it shows");
    expect(screen.queryByRole("button", { name: "Show my listing" })).toBeNull();
  });

  it("sent back: the admin's reason and Send it again", () => {
    renderIt(LISTING({ first_review: "rejected", first_review_note: "Photo 3 shows a different house." } as Partial<RentalListing>));
    expect(screen.getByText("Status: Needs a change")).toBeTruthy();
    expect(screen.getByTestId("first-listing-sent-back").textContent).toContain("Photo 3 shows a different house.");
    expect(screen.getByRole("button", { name: "Send it again" })).toBeTruthy();
  });
});
