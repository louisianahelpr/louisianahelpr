/**
 * Audit 1028 D1-1: editing a live listing (owner 2026-10-29, "REVIEW ONLY BIG CHANGES"). The screen sends every
 * field and the tax tick; the server (declutter_edit_listing, PGlite T11 in declutterHandoverChoices.pglite.mjs)
 * decides what is big. The screen says beforehand which rule applies, and never saves without the tax box.
 *
 * @mutate src/components/declutter/DeclutterEditListing.tsx |   const ready = attested && | const ready =
 * @mutate src/components/declutter/DeclutterEditListing.tsx |   const big = title.trim() !== item.title \|\| description.trim() !== item.description \|\| category !== item.category; |   const big = false; */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const editListing = vi.fn(async () => "live");
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  editListing: (...a: unknown[]) => editListing(...(a as [])),
  fetchItemHandovers: async () => ["porch"],
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
// The porch-day chips read the seller's own setting; they have their own test (sellPorchDays.test.tsx).
vi.mock("./SellPorchDays", () => ({ SellPorchDays: () => null }));

import { DeclutterEditListing } from "./DeclutterEditListing";
import { TAX_ATTESTATION_SENTENCE } from "./declutterUi";

const ITEM = {
  id: "i1", seller_id: "u1", status: "live", title: "Oak rocking chair", description: "Solid.", category: "furniture",
  condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City",
  area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-20", live_at: "2026-10-20", porch_ok: true,
} as const;

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  render(<QueryClientProvider client={qc}><DeclutterEditListing item={ITEM as never} onDone={onDone} /></QueryClientProvider>);
  return onDone;
}

describe("D1-1: edit a live listing", () => {
  it("a small change says it saves at once, and nothing saves until the tax box is ticked", async () => {
    editListing.mockClear();
    const onDone = open();
    expect(screen.getByText("To change photos, take it down and relist.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "5" } });
    expect(document.querySelector("[data-edit-review]")?.getAttribute("data-edit-review")).toBe("no");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: TAX_ATTESTATION_SENTENCE }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(editListing).toHaveBeenCalledWith("i1", expect.objectContaining({ conditionStars: 5, title: "Oak rocking chair", handovers: ["porch"] })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("a new title, description or category says it goes back for review", () => {
    open();
    for (const [label, value] of [["Title", "Oak rocker"], ["Description", "Solid oak."], ["Category", "home_decor"]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(document.querySelector("[data-edit-review]")?.getAttribute("data-edit-review")).toBe("yes");
      fireEvent.change(screen.getByLabelText(label), { target: { value: (ITEM as Record<string, unknown>)[label.toLowerCase()] as string } });
      expect(document.querySelector("[data-edit-review]")?.getAttribute("data-edit-review")).toBe("no");
    }
  });
});
