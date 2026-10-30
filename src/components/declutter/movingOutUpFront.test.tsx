/**
 * Audit #33 (Declutter deep audit, 2026-10-28), Moving out:
 *  - the move-out date was required, but its error showed only at Save, after a minute-long photo scan: now the
 *    move's details come first (the room photos wait, saying what is missing) and a wrong date says so at the field;
 *  - nothing typed survived a reload: the unsaved date, area, address and rows are kept per member in
 *    sessionStorage (moveDraft.ts);
 *  - step 4 said "3 to 12 photos" after one became enough: it reads DECLUTTER_MIN_PHOTOS / DECLUTTER_MAX_PHOTOS;
 *  - "End the moving sale" asked with window.confirm: it asks in ConfirmSheet, same words (lead 2026-10-28).
 *
 * @mutate src/components/declutter/DeclutterMoveView.tsx |         {moveDetailsProblem ? (\n          <p className="text-xs | {false ? (\n          <p className="text-xs
 * @mutate src/components/declutter/DeclutterMoveView.tsx | id="move-files" disabled={!!moveDetailsProblem \|\| scanning} | id="move-files" disabled={scanning}
 * @mutate src/components/declutter/DeclutterMoveView.tsx |           aria-label="Add room photos" |
 * @mutate src/components/declutter/DeclutterMoveView.tsx |         {date && dateProblem && <p | {false && <p
 * @mutate src/components/declutter/DeclutterMoveView.tsx |     writeMoveDraft(user.id, { date, areaLabel, pickupAddress, rows }); |     void 0;
 * @mutate src/components/declutter/DeclutterMoveView.tsx | Each item needs at least {photosWord(DECLUTTER_MIN_PHOTOS)} of its own (up to {DECLUTTER_MAX_PHOTOS}) | Each item needs 3 to 12 photos of its own
 * @mutate src/components/declutter/DeclutterMoveView.tsx |             onClick={() => setAskEnd(true)} |             onClick={() => void onChangeDate(null)}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  moveOutOn: null as string | null,
  items: [] as { id: string; title: string; status: string; current_price_cents: number; area_label: string }[],
  setDates: [] as (string | null)[],
};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterMovingSaleDetails", () => ({ MovingSaleDetails: () => null }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "not_found" }) }));
vi.mock("@/lib/declutter/api", () => ({
  fetchHasAgreedSales: async () => false,
  fetchMyItemPrivate: async () => ({ pickup_address: "1 Saved St, Baton Rouge, LA 70808" }),
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => [],
  setPickupWindows: async () => undefined,
}));
vi.mock("@/lib/declutter/moves", async (orig) => ({
  ...(await orig<object>()),
  fetchMyMoveItems: async () => state.items,
  fetchMyMoveOutDate: async () => state.moveOutOn,
  setMoveOutDate: async (d: string | null) => { state.setDates.push(d); return 1; },
  createMoveDrafts: async () => [],
  publishMany: async () => [],
  scanRoom: async () => [],
}));

import DeclutterMovePage from "@/pages/declutter/DeclutterMovePage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><DeclutterMovePage /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  state.moveOutOn = null;
  state.items = [];
  state.setDates = [];
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("Moving out asks for the move first (audit #33)", () => {
  it("room photos wait for the move's details, and say which one is missing", async () => {
    renderPage();
    expect(await screen.findByText("First, fill in your move above: Pick your move-out date.")).toBeInTheDocument();
    expect(document.getElementById("move-files")).toBeDisabled();
    // While it waits there is no <label> for it, so it carries its own name (axe "label", critical, on /declutter/move).
    expect(document.getElementById("move-files")).toHaveAccessibleName("Add room photos");
  });

  it("a past date is named at the date field, before any scan", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Move-out date"), { target: { value: "2020-01-01" } });
    expect(document.querySelector("[data-move-date-problem]")?.textContent).toBe("Your move-out date can't be in the past.");
  });

  it("what was typed survives a reload", async () => {
    const first = renderPage();
    fireEvent.change(await screen.findByLabelText("Area buyers see"), { target: { value: "Mid City, Baton Rouge" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "12 Oak St, Baton Rouge, LA 70806" } });
    first.unmount();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Area buyers see")).toHaveValue("Mid City, Baton Rouge"));
    expect(screen.getByLabelText("Pickup address")).toHaveValue("12 Oak St, Baton Rouge, LA 70806");
  });
});

describe("Moving out's own words", () => {
  it("step 4 reads the photo rule (one is enough, up to 12)", async () => {
    state.items = [{ id: "i1", title: "Oak dresser", status: "draft", current_price_cents: 4000, area_label: "Mid City" }];
    renderPage();
    expect(await screen.findByText(/Each item needs at least 1 photo of its own \(up to 12\)/)).toBeInTheDocument();
  });

  it("ending the moving sale asks in the app's sheet, same words, and ends it on confirm", async () => {
    state.moveOutOn = "2099-01-01";
    const confirm = vi.spyOn(window, "confirm");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "End the moving sale" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("Your items stay up as ordinary listings.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "End the moving sale" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(state.setDates).toEqual([null]));
  });
});
