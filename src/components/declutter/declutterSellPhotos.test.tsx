/**
 * Photo-first selling on ONE screen (owner 2026-10-19 photo first, as on Mercari / OfferUp; owner 2026-10-29 "ai
 * should always be doing most of the work for declutter listing"): a NEW listing is one screen, photos at the top,
 * Claude's listing as summary rows, the tax box and one "Post it". Before Post the photos wait on
 * the device (previews only, nothing uploaded); Post creates the draft and uploads them to it, then lists it.
 * The API is stubbed: this checks the order of calls, not the backend.
 *
 * @mutate src/components/declutter/useSellFlowState.ts |       const added = await uploadPhotos(id, waiting); |       const added = 0; void waiting;
 * @mutate src/components/declutter/useSellFlowState.ts |     if (!itemId) {\n      setHeld((h) => [...h, ...list]);\n      return;\n    } |     if (!itemId) return;
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |   const count = uploaded.length + held.length; |   const count = uploaded.length;
 * @mutate src/components/declutter/SellOneScreen.tsx |           <SellPhotos\n |           <span hidden />{false && <SellPhotos\n
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |             {uploaded.length === 0 && i === 0 && <CoverChip />} |             {<CoverChip />}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DropSchedule } from "./DeclutterSellSteps";
import { SellHandoverChoices } from "./SellHandoverChoices";

const PLACE = { id: "pl", position: 1, label: "Home", address: "100 Main Street, Baton Rouge, LA 70802", area: "Mid-City, Baton Rouge", lat: 30.45, lng: -91.15, weekdays: [6] };
const savedRow = vi.hoisted(() => ({ value: null as unknown, places: [] as unknown[] }));
const NEW_ID = "0f0e0d0c-0b0a-4908-8706-0504030201ff";
const calls: string[] = [];
const aiCalls: string[][] = [];
const drafts: { priceCents: number; floorPriceCents: number }[] = [];
const drops: [string, number][] = [];
const DRAFT = {
  title: "Mid-century walnut dresser", description: "Six drawers, solid walnut, light scratches on top.",
  category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false,
  // Owner 2026-10-29: Claude sets the starting price too.
  priceDollars: 45, priceReason: "Solid walnut with light wear, so it should sell fast.",
};
/** Claude's answer: resolves at once unless a test holds it to look at the "writing" state. */
const aiAnswer = {
  fails: false,
  hold: false,
  release: null as null | (() => void),
  // Photo coach (owner 2026-10-29): a test may add a cover pick and a photo tip.
  extra: {} as { coverPhoto?: number; photoTip?: string },
  next(): Promise<typeof DRAFT> {
    const d = { ...DRAFT, ...this.extra };
    if (!this.hold) return Promise.resolve(d);
    return new Promise((res) => { this.release = () => res(d); });
  },
};

// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
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
// No earlier listing: the form starts blank (the last-setup prefill has its own test, declutterSellLastSetup).
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
// No remembered listing choices saved (owner 2026-10-30): the app's defaults; the save at Post goes nowhere.
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()), fetchSellerDefaults: async () => savedRow.value, saveSellerDefaults: async () => true }));
// The seller's saved place, from the one-time setup: what a new listing uses (sellerSetup.test.tsx asks for it).
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => savedRow.places }));
// The porch weekday chips' read (SellPorchDays.tsx; its own test is sellPorchDays): none picked.
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
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
  setKeepUp: async () => true,
  setHandovers: vi.fn(async (_id: string, ways: string[]) => ways),
  fetchItemHandovers: async () => null,
  addPhoto: async (_u: string, id: string, f: File) => { calls.push(`addPhoto:${id}:${f.name}`); return "p"; },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  // Owner 2026-10-28: a new listing's held photos go to Claude by themselves (SellAiDraft.tsx).
  requestAiDraftFromPhotos: (files: File[]) => { aiCalls.push(files.map((f) => f.name)); return aiAnswer.fails ? Promise.reject(new Error("ai_unavailable")) : aiAnswer.next(); },
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => { calls.push("windows"); return 1; },
  attestItem: async () => { calls.push("attest"); },
  publishItem: async () => { calls.push("publish"); return "live"; },
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import * as api from "@/lib/declutter/api";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

/** Where Post lands: the address and the router state the "Your listing is live" sheet reads. */
function SellingTabProbe() {
  const loc = useLocation();
  return <p data-testid="landed" data-search={loc.search} data-state={JSON.stringify(loc.state)}>Selling tab</p>;
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/sell"]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          <Route path="/declutter" element={<SellingTabProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const addPhotos = (...names: string[]) => fireEvent.change(document.getElementById("sell-files")!, { target: { files: names.map(jpg) } });
const rowValue = (field: string) => document.querySelector(`[data-summary-row="${field}"] [data-summary-value]`)?.textContent ?? null;

/** The tax box: all Post needs besides the photos and Claude's listing (the rest comes from the seller's settings). */
function fillWaysAndTax() {
  fireEvent.click(document.getElementById("sell-tax")!);
}

describe("photo-first selling, one screen", () => {
  beforeEach(() => {
    savedRow.value = null;
    savedRow.places = [PLACE];
    calls.length = 0;
    aiCalls.length = 0;
    drafts.length = 0;
    drops.length = 0;
    aiAnswer.fails = false;
    aiAnswer.hold = false;
    aiAnswer.release = null;
    aiAnswer.extra = {};
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  // Owner 2026-10-29: a new listing is ONE screen. No step walk ("Continue", "1 of 5"); the summary rows and one Post.
  // @mutate src/components/declutter/DeclutterSellView.tsx |   if (!itemId) return <SellOneScreen />; |   void SellOneScreen;
  // @mutate src/components/declutter/SellOneScreen.tsx |           {s.publishing ? "Posting…" : "Post it"} |           {s.publishing ? "Posting…" : "Continue"}
  // @mutate src/components/declutter/SellSummaryCard.tsx |           <Row {...row("size")} title="Size" value="" empty> | <Row {...row("size")} title="Size" value="" empty field="title">
  it("a NEW listing is one screen: photos, the summary rows, the tax box and Post it; no step walk, and no settings on it (owner 2026-10-30)", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Show it off" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByText(/\b\d of 5\b/)).toBeNull();
    expect(screen.getByRole("button", { name: "Post it" })).toBeInTheDocument();
    const rows = [...document.querySelectorAll("[data-summary-row]")].map((r) => r.getAttribute("data-summary-row"));
    expect(rows).toEqual(["title", "price", "category", "condition", "size", "description"]);
    // Size is asked only while nothing has answered it (audit single-free #15), with nothing picked for them.
    expect(rowValue("size")).toBe("Add a size");
    expect(screen.queryByRole("heading", { name: "How buyers get it" })).toBeNull();
    expect(screen.queryByLabelText("Pickup address")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(document.querySelector("[data-auto-free]")).toBeNull();
    expect(document.querySelector("[data-uses-settings]")).not.toBeNull();
    expect(document.querySelector("[data-sell-tax]")).not.toBeNull();
    // Once the photo tool answers it, the owner's six are what is left.
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    expect([...document.querySelectorAll("[data-summary-row]")].map((r) => r.getAttribute("data-summary-row"))).toEqual(["title", "price", "category", "condition", "description"]);
  });

  // DA-5 (Declutter audit 2026-10-30): a free listing's private address said "Only the buyer who pays sees it".
  // @mutate src/components/declutter/SellFormParts.tsx | : (form.free ? "Private. Only the person who gets it sees it." : | : (false ? "Private. Only the person who gets it sees it." :
  it("DA-5: the private pickup address names who sees it: the buyer who pays, or (free) the person who gets it", async () => {
    // The words now live on a saved draft's step form (a new listing has no address box).
    const src = readFileSync(join(process.cwd(), "src/components/declutter/SellFormParts.tsx"), "utf8");
    expect(src).toContain('(form.free ? "Private. Only the person who gets it sees it." : "Private. Only the buyer who pays sees it.")');
  });

  it("held photos wait on the device; Post creates the draft, uploads them, saves the price choice, then lists it", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    expect(document.querySelector("[data-add-photos]")).not.toBeNull();
    addPhotos("a.jpg", "b.jpg", "c.jpg");
    expect(await screen.findByText(/^3 of 12/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(3);
    // Board 31a: the first photo, and only the first, is marked as the cover.
    const covers = document.querySelectorAll("[data-cover-chip]");
    expect(covers).toHaveLength(1);
    expect(covers[0].closest("[data-held-photo]")).toBe(document.querySelectorAll("[data-held-photo]")[0]);
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    expect(calls).toEqual([]); // nothing uploaded before there is a draft

    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    // Owner 2026-10-30 (via the lead): drops are ON by default, with the lowest price at half the asking price.
    // @mutate src/lib/declutter/sellerDefaults.ts | { keepUp: true, drops: true, dropPct: 5, | { keepUp: true, drops: false, dropPct: 5,
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: on, 5% each evening, never below $20."));
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`, "attest", "publish"]),
    );
    // The seller's choice is what the server stores: their lowest price and their step.
    // @mutate src/components/declutter/useSellFlowState.ts |       if (!form.free) await setDropPct(id, choice.dropPct); |       void choice;
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 2000 })]);
    expect(drops).toEqual([[NEW_ID, 5]]);
  });

  // Board 31b: the drop strip follows the real rule (the seller's step, down to a whole dollar, never below the lowest).
  // @mutate src/components/declutter/DeclutterSellSteps.tsx |     cur = Math.max(floorCents, dropStepCents(cur, pct)); |     cur = Math.max(floorCents, Math.floor(cur * 0.9));
  it("the drop strip on a saved draft's step form follows the real rule", () => {
    render(<DropSchedule priceCents={4000} floorCents={3000} pct={10} />);
    const strip = document.querySelector("[data-drop-schedule]")!;
    expect([...strip.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["$36", "$32", "$30"]);
    expect(strip.textContent).toMatch(/10% less each evening/);
    expect(strip.textContent).toMatch(/may stop sooner/);
  });

  // Audit posting 1030 #3: Post lands on the new address, carrying what the sheet reads.
  // @mutate src/components/declutter/useSellFlowState.ts | navigate("/declutter?tab=selling", { state | navigate("/declutter?view=selling", { state
  it("Post lands on ?tab=selling with the listing in router state, so \"Your listing is live\" opens", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    const landed = await screen.findByTestId("landed");
    expect(landed).toHaveAttribute("data-search", "?tab=selling");
    expect(JSON.parse(landed.getAttribute("data-state")!)).toEqual({ justListed: { itemId: NEW_ID, status: "live" } });
  });

  it("price drops off in settings: the lowest price is saved as the price and the step as 0, so it never drops", async () => {
    savedRow.value = { keepUp: true, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"] };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: off. It stays at $40 until you change it."));
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    // @mutate src/components/declutter/sellForm.ts |   if (!f.drops \|\| priceTooLowForDrops(f.price)) return { floorCents: price, dropPct: 0 }; |   if (priceTooLowForDrops(f.price)) return { floorCents: price, dropPct: 0 };
    await waitFor(() => expect(drops).toEqual([[NEW_ID, 0]]));
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 4000 })]);
  });

  it("Post will not go until what is missing is there, and says what only once it is tapped", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    // Audit #45: nothing is printed under the live Post until it is tapped.
    // @mutate src/components/declutter/SellOneScreen.tsx |     tried && bad?.at === at ? |     bad?.at === at ?
    expect(screen.queryByTestId("sell-form-problem")).toBeNull();
    // @mutate src/components/declutter/SellOneScreen.tsx |     if (bad) { |     if (false) {
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByTestId("sell-form-problem")).toHaveTextContent("Add at least 1 photo.");
    expect(calls).toEqual([]);
  });

  // Audit DC-2: each blocker is said IN its own row; by the button only a short pointer.
  // @mutate src/components/declutter/SellSummaryCard.tsx |       {open && children}\n      {problem} |       {open && children}
  // @mutate src/components/declutter/SellOneScreen.tsx |           {problemAt("settings")}\n |           \n
  it("what blocks Post is said in the row that needs it, not only by the button (DC-2)", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert").closest('[data-summary-row="price"]')).not.toBeNull();
    expect(screen.getAllByTestId("sell-form-problem")).toHaveLength(1);
    expect(screen.getByTestId("sell-form-pointer")).toHaveTextContent("Fix what's marked above, then post.");
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert").closest('[data-summary-row="title"]')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it("settings missing somehow: Post says so beside them", async () => {
    savedRow.places = [];
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert").closest('[data-sell-row="settings"]')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it("the photo tool failed: Size is asked, not guessed, and Post waits for it (audit single-free #15)", async () => {
    aiAnswer.fails = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await waitFor(() => expect(aiCalls).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('[data-summary-row="size"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add title" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Blue couch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.click(document.getElementById("sell-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByText("Pick a size, so buyers know what it takes to move it.");
    expect(calls).toEqual([]);
    // Nothing is preselected for them.
    const row = document.querySelector('[data-summary-row="size"]') as HTMLElement;
    expect(within(row).queryAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    fireEvent.click(within(row).getByRole("radio", { name: /Large/ }));
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(calls).toContain("publish"));
    expect(drafts[0]).toEqual(expect.objectContaining({ deliverySize: "large" }));
    // A new listing uses the saved pickup times: Post never writes over them.
    expect(calls).not.toContain("windows");
  });

  // Audit DC-1: the one-screen form still said "these go up when you save on step 4" and "change anything on the
  // next steps" (there are no steps). The class: nothing on the one screen talks about steps.
  // @mutate src/components/declutter/SellOneScreen.tsx | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} oneScreen /> | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} />
  // @mutate src/components/declutter/DeclutterSellPhotos.tsx | {held.length > 0 ? " · these go up when you save" : ""} | {held.length > 0 ? " · these go up when you save on step 4" : ""}
  it("the one screen never talks about steps (DC-1)", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(screen.getByText("Check it below and change anything.")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-count]")?.textContent).toMatch(/these go up when you save$/);
    const words = document.body.textContent ?? "";
    expect(words.length).toBeGreaterThan(200);
    expect(words).not.toMatch(/\bsteps?\b|step \d|next steps/i);
  });

  it("a held photo can be taken out before Post, and never goes up", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    fireEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    expect(document.querySelectorAll("[data-held-photo]")).toHaveLength(1);
    expect(screen.getByText(/^1 of 12/)).toBeInTheDocument();
  });

  // Owner 2026-10-28: "claude did not help with the listing so idk how to get it to do the listing for me".
  // @mutate src/components/declutter/useSellFlowState.ts | autoStart: !urlItemId && held.length > 0 | autoStart: false
  // @mutate src/components/declutter/useSellFlowState.ts | : held.length > 0 ? withCoverFile(held, (f) => requestAiDraftFromPhotos(f, hintAt)) : null), | : null),
  // @mutate src/components/declutter/SellAiDraft.tsx | : mergeAiDraft(f, atStart, d))); | : f));
  // @mutate src/components/declutter/SellAiDraft.tsx |     price: typeof d.priceDollars === "number" && d.priceDollars >= 1 ? pick("price", String(d.priceDollars)) : current.price, |     price: current.price,
  // @mutate src/components/declutter/SellAiDraft.tsx |           <AiPriceLine draft={d} /> |
  it("a NEW listing: Claude writes it by itself once the first photos are added, fills the rows, and can write it again", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    // Before any photo there is nothing for Claude to read.
    expect(document.querySelector("[data-ai-draft]")).toBeNull();
    addPhotos("a.jpg", "b.jpg");
    // It runs by itself, with the photos still on the device, and says so.
    expect(await screen.findByText("We're writing your listing…")).toBeInTheDocument();
    expect(aiCalls).toEqual([["a.jpg", "b.jpg"]]);
    expect(calls).toEqual([]); // nothing created or uploaded for it
    aiAnswer.release!();
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    expect(document.querySelector("[data-ai-title]")).toHaveTextContent(DRAFT.title);
    expect(document.querySelector("[data-ai-price]")).toHaveTextContent(`Suggested price: $45 · ${DRAFT.priceReason}`);
    // Adding more photos does not run it again by itself...
    addPhotos("c.jpg");
    await screen.findByText(/^3 of 12/);
    expect(aiCalls).toHaveLength(1);
    // ...but "Write it again" does, from every photo now held.
    aiAnswer.hold = false;
    fireEvent.click(screen.getByRole("button", { name: "Write it again" }));
    await waitFor(() => expect(aiCalls).toEqual([["a.jpg", "b.jpg"], ["a.jpg", "b.jpg", "c.jpg"]]));
    // What Claude wrote shows as the summary rows, each the seller's to edit in place.
    expect(rowValue("title")).toBe(DRAFT.title);
    expect(rowValue("description")).toBe(DRAFT.description);
    expect(rowValue("category")).toBe("Furniture");
    expect(rowValue("condition")).toBe("Lightly used");
    expect(rowValue("price")).toBe("$45");
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(screen.getByLabelText("Title")).toHaveValue(DRAFT.title);
    // Claude's price fills the price box; the seller can change it.
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    expect(screen.getByLabelText("Price")).toHaveValue("45");
  });

  // Photo coach (owner 2026-10-29): Claude's best cover goes first, and its one photo tip shows under the photos.
  // @mutate src/components/declutter/SellAiDraft.tsx |   if (!cover \|\| held[0] === cover \|\| !held.includes(cover)) return held; |   return held;
  // @mutate src/components/declutter/SellAiDraft.tsx |     return typeof d.coverPhoto === "number" ? { ...d, coverFile: files[d.coverPhoto] } : d; |     return d;
  // @mutate src/components/declutter/SellAiDraft.tsx |       onDraft?.(d); |       void onDraft;
  // @mutate src/components/declutter/SellAiDraft.tsx |         {d.photoTip && ( |         {false && (
  it("Claude's cover pick moves that photo first, and its tip shows", async () => {
    aiAnswer.extra = { coverPhoto: 1, photoTip: "A photo of the label" };
    // Previews named after their file, so the order is readable.
    URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg", "c.jpg");
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    expect(document.querySelector("[data-ai-photo-tip]")).toHaveTextContent("One more photo would help: A photo of the label");
    // b.jpg is the cover now, marked as such.
    const held = () => [...document.querySelectorAll("[data-held-photo] img")].map((i) => i.getAttribute("src"));
    await waitFor(() => expect(held()).toEqual(["blob:b.jpg", "blob:a.jpg", "blob:c.jpg"]));
    expect(document.querySelectorAll("[data-held-photo]")[0].querySelector("[data-cover-chip]")).not.toBeNull();
  });

  it("what the seller typed while Claude was writing is kept", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We're writing your listing…");
    expect(rowValue("title")).toBe("We're filling this in…");
    fireEvent.click(screen.getByRole("button", { name: "Add title" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Grandma's dresser" } });
    aiAnswer.release!();
    await waitFor(() => expect(rowValue("description")).toBe(DRAFT.description));
    expect(screen.getByLabelText("Title")).toHaveValue("Grandma's dresser");
  });

  // Owner 2026-10-28: "pick up at my door. remove that. they need the option to click which they will do, porch pick up,
  // they deliver, safe meeting spot. whatever other options we have".
  // @mutate src/components/declutter/useSellFlowState.ts |       await setHandovers(id, savedWays); |       void savedWays;
  // @mutate src/components/declutter/SellOneScreen.tsx |   if (s.savedWays.length === 0) return |   if (false) return
  // DC-4 (owner 2026-10-29): buyers can always choose Helpr delivery, so it is said plainly, never offered as a tick.
  // @mutate src/components/declutter/SellHandoverChoices.tsx | (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => w !== "delivery"); | (Object.keys(HANDOVER_CHOICE) as SellerHandover[]);
  // @mutate src/components/declutter/SellHandoverChoices.tsx |       {!free && <p className="text-ds-13 text-muted-foreground" data-helpr-delivery-always="">{HELPR_DELIVERY_ALWAYS}</p>} |
  it("the ways come from the seller's settings, and the choices never offer door pickup or a Helpr delivery tick", async () => {
    vi.mocked(api.setHandovers).mockClear();
    savedRow.value = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["delivery"] };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    // None usable: it will not post, and says where to fix it.
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByTestId("sell-form-problem")).toHaveTextContent("Choose a way buyers can get it in Settings.");
    expect(calls).toEqual([]);
    cleanup();
    savedRow.value = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["meetup"] };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Safe meeting spot"));
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["meetup"]));
    cleanup();
    render(<QueryClientProvider client={new QueryClient()}><SellHandoverChoices ways={["porch"]} setWays={() => {}} free={false} sellerDeliveryOpen /></QueryClientProvider>);
    expect([...document.querySelectorAll("[data-handover-tile]")].map((t) => t.getAttribute("data-handover-tile"))).toEqual(["porch", "seller_delivery", "meetup"]);
    expect(screen.queryByRole("checkbox", { name: "Helpr delivery" })).toBeNull();
    expect(document.querySelector("[data-helpr-delivery-always]")?.textContent).toBe(
      "Buyers can also choose Helpr delivery: a local Helpr picks it up from you and brings it to them, and the buyer pays for it.");
    expect(screen.queryByText(/Pickup at your door/)).toBeNull();
  });
});
