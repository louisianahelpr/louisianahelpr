/**
 * Audit 1028 D1-1: editing a live listing (owner 2026-10-29, "REVIEW ONLY BIG CHANGES"). The screen sends every
 * field and the tax tick; the server (declutter_edit_listing, PGlite T11 in declutterHandoverChoices.pglite.mjs)
 * decides what is big. The screen says beforehand which rule applies, and never saves without the tax box.
 *
 * Audit DC-8 (Q2476): the photos of a live listing can be changed here with the sell form's own photo grid, held on
 * the device until Save; new photos go up before removed ones come off; a photo change gets the automatic re-check
 * and the screen says so first. The fields use the sell form's editors (chips), not native selects. Backend proof:
 * src/test/pglite/declutterLivePhotos.pglite.mjs (migration 20261030061927).
 *
 * @mutate src/components/declutter/DeclutterEditListing.tsx |   const ready = attested && | const ready =
 * @mutate src/components/declutter/DeclutterEditListing.tsx |   const big = title.trim() !== item.title \|\| description.trim() !== item.description \|\| category !== item.category \|\| photosChanged; |   const big = false;
 * @mutate src/components/declutter/DeclutterEditListing.tsx |  category !== item.category \|\| photosChanged; |  category !== item.category;
 * @mutate src/components/declutter/DeclutterEditListing.tsx |       for (const f of held) await addPhotoSteadily(user!.id, item.id, f, FULL_LISTING_COPY);\n      for (const id of removed) await removePhoto(id); |       for (const id of removed) await removePhoto(id);\n      for (const f of held) await addPhotoSteadily(user!.id, item.id, f, FULL_LISTING_COPY);
 * @mutate src/components/declutter/DeclutterEditListing.tsx |       if (status === "live" && !photosChanged) return "saved"; |       if (status === "live") return "saved";
 * @mutate src/components/declutter/DeclutterEditListing.tsx |  && photoTotal >= DECLUTTER_MIN_PHOTOS && | &&
 * @mutate src/components/declutter/DeclutterEditListing.tsx |           onRemoveUploaded={(id) => setRemoved((r) => [...r, id])} |           onRemoveUploaded={() => {}}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: string[] = [];
const editListing = vi.fn(async (..._a: unknown[]) => { calls.push("edit"); return "live"; });
const photoRows = { value: [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/a.jpg", position: 0 }] as { id: string; item_id: string; storage_path: string; position: number }[] };
// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  editListing: (...a: unknown[]) => editListing(...a),
  fetchItemHandovers: async () => ["porch"],
  // The seller's usual pickup times (b9 place times reads them on the edit form): none saved.
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => photoRows.value,
  addPhotoSteadily: async (_u: string, id: string, f: File) => { calls.push(`add:${id}:${f.name}`); return "new"; },
  removePhoto: async (id: string) => { calls.push(`remove:${id}`); },
  requestAiCheckWithRetry: async (id: string) => { calls.push(`check:${id}`); return { checked: true, flagged: false }; },
  fetchItem: async () => ({ status: "live" }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
// The porch-day chips read the seller's own setting; they have their own test (sellPorchDays.test.tsx).
vi.mock("./SellPorchDays", () => ({ SellPorchDays: () => null }));

import { DeclutterEditListing, EDIT_RULE, EDIT_SAVED } from "./DeclutterEditListing";
import { TAX_TICK_LABEL } from "./declutterUi";
import { toast } from "sonner";

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
const review = () => document.querySelector("[data-edit-review]")?.getAttribute("data-edit-review");
const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => {
  calls.length = 0;
  editListing.mockClear();
  photoRows.value = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/a.jpg", position: 0 }];
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

describe("D1-1: edit a live listing", () => {
  it("a small change says it saves at once, and nothing saves until the tax box is ticked", async () => {
    const onDone = open();
    await screen.findByAltText("Photo 1");
    expect(screen.queryByText("To change photos, take it down and relist.")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Like new" }));
    expect(review()).toBe("no");
    expect(screen.getByText(EDIT_RULE.instant)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: TAX_TICK_LABEL }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(editListing).toHaveBeenCalledWith("i1", expect.objectContaining({ conditionStars: 5, title: "Oak rocking chair", handovers: ["porch"] })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Nothing big: no photo calls and no re-check.
    expect(calls).toEqual(["edit"]);
  });

  it("a new title, description or category says it gets the automatic check", async () => {
    open();
    await screen.findByAltText("Photo 1");
    for (const [label, value] of [["Title", "Oak rocker"], ["Description", "Solid oak."]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(review()).toBe("yes");
      fireEvent.change(screen.getByLabelText(label), { target: { value: (ITEM as Record<string, unknown>)[label.toLowerCase()] as string } });
      expect(review()).toBe("no");
    }
    fireEvent.click(screen.getByRole("radio", { name: "Home decor" }));
    expect(review()).toBe("yes");
    fireEvent.click(screen.getByRole("radio", { name: "Furniture" }));
    expect(review()).toBe("no");
  });

  it("uses the sell form's editors: chips for category, condition and size, no native selects (DC-8)", async () => {
    open();
    await screen.findByAltText("Photo 1");
    expect(document.querySelector("[data-edit-listing] select")).toBeNull();
    for (const g of ["Category", "Condition", "Size"]) expect(screen.getByRole("radiogroup", { name: g })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Lightly used" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("DC-8: a live listing's photos", () => {
  it("a new photo waits until Save, says it gets the check, goes up after the words, then the check runs", async () => {
    const onDone = open();
    await screen.findByAltText("Photo 1");
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("b.jpg")] } });
    expect(await screen.findByAltText("Photo 2")).toBeInTheDocument();
    expect(calls).toEqual([]); // nothing uploaded before Save
    expect(review()).toBe("yes");
    expect(screen.getByText(EDIT_RULE.checked)).toBeInTheDocument();
    expect(EDIT_RULE.checked).toMatch(/photo/);
    fireEvent.click(screen.getByRole("checkbox", { name: TAX_TICK_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls).toEqual(["edit", "add:i1:b.jpg", "check:i1"]);
    expect(toast).toHaveBeenCalledWith(EDIT_SAVED.live_again);
  });

  it("swapping the only photo: the new one goes up BEFORE the old one comes off", async () => {
    open();
    await screen.findByAltText("Photo 1");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(screen.queryByAltText("Photo 1")).toBeNull();
    // With no photo left it will not save, and says why.
    expect(screen.getByText("Keep at least 1 photo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: TAX_TICK_LABEL }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("new.jpg")] } });
    await screen.findByAltText("Photo 1");
    expect(screen.queryByText("Keep at least 1 photo.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toEqual(["edit", "add:i1:new.jpg", "remove:p1", "check:i1"]));
  });

  it("removing one of two photos removes it on Save and runs the check", async () => {
    photoRows.value = [...photoRows.value, { id: "p2", item_id: "i1", storage_path: "u1/declutter/i1/b.jpg", position: 1 }];
    open();
    await screen.findByAltText("Photo 2");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    expect(review()).toBe("yes");
    fireEvent.click(screen.getByRole("checkbox", { name: TAX_TICK_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toEqual(["edit", "remove:p2", "check:i1"]));
  });
});
