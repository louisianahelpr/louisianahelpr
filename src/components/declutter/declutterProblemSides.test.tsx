/**
 * D2-3 (audit 1b #3): the side that did not report a problem sees the reason, the words and the photos, and adds its
 * own side; the reporter sees that answer; a decided problem shows nothing here. The rules are SQL's
 * (src/test/pglite/declutterProblemBothSides.pglite.mjs); this proves the panel reads them and sends exactly the words.
 *
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |   if (!p \|\| p.status !== "open") return null; |   if (!p) return null;
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       {!mine && !open && ( |       {!open && (
 * @mutate src/components/declutter/DeclutterProblemSides.tsx | addProblemSide(p.id, note.trim(), photos.length | addProblemSide(p.id, note, photos.length
 * BUY-28: "Add your side to it, with photos" had no photo option; sent again with none, the server would have wiped them.
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |           <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={send.isPending} />\n |
 * @mutate src/components/declutter/DeclutterProblemSides.tsx | : (p.other_side_photo_paths ?? [])), | : []),
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       <ProblemPhotos paths={p.photo_paths ?? []} />\n | \n
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |   const words = p?.status === "decided" && p.decision ? DECIDED_WORDS[p.decision]?.[side] : undefined; |   const words = p?.decision ? DECIDED_WORDS[p.decision]?.buyer : undefined;
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |   pay_seller: { buyer: "The seller keeps the payment, and the sale is final.", seller: "You keep the payment." }, |   pay_seller: { buyer: "Handed over.", seller: "Handed over." },
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       {mine && (p.reporter_side === "buyer" \|\| p.reporter_side === "seller") && ( |       {(p.reporter_side === "buyer" \|\| p.reporter_side === "seller") && (
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |         pending={takeBack.isPending} onConfirm={() => takeBack.mutate(p)} |         pending={takeBack.isPending} onConfirm={() => setTakingBack(false)}
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |         <button type="button" className={btn} disabled={takeBack.isPending} onClick={() => setTakingBack(true)}> |         <button type="button" className={btn} disabled={takeBack.isPending} onClick={() => takeBack.mutate(p)}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrderProblem } from "@/lib/declutter/handover";

const state = vi.hoisted(() => ({ problem: null as unknown, added: [] as unknown[][], withdrawn: [] as unknown[], uploaded: [] as string[] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchOrderProblem: async () => state.problem,
  addProblemSide: async (...a: unknown[]) => { state.added.push(a); return { result: "added", problem_id: "p1" }; },
  handoverPhotoUrl: async (p: string) => `https://unit-test.invalid/storage/v1/object/sign/job-photos/${p}`,
  uploadProblemPhoto: async (orderId: string, f: File) => { state.uploaded.push(f.name); return `s/declutter/problem/${orderId}/${f.name}`; },
  withdrawProblem: async (id: unknown) => { state.withdrawn.push(id); return { result: "withdrawn", problem_id: id }; },
}));

import { DeclutterProblemDecided, DeclutterProblemSides } from "./DeclutterProblemSides";

const OPEN: OrderProblem = {
  id: "p1", reporter_side: "buyer", reason: "damaged", note: "The leg is cracked.", status: "open",
  photo_paths: ["b/declutter/problem/o1/a.jpg"], created_at: "2026-10-29T18:00:00Z",
};

function show(side: "buyer" | "seller", problem: OrderProblem | null) {
  state.problem = problem;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemSides orderId="o1" side={side} /></QueryClientProvider>);
}

beforeEach(() => { state.added = []; state.withdrawn = []; state.uploaded = []; });

describe("DeclutterProblemSides", () => {
  it("the seller sees the buyer's report with its photo, and adds their side (exactly the words)", async () => {
    show("seller", OPEN);
    // NIGHT-BUYINGopenpr-8: the reason and who reported it are said once, in the note above (ProblemOpenNote).
    expect((await screen.findByText(/The buyer's report:/)).closest("p")?.textContent)
      .toBe('The buyer\'s report: "The leg is cracked."');
    expect(screen.queryByText(/reported a problem|It's damaged/)).toBeNull();
    expect(await screen.findByAltText("Problem photo 1")).toHaveAttribute("src", "https://unit-test.invalid/storage/v1/object/sign/job-photos/b/declutter/problem/o1/a.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Add your side" }));
    fireEvent.change(screen.getByLabelText("Your side, for Louisiana Helpr"), { target: { value: "  It left here in one piece.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.added).toEqual([["p1", "It left here in one piece.", []]]));
  });

  it("adding a side can carry photos, uploaded on Send and sent with the words", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const { container } = show("seller", OPEN);
    fireEvent.click(await screen.findByRole("button", { name: "Add your side" }));
    fireEvent.change(screen.getByLabelText("Your side, for Louisiana Helpr"), { target: { value: "Here it is packed." } });
    const file = new File(["x"], "packed.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.added).toEqual([["p1", "Here it is packed.", ["s/declutter/problem/o1/packed.jpg"]]]));
    expect(state.uploaded).toEqual(["packed.jpg"]);
  });

  it("changing a side with no new photo keeps the ones already sent, and says new ones replace them", async () => {
    show("seller", { ...OPEN, other_side_note: "First words.", other_side_photo_paths: ["s/declutter/problem/o1/old.jpg"] });
    fireEvent.click(await screen.findByRole("button", { name: "Change your side" }));
    expect(screen.getByText("New photos replace the ones you sent.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your side, for Louisiana Helpr"), { target: { value: "Better words." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.added).toEqual([["p1", "Better words.", ["s/declutter/problem/o1/old.jpg"]]]));
    expect(state.uploaded).toEqual([]);
  });

  it("the reporter sees the other side's answer and cannot add a side to their own report", async () => {
    show("buyer", { ...OPEN, other_side_note: "It left here in one piece.", other_side_photo_paths: ["s/declutter/problem/o1/b.jpg"] });
    expect(await screen.findByText(/Your report:/)).toBeTruthy();
    expect(screen.getByText(/The seller's side:/).closest("p")?.textContent).toBe('The seller\'s side: "It left here in one piece."');
    expect(await screen.findByAltText("Problem photo 1", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /your side/i })).toBeNull();
  });

  it("B100: the reporter can take back their report, only after confirming; the other side and a Helpr's report cannot", async () => {
    const mine = show("buyer", OPEN);
    fireEvent.click(await screen.findByRole("button", { name: "Take back my report" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Take back your report?");
    expect(sheet).toHaveTextContent("You can't report this sale again after taking it back.");
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Keep my report" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Take back my report" })).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Take back my report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.withdrawn).toEqual(["p1"]));
    mine.unmount();
    const other = show("seller", OPEN);
    expect(await screen.findByRole("button", { name: "Add your side" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take back my report" })).toBeNull();
    other.unmount();
    show("seller", { ...OPEN, reporter_side: "helpr" });
    expect(await screen.findByText(/The Helpr's report:/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take back my report" })).toBeNull();
  });

  it("a withdrawn problem shows nothing here", async () => {
    const { container } = show("buyer", { ...OPEN, status: "withdrawn" });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-problem-sides]")).toBeNull();
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

// Audit 1030 DB-12: once Louisiana Helpr decides, the card says what it decided (the notices' words), per side.
function decided(side: "buyer" | "seller", problem: OrderProblem | null) {
  state.problem = problem;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProblemDecided orderId="o1" side={side} /></QueryClientProvider>);
}
const line = async () => (await screen.findByText("Louisiana Helpr decided:")).closest("p")?.textContent;

describe("DeclutterProblemDecided (DB-12)", () => {
  it.each([
    ["pay_seller", "buyer", "Louisiana Helpr decided: The seller keeps the payment, and the sale is final."],
    ["pay_seller", "seller", "Louisiana Helpr decided: You keep the payment."],
    ["refund_buyer", "buyer", "Louisiana Helpr decided: We are refunding you. A separate notice says how much."],
    ["refund_buyer", "seller", "Louisiana Helpr decided: We are refunding the buyer."],
    ["refund_part", "seller", "Louisiana Helpr decided: We are refunding the buyer part of the payment."],
    ["delivery_damage", "buyer", "Louisiana Helpr decided: It was damaged in delivery. A separate notice says what comes back to you."],
  ] as const)("%s, as the %s", async (decision, side, words) => {
    decided(side, { ...OPEN, status: "decided", decision, decided_at: "2026-10-30T04:26:46Z" });
    expect(await line()).toBe(words);
  });

  it("says nothing while the problem is open, with no problem, or before the read returns a decision", async () => {
    for (const p of [OPEN, null, { ...OPEN, status: "decided" as const }]) {
      const { container, unmount } = decided("buyer", p);
      await new Promise((r) => setTimeout(r, 50));
      expect(container.querySelector("[data-problem-decided]")).toBeNull();
      unmount();
    }
  });
});
