/**
 * The admin "Declutter problems" card (slice 4, B54) with slice 5's delivery
 * decision: an item reported damaged or not received gets "Damaged in
 * delivery" (row 43; declutter_admin_decide_delivery_damage), because the
 * ordinary "Refund the buyer" pays the Helpr for the trip (B69) and the server
 * refuses it there (lh-money-escrow review #1, 2026-10-16). The server rules
 * are proven in src/test/pglite/declutterDelivery.pglite.mjs.
 *
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |       {row.reporter_side === "helpr" && (row.photo_paths ?? []).map((p) => <HelprPhoto key={p} path={p} />)} |
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |   const deliveryReason = row.reason === "damaged" \|\| row.reason === "not_received"; |   const deliveryReason = false;
 * @mutate src/components/admin/settings/DeclutterProblemsCard.tsx |     mutationFn: () => adminDecideDeliveryDamage(row.id, note.trim() \|\| null), |     mutationFn: () => adminDecideProblem(row.id, "refund_buyer", "none", false, null),
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { rows: [] as unknown[], calls: [] as unknown[][] };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/lib/helprTasks/api", () => ({ taskPhotoUrl: async (p: string) => `https://signed.test/${p}` }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchOpenProblemsForAdmin: async () => state.rows,
  adminDecideProblem: async (...a: unknown[]) => { state.calls.push(["decide", ...a]); return {}; },
  adminDecideDeliveryDamage: async (...a: unknown[]) => { state.calls.push(["damage", ...a]); return {}; },
}));

import { DeclutterProblemsCard } from "./DeclutterProblemsCard";

const row = (reason: string, reporter_side = "buyer", photo_paths: string[] = []) => ({
  id: "p1", order_id: "o1234567-0000", reporter_side, reason, note: "The leg is broken.", photo_paths, created_at: "2026-10-16T12:00:00Z",
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemsCard /></QueryClientProvider>);
}

beforeEach(() => {
  state.rows = [];
  state.calls = [];
});

describe("DeclutterProblemsCard: the delivery decision", () => {
  it("a damaged item offers \"Damaged in delivery\", which sends the damage decision with the note", async () => {
    state.rows = [row("damaged")];
    show();
    fireEvent.change(await screen.findByLabelText("Note (both sides see it)"), { target: { value: "Broken in the truck." } });
    fireEvent.click(screen.getByRole("button", { name: "Damaged in delivery" }));
    await waitFor(() => expect(state.calls).toEqual([["damage", "p1", "Broken in the truck."]]));
  });

  it("so does an item not received", async () => {
    state.rows = [row("not_received")];
    show();
    expect(await screen.findByRole("button", { name: "Damaged in delivery" })).toBeInTheDocument();
  });

  it("other reasons do not, and the Helpr's \"seller wasn't there\" report says who reported it", async () => {
    state.rows = [row("no_show", "helpr", ["h1/task/t1/away.jpg"])];
    show();
    expect(await screen.findByText(/Someone didn't show · reported by the Helpr/)).toBeInTheDocument();
    // The evidence the report needs is shown to the admin (lh-silent-failure re-review #1).
    expect(await screen.findByAltText("The Helpr's photo at the pickup address")).toHaveAttribute("src", "https://signed.test/h1/task/t1/away.jpg");
    expect(screen.queryByRole("button", { name: "Damaged in delivery" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refund the buyer" }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("decide"));
  });
});
