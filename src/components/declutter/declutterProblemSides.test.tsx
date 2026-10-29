/**
 * D2-3 (audit 1b #3): the side that did not report a problem sees the reason, the words and the photos, and adds its
 * own side; the reporter sees that answer; a decided problem shows nothing here. The rules are SQL's
 * (src/test/pglite/declutterProblemBothSides.pglite.mjs); this proves the panel reads them and sends exactly the words.
 *
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |   if (!p \|\| p.status !== "open") return null; |   if (!p) return null;
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       {!mine && !open && ( |       {!open && (
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |     mutationFn: (p: OrderProblem) => addProblemSide(p.id, note.trim()), |     mutationFn: (p: OrderProblem) => addProblemSide(p.id, note),
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       <ProblemPhotos paths={p.photo_paths ?? []} />\n | \n
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderProblem } from "@/lib/declutter/handover";

const state = vi.hoisted(() => ({ problem: null as unknown, added: [] as unknown[][] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchOrderProblem: async () => state.problem,
  addProblemSide: async (...a: unknown[]) => { state.added.push(a); return { result: "added", problem_id: "p1" }; },
  handoverPhotoUrl: async (p: string) => `https://signed.example/${p}`,
}));

import { DeclutterProblemSides } from "./DeclutterProblemSides";

const OPEN: OrderProblem = {
  id: "p1", reporter_side: "buyer", reason: "damaged", note: "The leg is cracked.", status: "open",
  photo_paths: ["b/declutter/problem/o1/a.jpg"], created_at: "2026-10-29T18:00:00Z",
};

function show(side: "buyer" | "seller", problem: OrderProblem | null) {
  state.problem = problem;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemSides orderId="o1" side={side} /></QueryClientProvider>);
}

beforeEach(() => { state.added = []; });

describe("DeclutterProblemSides", () => {
  it("the seller sees the buyer's report with its photo, and adds their side (exactly the words)", async () => {
    show("seller", OPEN);
    expect((await screen.findByText(/The buyer reported a problem: It's damaged\./)).closest("p")?.textContent)
      .toBe('The buyer reported a problem: It\'s damaged. "The leg is cracked."');
    expect(await screen.findByAltText("Problem photo 1")).toHaveAttribute("src", "https://signed.example/b/declutter/problem/o1/a.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Add your side" }));
    fireEvent.change(screen.getByLabelText("Your side, for Louisiana Helpr"), { target: { value: "  It left here in one piece.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.added).toEqual([["p1", "It left here in one piece."]]));
  });

  it("the reporter sees the other side's answer and cannot add a side to their own report", async () => {
    show("buyer", { ...OPEN, other_side_note: "It left here in one piece.", other_side_photo_paths: ["s/declutter/problem/o1/b.jpg"] });
    expect(await screen.findByText(/You reported a problem/)).toBeTruthy();
    expect(screen.getByText(/The seller's side:/).closest("p")?.textContent).toBe('The seller\'s side: "It left here in one piece."');
    expect(await screen.findByAltText("Problem photo 1", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /your side/i })).toBeNull();
  });

  it("a decided problem, or none, shows nothing here", async () => {
    const { container, unmount } = show("seller", { ...OPEN, status: "decided" });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-problem-sides]")).toBeNull();
    unmount();
    const none = show("seller", null);
    await new Promise((r) => setTimeout(r, 50));
    expect(none.container.querySelector("[data-problem-sides]")).toBeNull();
  });
});
