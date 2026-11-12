/**
 * F260q: Manage listing's Edit form follows the member's language: its labels, the condition and size chips (decl.cond /
 * decl.size), the category chips (decl.cat), the save rule under it, the save button and the saved toast (lp.ed.* in
 * enListingParts, English held equal to EDIT_SAVED / EDIT_RULE). Still English: the category GROUP headings
 * (ChipGroup draws the heading value; CategoryDrillDown's sf.group keys are not wired here yet).
 *
 * @mutate src/components/declutter/DeclutterEditListing.tsx | <FieldLabel htmlFor="edit-title" text={t("lp.ed.title")} /> | <FieldLabel htmlFor="edit-title" text="Title" />
 * @mutate src/components/declutter/DeclutterEditListing.tsx | label: CONDITION_LABEL[n] ? t(`decl.cond.${n}` as MsgKey) : String(n) | label: CONDITION_LABEL[n]
 * @mutate src/components/declutter/DeclutterEditListing.tsx |         {big ? t("lp.ed.rule.checked") : t("lp.ed.rule.instant")} |         {big ? EDIT_RULE.checked : EDIT_RULE.instant}
 * @mutate src/components/declutter/DeclutterEditListing.tsx |         {save.isPending ? t("lp.ed.saving") : t("lp.ed.save")} |         {save.isPending ? "Saving…" : "Save changes"}
 * @mutate src/components/declutter/DeclutterEditListing.tsx | label: t(`decl.size.${k}` as MsgKey) })) | label: SIZE_LABEL[k] }))
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
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
vi.mock("@/components/declutter/SellPorchDays", () => ({ SellPorchDays: () => null }));

import { DeclutterEditListing, EDIT_RULE, EDIT_SAVED } from "@/components/declutter/DeclutterEditListing";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

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

beforeEach(() => {
  calls.length = 0;
  editListing.mockClear();
  photoRows.value = [{ id: "p1", item_id: "i1", storage_path: "u1/declutter/i1/a.jpg", position: 0 }];
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

describe("F260q: the Edit form follows the member's language", () => {
  afterEach(() => __resetLangForTests());

  it("every word has its Spanish, and the English is the form's own", () => {
    const keys = (Object.keys(enListingParts) as (keyof typeof enListingParts)[]).filter((k) => k.startsWith("lp.ed."));
    expect(keys.length).toBeGreaterThan(12);
    for (const k of keys) {
      expect(es[k], k).toBe(esListingParts[k]);
      expect(esListingParts[k], `${k} still English`).not.toBe(enListingParts[k]);
    }
    for (const o of Object.keys(EDIT_SAVED) as (keyof typeof EDIT_SAVED)[]) expect(enListingParts[`lp.ed.saved.${o}`]).toBe(EDIT_SAVED[o]);
    expect(enListingParts["lp.ed.rule.checked"]).toBe(EDIT_RULE.checked);
    expect(enListingParts["lp.ed.rule.instant"]).toBe(EDIT_RULE.instant);
  });

  it("Spanish: labels, chips, the rule and the button", async () => {
    setLang("es");
    await ensureLangLoaded();
    open();
    await screen.findByAltText(/1/);
    expect(screen.getByText("Título")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Como nuevo" })).toBeInTheDocument();
    expect(screen.getByText(esListingParts["lp.ed.rule.instant"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Save changes");
    expect(document.body.textContent).toContain(es["decl.size.large"]);
  });
});
