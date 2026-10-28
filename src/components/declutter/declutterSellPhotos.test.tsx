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
const aiCalls: string[][] = [];
const drafts: { priceCents: number; floorPriceCents: number }[] = [];
const drops: [string, number][] = [];
const DRAFT = {
  title: "Mid-century walnut dresser", description: "Six drawers, solid walnut, light scratches on top.",
  category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false,
};
/** Claude's answer: resolves at once unless a test holds it to look at the "writing" state. */
const aiAnswer = {
  hold: false,
  release: null as null | (() => void),
  next(): Promise<typeof DRAFT> {
    if (!this.hold) return Promise.resolve(DRAFT);
    return new Promise((res) => { this.release = () => res(DRAFT); });
  },
};

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
  createDraft: async (f: { priceCents: number; floorPriceCents: number }) => { calls.push("createDraft"); drafts.push(f); return NEW_ID; },
  setDropPct: async (id: string, pct: number) => { drops.push([id, pct]); return pct; },
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setPorchOk: async () => true,
  addPhoto: async (_u: string, id: string, f: File) => { calls.push(`addPhoto:${id}:${f.name}`); return "p"; },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  // Owner 2026-10-28: a new listing's held photos go to Claude by themselves (SellAiDraft.tsx).
  requestAiDraftFromPhotos: (files: File[]) => { aiCalls.push(files.map((f) => f.name)); return aiAnswer.next(); },
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
    aiCalls.length = 0;
    drafts.length = 0;
    drops.length = 0;
    aiAnswer.hold = false;
    aiAnswer.release = null;
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
    // Owner 2026-10-28: drops are the seller's own yes/no, OFF until they turn them on, so no lowest price is asked.
    // @mutate src/components/declutter/DeclutterSellView.tsx |   drops: false,\n  dropPct: DEFAULT_DROP_PCT, |   drops: true,\n  dropPct: DEFAULT_DROP_PCT,
    expect(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("Lowest you'll take")).toBeNull();
    expect(document.querySelector("[data-drop-schedule]")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ }));
    fireEvent.click(screen.getByRole("radio", { name: "10%" }));
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    // Board 31b: the drop strip follows the real rule (the seller's step, down to a whole dollar, never below the lowest).
    // @mutate src/components/declutter/DeclutterSellSteps.tsx |     cur = Math.max(floorCents, dropStepCents(cur, pct)); |     cur = Math.max(floorCents, Math.floor(cur * 0.95));
    const strip = document.querySelector("[data-drop-schedule]")!;
    expect([...strip.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["$36", "$32", "$30"]);
    expect(strip.textContent).toMatch(/10% less each evening/);
    expect(strip.textContent).toMatch(/may stop sooner/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "How can buyers get it?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City, Baton Rouge" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge, LA 70802" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`]),
    );
    // The seller's choice is what the server stores: their lowest price and their step.
    // @mutate src/components/declutter/DeclutterSellView.tsx |       if (!form.free) await setDropPct(id, choice.dropPct); |       void choice;
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 3000 })]);
    expect(drops).toEqual([[NEW_ID, 10]]);
  });

  it("price drops left off: the lowest price is saved as the price and the step as 0, so it never drops", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg")] } });
    await screen.findByText(/^1 of 12/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Oak rocking chair" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Price"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Area buyers see"), { target: { value: "Mid-City, Baton Rouge" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge, LA 70802" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    // @mutate src/components/declutter/DeclutterSellView.tsx |   if (!f.drops) return { floorCents: price, dropPct: 0 }; |   if (!f.drops) return { floorCents: price, dropPct: 5 };
    await waitFor(() => expect(drops).toEqual([[NEW_ID, 0]]));
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 4000 })]);
    expect(await screen.findByText("Off: it stays at your price")).toBeInTheDocument();
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

  // Owner 2026-10-28: "claude did not help with the listing so idk how to get it to do the listing for me".
  // @mutate src/components/declutter/DeclutterSellView.tsx | autoStart: !itemId && held.length > 0 | autoStart: false
  // @mutate src/components/declutter/DeclutterSellView.tsx | : held.length > 0 ? () => requestAiDraftFromPhotos(held) : null), | : null),
  // @mutate src/components/declutter/SellAiDraft.tsx |       setForm((f) => mergeAiDraft(f, atStart, d)); |       void atStart;
  it("a NEW listing: Claude writes it by itself once the first photos are added, shows it, and can write it again", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    // Before any photo there is nothing for Claude to read.
    expect(document.querySelector("[data-ai-draft]")).toBeNull();
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg"), jpg("b.jpg")] } });
    // It runs by itself, with the photos still on the device, and says so.
    expect(await screen.findByText("Claude is writing your listing…")).toBeInTheDocument();
    expect(aiCalls).toEqual([["a.jpg", "b.jpg"]]);
    expect(calls).toEqual([]); // nothing created or uploaded for it
    aiAnswer.release!();
    expect(await screen.findByText("Claude wrote your listing")).toBeInTheDocument();
    expect(document.querySelector("[data-ai-title]")).toHaveTextContent(DRAFT.title);
    // Adding more photos does not run it again by itself...
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("c.jpg")] } });
    await screen.findByText(/^3 of 12/);
    expect(aiCalls).toHaveLength(1);
    // ...but "Write it again" does, from every photo now held.
    aiAnswer.hold = false;
    fireEvent.click(screen.getByRole("button", { name: "Write it again" }));
    await waitFor(() => expect(aiCalls).toEqual([["a.jpg", "b.jpg"], ["a.jpg", "b.jpg", "c.jpg"]]));
    // What Claude wrote is the seller's form to edit on step 2.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Title")).toHaveValue(DRAFT.title);
    expect(screen.getByLabelText(/Anything else/)).toHaveValue(DRAFT.description);
    expect(screen.getByRole("radio", { name: "Furniture" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Lightly used" })).toHaveAttribute("aria-checked", "true");
  });

  it("what the seller typed while Claude was writing is kept", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    fireEvent.change(document.getElementById("sell-files")!, { target: { files: [jpg("a.jpg")] } });
    await screen.findByText("Claude is writing your listing…");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Grandma's dresser" } });
    aiAnswer.release!();
    await waitFor(() => expect(screen.getByLabelText(/Anything else/)).toHaveValue(DRAFT.description));
    expect(screen.getByLabelText("Title")).toHaveValue("Grandma's dresser");
  });
});
