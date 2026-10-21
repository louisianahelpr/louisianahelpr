/**
 * Q2269 mount: the move page (/declutter/move: DeclutterMovePage, its two switch gates, then MoveFlow) shows the
 * sale-details form once the seller has a move-out date, and hands it that date as the last day a sale can
 * start. movingSaleDetails.test.tsx renders the form alone; this renders the route page that mounts it, with
 * both hidden switches on. Every read is stubbed (no network).
 *
 * @mutate src/components/declutter/DeclutterMoveView.tsx |         {user && current && <MovingSaleDetails userId={user.id} moveOutOn={current} today={today} />} |
 * @mutate src/components/declutter/DeclutterMoveView.tsx | <MovingSaleDetails userId={user.id} moveOutOn={current} today={today} /> | <MovingSaleDetails userId={user.id} moveOutOn={today} today={today} />
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { moveOutOn: "2026-11-01" as string | null };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => null }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, max, onChange }: { id: string; value: string; max?: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} max={max} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => null }));
vi.mock("@/lib/declutter/api", () => ({
  fetchHasAgreedSales: async () => false,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => [],
  setPickupWindows: async () => undefined,
}));
vi.mock("@/lib/declutter/moves", async (orig) => ({
  ...(await orig<object>()),
  fetchMyMoveItems: async () => [],
  fetchMyMoveOutDate: async () => state.moveOutOn,
  fetchMyMovingSale: async () => ({ saleName: "Moving to Lafayette", startsOn: null }),
  setMovingSale: async () => 0,
  setMoveOutDate: async () => 0,
  createMoveDrafts: async () => [],
  publishMany: async () => [],
  scanRoom: async () => [],
}));

import DeclutterMovePage from "@/pages/declutter/DeclutterMovePage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeclutterMovePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  state.moveOutOn = "2026-11-01";
});

describe("the move page mounts the sale details (Q2269)", () => {
  it("with a move-out date saved, the sale-details form shows the saved name and ends on that date", async () => {
    renderPage();
    const name = await screen.findByLabelText(/Sale name/);
    await waitFor(() => expect(name).toHaveValue("Moving to Lafayette"));
    expect(screen.getByLabelText(/Sale starts/)).toHaveAttribute("max", "2026-11-01");
    expect(screen.getByRole("button", { name: "Save sale details" })).toBeInTheDocument();
  });

  it("with no move-out date yet, there is no sale to name", async () => {
    state.moveOutOn = null;
    const qc = renderPage();
    // Wait for the move-date read itself to answer, so "absent" is not just "not loaded yet".
    await waitFor(() => expect(qc.getQueryState(["declutter", "my-move-date", "u1"])?.status).toBe("success"));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // let the answer re-render
    expect(screen.getByRole("heading", { name: /Your move/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Sale name/)).toBeNull();
  });
});
