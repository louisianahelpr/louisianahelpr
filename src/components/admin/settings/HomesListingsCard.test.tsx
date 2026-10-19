/**
 * Admin -> Settings, Homes listings (Q2187; lead: must ship before Homes opens). The server side (admin
 * only, live/paused only, the whole property, audited, never switch-gated, the lift) is proven by
 * src/test/pglite/homesPublicLink.pglite.mjs; this pins the card: it is NOT switch-gated, lists what to
 * take down and what to lift, needs a reason / note, and sends the right ids.
 *
 * @mutate src/components/admin/settings/HomesListingsCard.tsx |     mutationFn: () => adminRemoveListing(l.id, reason.trim()), |     mutationFn: () => adminRemoveListing("x", reason.trim()),
 * @mutate src/components/admin/settings/HomesListingsCard.tsx |       <Button size="sm" variant="outline" disabled={m.isPending \|\| reason.trim().length < 5} onClick={() => m.mutate()}> |       <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>
 * @mutate src/components/admin/settings/HomesListingsCard.tsx |     mutationFn: () => adminLiftTakedown(t.property_id, note.trim()), |     mutationFn: () => adminLiftTakedown("x", note.trim()),
 * @mutate src/components/admin/settings/HomesListingsCard.tsx |     setQuery(draft.trim()); |     setQuery("");
 * @mutate src/components/admin/settings/HomesListingsCard.tsx | onClick={() => onMove(offset + size)} | onClick={() => onMove(offset)}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const page = (o: Record<string, unknown> = {}) => ({ open: [] as unknown[], open_total: 0, taken_down: [] as unknown[], taken_down_total: 0, page_size: 25, ...o });
const state = { data: page() as unknown };
const fetchAdminListings = vi.fn(async (..._a: unknown[]) => {
  if (state.data instanceof Error) throw state.data;
  return state.data;
});
const adminRemoveListing = vi.fn(async () => undefined);
const adminLiftTakedown = vi.fn(async () => undefined);
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/components/ui/ReportErrorScreen", () => ({ ReportErrorScreen: () => <p>report</p> }));
vi.mock("@/lib/rentals/listings", () => ({
  fetchAdminListings: (...a: unknown[]) => fetchAdminListings(...a),
  adminRemoveListing: (...a: unknown[]) => adminRemoveListing(...(a as [])),
  adminLiftTakedown: (...a: unknown[]) => adminLiftTakedown(...(a as [])),
}));

import { HomesListingsCard } from "./HomesListingsCard";

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HomesListingsCard />
    </QueryClientProvider>,
  );

describe("HomesListingsCard", () => {
  beforeEach(() => {
    state.data = page();
    fetchAdminListings.mockClear();
    adminRemoveListing.mockClear();
    adminLiftTakedown.mockClear();
  });

  it("shows even with the Homes switch off (moderation is never gated), with friendly empties", async () => {
    renderCard();
    expect(await screen.findByText("No live or paused listings.")).toBeTruthy();
    expect(screen.getByText("Nothing taken down.")).toBeTruthy();
  });

  it("takes a listing down only with a reason, sending its id", async () => {
    state.data = page({ open: [{ id: "l1", kind: "rent", status: "live", headline: "Bright 2 bed", slug: "abc", published_at: null, property_label: "Oak", city: "Lafayette", zip_code: "70501" }], open_total: 1 });
    renderCard();
    const btn = await screen.findByRole("button", { name: "Take down" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason to take down Bright 2 bed"), { target: { value: "Fake photos here" } });
    fireEvent.click(btn);
    await waitFor(() => expect(adminRemoveListing).toHaveBeenCalledWith("l1", "Fake photos here"));
  });

  it("lifts a take-down only with a note, sending the property id", async () => {
    state.data = page({ taken_down: [{ property_id: "p9", property_label: "Elm house", city: "Lafayette", zip_code: "70503", reason: "Fake photos.", taken_down_at: "2026-10-19T07:00:00Z" }], taken_down_total: 1 });
    renderCard();
    expect(await screen.findByText("Reason: Fake photos.")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Lift take-down" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Note to lift the take-down of Elm house"), { target: { value: "Removed by mistake" } });
    fireEvent.click(btn);
    await waitFor(() => expect(adminLiftTakedown).toHaveBeenCalledWith("p9", "Removed by mistake"));
  });

  it("round 4 #5: searches by what the admin types, from the first page", async () => {
    renderCard();
    await screen.findByText("No live or paused listings.");
    fireEvent.change(screen.getByLabelText("Search Homes listings"), { target: { value: " 70501 " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchAdminListings).toHaveBeenLastCalledWith("70501", 0, 0));
    expect(await screen.findByText("No live or paused listing matches.")).toBeTruthy();
  });

  it("round 4 #5: pages past the first 25 (no dead end), with a total", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, kind: "rent", status: "live", headline: `Home ${i}`, slug: `s${i}`, published_at: null, property_label: "Oak", city: "Lafayette", zip_code: "70501" }));
    state.data = page({ open: rows, open_total: 30 });
    renderCard();
    expect(await screen.findByText("1–25 of 30")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous live and paused" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next live and paused" }));
    await waitFor(() => expect(fetchAdminListings).toHaveBeenLastCalledWith("", 25, 0));
  });

  it("a failed load says so", async () => {
    state.data = new Error("boom");
    renderCard();
    expect(await screen.findByText("Couldn't load the listings.")).toBeTruthy();
  });
});
