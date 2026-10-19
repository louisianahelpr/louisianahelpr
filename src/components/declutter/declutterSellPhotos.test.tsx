/**
 * Photo-first selling (owner, 2026-10-19, as on Mercari / OfferUp): "Add
 * photos" is step 1, before the details. Before the first save the photos wait
 * on the device (previews only, nothing uploaded); saving the details creates
 * the draft and uploads them to it. After that, photos upload as they're added.
 * The API is stubbed: this checks the order of calls, not the backend.
 *
 * @mutate src/components/declutter/DeclutterSellView.tsx |       const added = await uploadPhotos(id, waiting); |       const added = 0; void waiting;
 * @mutate src/components/declutter/DeclutterSellView.tsx |     if (!itemId) {\n      setHeld((h) => [...h, ...list]);\n      return;\n    } |     if (!itemId) return;
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |   const count = uploaded.length + held.length; |   const count = uploaded.length;
 * @mutate src/components/declutter/DeclutterSellView.tsx |       <SellPhotos\n |       <span hidden />{false && <SellPhotos\n
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NEW_ID = "0f0e0d0c-0b0a-4908-8706-0504030201ff";
const calls: string[] = [];

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => null }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.45, longitude: -91.15 }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/lib/declutter/api", () => ({
  fetchItem: async () => null,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  fetchPhotos: async () => [],
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  createDraft: async () => { calls.push("createDraft"); return NEW_ID; },
  updateDraft: async () => "ok",
  setPorchOk: async () => true,
  addPhoto: async (_u: string, id: string, f: File) => { calls.push(`addPhoto:${id}:${f.name}`); return "p"; },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => 1,
  attestItem: async () => undefined,
  publishItem: async () => "live",
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/sell"]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

describe("photo-first selling", () => {
  beforeEach(() => {
    calls.length = 0;
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it("step 1 is Add photos, before the details; chosen photos wait on the device, then upload to the new draft on save", async () => {
    open();
    const photosHeading = await screen.findByRole("heading", { name: /^1\. Photos/ });
    const details = screen.getByRole("heading", { name: "2. The item" });
    expect(photosHeading.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("[data-add-photos]")).not.toBeNull();

    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")] } });
    expect(await screen.findByRole("heading", { name: "1. Photos (3 of 3 to 12)" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(3);
    expect(calls).toEqual([]); // nothing uploaded before there is a draft

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Oak rocking chair" } });
    fireEvent.change(screen.getByLabelText("Price ($)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Lowest price ($)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City, Baton Rouge" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge, LA 70802" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and upload photos" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`]),
    );
  });

  it("a held photo can be taken out before saving, and never goes up", async () => {
    open();
    await screen.findByRole("heading", { name: /^1\. Photos/ });
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg"), jpg("b.jpg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "1. Photos (1 of 3 to 12)" })).toBeInTheDocument();
  });
});
