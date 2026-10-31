/**
 * "On your way" (owner request 2026-10-27, multi-stop Declutter delivery part 3): up to 3 open
 * deliveries with "+$X pay, about N extra minutes", each added with one tap through the existing
 * accept path at the suggested pickup time. Eligibility, the detour score, the cap and the
 * no-address rule are proven in SQL (src/test/pglite/helprRouteSuggestions.pglite.mjs).
 *
 * @mutate src/components/declutter/RouteSuggestions.tsx |     mutationFn: () => acceptTask(s.task_id, s.pickup_slot_start), |     mutationFn: () => acceptTask(s.task_id, new Date().toISOString()),
 * @mutate src/components/declutter/RouteSuggestions.tsx |         <span className="font-normal">, about {s.extra_minutes} extra {s.extra_minutes === 1 ? "minute" : "minutes"}</span> |         <span className="font-normal" />
 * @mutate src/components/declutter/RouteSuggestions.tsx |   if (data.reason === "too_many_taken" && !withTaskId) { |   if (false) {
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// The words membersSeeNoFeeWords bans, in short (importing a .test file would run its suite here).
const FEE_WORDS = /fee|commission|%\s*\+/i;

const state = {
  answer: null as unknown,
  fail: false,
  calls: [] as unknown[][],
  offered: [] as string[],
};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({
  useHiredPayoutPrompt: () => ({ open: false, offer: async (id: string) => { state.offered.push(id); return true; }, close: () => {} }),
}));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchRouteSuggestions: async (...a: unknown[]) => { state.calls.push(["suggest", ...a]); if (state.fail) throw new Error("boom"); return state.answer; },
  acceptTask: async (...a: unknown[]) => { state.calls.push(["accept", ...a]); },
}));

import { RouteSuggestions } from "./RouteSuggestions";

const ONE = {
  task_id: "t7", title: "Blue lamp", size: "small", pickup_area: "Mid City", dropoff_area: "Shenandoah", trip_miles: 6,
  take_home_cents: 2700, extra_minutes: 10, extra_miles: 0.4, pickup_slot_start: "2026-10-28T19:15:00Z", latest_pickup_at: "2026-11-01T19:00:00Z",
};

function show(props: { withTaskId?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RouteSuggestions {...props} /></QueryClientProvider>);
}

beforeEach(() => {
  state.answer = { suggestions: [ONE, { ...ONE, task_id: "t8", title: "Oak chair", extra_minutes: 1 }], reason: null };
  state.fail = false;
  state.calls = [];
  state.offered = [];
});

describe("On your way", () => {
  it("shows each suggestion's pay and extra minutes, area words only, and no fee", async () => {
    const { container } = show();
    expect(await screen.findByRole("region", { name: "On your way" })).toBeInTheDocument();
    expect(screen.getAllByText("+$27 pay")).toHaveLength(2);
    expect(screen.getByText(/about 10 extra minutes/)).toBeInTheDocument();
    expect(screen.getByText(/about 1 extra minute$/)).toBeInTheDocument();
    expect(screen.getAllByText("Pick up in Mid City, drop off near Shenandoah")).toHaveLength(2);
    expect(container.textContent ?? "").not.toMatch(FEE_WORDS);
  });

  it("Add to my route takes it through the existing accept path at the suggested pickup time", async () => {
    show();
    const add = await screen.findAllByRole("button", { name: "Add to my route" });
    fireEvent.click(add[0]);
    await waitFor(() => expect(state.calls).toContainEqual(["accept", "t7", "2026-10-28T19:15:00Z"]));
    await waitFor(() => expect(state.offered).toEqual(["u1"]));
  });

  it("viewing an open delivery asks for suggestions with it in the route", async () => {
    show({ withTaskId: "t1" });
    await screen.findByRole("region", { name: "On your way" });
    expect(state.calls[0]).toEqual(["suggest", "t1"]);
  });

  it("two deliveries not yet picked up: says to pick one up first", async () => {
    state.answer = { suggestions: [], reason: "too_many_taken" };
    show();
    expect(await screen.findByText("Pick up one of your deliveries to see more on your way.")).toBeInTheDocument();
  });

  it("paused for back-outs: says so, the same rule the accept applies", async () => {
    state.answer = { suggestions: [], reason: "too_many_releases" };
    show({ withTaskId: "t1" });
    expect(await screen.findByText(/You backed out of 3 deliveries this week/)).toBeInTheDocument();
  });

  it("nothing near, or a failure: shows nothing (the route and the list still work)", async () => {
    state.answer = { suggestions: [], reason: "none_near" };
    const a = show();
    await waitFor(() => expect(state.calls.length).toBe(1));
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    state.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = show();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(b.container).toBeEmptyDOMElement();
    warn.mockRestore();
  });
});
