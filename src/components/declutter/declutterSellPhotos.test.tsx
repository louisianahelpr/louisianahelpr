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
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |             {uploaded.length === 0 && i === 0 && <CoverChip />} |             {<CoverChip />}
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
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
// The payout prompt is its own component with its own test (declutterScreens); it asks Stripe.
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
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

  it("step 1 of 5 is photos (board 31a); held photos wait on the device, the steps walk 2-4, and step 4 creates the draft and uploads them", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Show it off" })).toBeInTheDocument();
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).toBeNull(); // one question per step
    expect(document.querySelector("[data-add-photos]")).not.toBeNull();

    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")] } });
    expect(await screen.findByText(/^3 of 12/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(3);
    // Board 31a: the first photo, and only the first, is marked as the cover.
    const covers = document.querySelectorAll("[data-cover-chip]");
    expect(covers).toHaveLength(1);
    expect(covers[0].closest("[data-held-photo]")).toBe(document.querySelectorAll("[data-held-photo]")[0]);
    expect(calls).toEqual([]); // nothing uploaded before there is a draft

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "What is it?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Oak rocking chair" } });
    fireEvent.click(screen.getByRole("radio", { name: "Furniture" }));
    expect(screen.getByRole("radio", { name: "Furniture" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "What's your price?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    // Board 31b: the drop strip follows the real rule (floor(current * 0.95), never below the lowest).
    // @mutate src/components/declutter/DeclutterSellSteps.tsx |     cur = Math.max(floorCents, Math.floor(cur * 0.95)); |     cur = Math.max(floorCents, Math.round(cur * 0.95));
    const strip = document.querySelector("[data-drop-schedule]")!;
    expect([...strip.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["$38", "$36.10", "$34.29", "$32.57", "$30.94", "$30"]);
    expect(strip.textContent).toMatch(/may stop sooner/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "How can buyers get it?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City, Baton Rouge" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge, LA 70802" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`]),
    );
  });

  it("a step will not move on until its own question is answered", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    // Audit #45: nothing is printed under the live Continue until it is tapped.
    // @mutate src/components/declutter/DeclutterSellView.tsx | && triedStep === step && <p role="alert" | && <p role="alert"
    expect(screen.queryByTestId("sell-form-problem")).toBeNull();
    // @mutate src/components/declutter/DeclutterSellView.tsx |     if (stepProblem) { |     if (false) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Show it off" })).toBeInTheDocument();
    expect(screen.getByTestId("sell-form-problem")).toHaveTextContent("Add at least 1 photo.");
  });

  it("a held photo can be taken out before saving, and never goes up", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg"), jpg("b.jpg")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(1);
    expect(screen.getByText(/^1 of 12/)).toBeInTheDocument();
  });
});
