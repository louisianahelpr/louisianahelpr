/**
 * BUY-17 (Declutter buying audit 10-30 #17): on a porch pickup day the buyer's "I got it" opens before the seller's
 * porch photo (A1-C2 keeps the day open; the owner's question on changing that is held). A slip finished the sale on
 * an item nobody had put out, and the sheet said nothing about the missing photo. Now, before the photo, the sheet
 * says first that the seller hasn't posted it, and to tap only with the item in hand. With the photo, it says nothing.
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx |         {porch && <PorchNoPhotoYet orderId={orderId} who={who} />} |         {null}
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx |   if (!h.data \|\| h.data.set_out_at) return null; |   if (!h.data) return null;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { setOutAt: null as string | null };

vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "buyer", confirmed_at: null,
    set_out_at: state.setOutAt, set_out_photo_path: state.setOutAt ? "p.jpg" : null, set_out_note: null, picked_up_at: null }),
  handoverPhotoUrl: async (path: string) => `https://signed.test/${path}`,
}));

import { GotItSheet } from "./DeclutterHandoverSheets";

function show(porch: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GotItSheet open onOpenChange={() => {}} orderId="o1" porch={porch} who="Dana" pending={false} onConfirm={() => {}} onProblem={() => {}} />
    </QueryClientProvider>,
  );
}

describe("BUY-17: I got it before the seller's porch photo", () => {
  it("says the porch photo isn't posted yet, before the photo", async () => {
    state.setOutAt = null;
    show(true);
    const note = await screen.findByText("Dana hasn't posted the porch photo yet. Tap I got it only if the item is in your hands.");
    expect(note).toHaveAttribute("data-got-it-no-porch-photo");
  });

  it("says nothing about it once the porch photo is in", async () => {
    state.setOutAt = new Date().toISOString();
    show(true);
    await waitFor(() => expect(document.querySelector("[data-got-it-photo]")).not.toBeNull());
    expect(document.querySelector("[data-got-it-no-porch-photo]")).toBeNull();
  });

  it("is not on a door pickup's sheet", async () => {
    state.setOutAt = null;
    show(false);
    await screen.findByText("Do you have it?");
    expect(document.querySelector("[data-got-it-no-porch-photo]")).toBeNull();
  });

  it("the sheets file still holds the warning (inventory floor)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/declutter/DeclutterHandoverSheets.tsx", "utf8");
    expect(src.split("data-got-it-no-porch-photo").length - 1).toBeGreaterThan(0);
  });
});
