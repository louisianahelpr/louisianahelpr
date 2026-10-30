/**
 * Photo-first selling on ONE screen (owner 2026-10-19 photo first, as on Mercari / OfferUp; owner 2026-10-29 "ai
 * should always be doing most of the work for declutter listing"): a NEW listing is one screen, photos at the top,
 * Claude's listing as summary rows, How buyers get it, the tax box and one "Post it". Before Post the photos wait on
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
  // Owner 2026-10-29: Claude sets the starting price too.
  priceDollars: 45, priceReason: "Solid walnut with light wear, so it should sell fast.",
};
/** Claude's answer: resolves at once unless a test holds it to look at the "writing" state. */
const aiAnswer = {
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
  requestAiDraftFromPhotos: (files: File[]) => { aiCalls.push(files.map((f) => f.name)); return aiAnswer.next(); },
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  requestAiCheckWithRetry: async () => ({ checked: true, flagged: false }),
  setPickupWindows: async () => 1,
  attestItem: async () => { calls.push("attest"); },
  publishItem: async () => { calls.push("publish"); return "live"; },
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import * as api from "@/lib/declutter/api";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/sell"]}>
        <Routes>
          <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          <Route path="/declutter" element={<p>Selling tab</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const addPhotos = (...names: string[]) => fireEvent.change(document.getElementById("sell-files")!, { target: { files: names.map(jpg) } });
const rowValue = (field: string) => document.querySelector(`[data-summary-row="${field}"] [data-summary-value]`)?.textContent ?? null;

/** How buyers get it and the tax box: what Post needs besides the photos and Claude's listing. */
function fillWaysAndTax() {
  fireEvent.change(screen.getByLabelText("Area buyers see"), { target: { value: "Mid-City, Baton Rouge" } });
  fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "100 Main Street, Baton Rouge, LA 70802" } });
  fireEvent.click(document.getElementById("sell-tax")!);
}

describe("photo-first selling, one screen", () => {
  beforeEach(() => {
    calls.length = 0;
    aiCalls.length = 0;
    drafts.length = 0;
    drops.length = 0;
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
  // @mutate src/components/declutter/SellSummaryCard.tsx |         <Row {...row("size")} title="Size" | <Row {...row("size")} title="Size" field="title"
  it("a NEW listing is one screen: photos, the summary rows, How buyers get it, the tax box and Post it, no step walk", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Show it off" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByText(/\b\d of 5\b/)).toBeNull();
    expect(screen.getByRole("button", { name: "Post it" })).toBeInTheDocument();
    const rows = [...document.querySelectorAll("[data-summary-row]")].map((r) => r.getAttribute("data-summary-row"));
    expect(rows).toEqual(["title", "price", "category", "condition", "size", "description"]);
    expect(screen.getByRole("heading", { name: "How buyers get it" })).toBeInTheDocument();
    expect(document.querySelector("[data-sell-tax]")).not.toBeNull();
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
    expect(await screen.findByText("Claude wrote your listing")).toBeInTheDocument();
    expect(calls).toEqual([]); // nothing uploaded before there is a draft

    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    // Owner 2026-10-28: drops are the seller's own yes/no, OFF until they turn them on, so no lowest price is asked.
    // @mutate src/components/declutter/sellForm.ts |   drops: false,\n  dropPct: DEFAULT_DROP_PCT, |   drops: true,\n  dropPct: DEFAULT_DROP_PCT,
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
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`, "attest", "publish"]),
    );
    // The seller's choice is what the server stores: their lowest price and their step.
    // @mutate src/components/declutter/useSellFlowState.ts |       if (!form.free) await setDropPct(id, choice.dropPct); |       void choice;
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 3000 })]);
    expect(drops).toEqual([[NEW_ID, 10]]);
  });

  it("price drops left off: the lowest price is saved as the price and the step as 0, so it never drops", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("Claude wrote your listing");
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    expect(screen.getByText("Off. It stays at your price until you change it.")).toBeInTheDocument();
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    // @mutate src/components/declutter/sellForm.ts |   if (!f.drops) return { floorCents: price, dropPct: 0 }; |   if (!f.drops) return { floorCents: price, dropPct: 5 };
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

  // Audit DC-2: drops on and no lowest price scrolled to Price but printed the words only by the button, off
  // screen. Each blocker is said IN its own row; by the button only a short pointer.
  // @mutate src/components/declutter/SellOneScreen.tsx | {!form.free && <div className="space-y-2" data-sell-row="drops"><SellDropsCard s={s} />{problemAt("drops")}</div>} | {!form.free && <div className="space-y-2" data-sell-row="drops"><SellDropsCard s={s} /></div>}{problemAt("drops")}
  // @mutate src/components/declutter/SellOneScreen.tsx | ? "drops" : /price/i.test(f) | ? "price" : /price/i.test(f)
  // @mutate src/components/declutter/SellSummaryCard.tsx |       {open && children}\n      {problem} |       {open && children}
  // @mutate src/components/declutter/SellOneScreen.tsx |           {problemAt("ways")}\n |           \n
  it("what blocks Post is said in the row that needs it, not only by the button (DC-2)", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("Claude wrote your listing");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ }));
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    const problem = screen.getByRole("alert");
    expect(problem).toHaveTextContent("Set your lowest price");
    expect(problem.closest('[data-sell-row="drops"]')).not.toBeNull();
    expect(problem.closest('[data-sell-row="drops"]')!.contains(screen.getByLabelText("Lowest you'll take"))).toBe(true);
    expect(screen.getAllByTestId("sell-form-problem")).toHaveLength(1);
    expect(screen.getByTestId("sell-form-pointer")).toHaveTextContent("Fix what's marked above, then post.");
    expect(calls).toEqual([]);
    // A price out of range: in the Price row. A name too short: in the Title row.
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert").closest('[data-summary-row="price"]')).not.toBeNull();
    expect(screen.getByRole("alert").closest('[data-sell-row="drops"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert").closest('[data-summary-row="title"]')).not.toBeNull();
    // How buyers get it: in that section.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Walnut dresser" } });
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add the pickup address");
    expect(screen.getByRole("alert").closest('[data-sell-row="ways"]')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  // Audit DC-1: the one-screen form still said "these go up when you save on step 4" and "change anything on the
  // next steps" (there are no steps). The class: nothing on the one screen talks about steps.
  // @mutate src/components/declutter/SellOneScreen.tsx | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} oneScreen /> | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} />
  // @mutate src/components/declutter/DeclutterSellPhotos.tsx | {held.length > 0 ? " · these go up when you save" : ""} | {held.length > 0 ? " · these go up when you save on step 4" : ""}
  it("the one screen never talks about steps (DC-1)", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await screen.findByText("Claude wrote your listing");
    expect(screen.getByText("Check it below and change anything.")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-count]")?.textContent).toMatch(/these go up when you save$/);
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.click(screen.getByRole("switch", { name: /Lower the price if it doesn't sell/ }));
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
    expect(await screen.findByText("Claude is writing your listing…")).toBeInTheDocument();
    expect(aiCalls).toEqual([["a.jpg", "b.jpg"]]);
    expect(calls).toEqual([]); // nothing created or uploaded for it
    aiAnswer.release!();
    expect(await screen.findByText("Claude wrote your listing")).toBeInTheDocument();
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
    expect(await screen.findByText("Claude wrote your listing")).toBeInTheDocument();
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
    await screen.findByText("Claude is writing your listing…");
    expect(rowValue("title")).toBe("Claude is filling this in…");
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
  it("How buyers get it: the seller ticks the ways (no door pickup, no Helpr delivery tick), at least one, and those are what is saved", async () => {
    vi.mocked(api.setHandovers).mockClear();
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("Claude wrote your listing");
    const tiles = [...document.querySelectorAll("[data-handover-tile]")].map((t) => t.getAttribute("data-handover-tile"));
    expect(tiles).toEqual(["porch", "seller_delivery", "meetup"]);
    expect(screen.queryByRole("checkbox", { name: "Helpr delivery" })).toBeNull();
    expect(document.querySelector("[data-helpr-delivery-always]")?.textContent).toBe(
      "Buyers can also choose Helpr delivery: a local Helpr picks it up from you and brings it to them, and the buyer pays for it.");
    expect(screen.queryByText(/Pickup at your door/)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Porch pickup" })).toHaveAttribute("aria-checked", "true");
    // None ticked: it will not post.
    fireEvent.click(screen.getByRole("checkbox", { name: "Porch pickup" }));
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByTestId("sell-form-problem")).toHaveTextContent("Tick at least one way buyers can get it.");
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Safe meeting spot" }));
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(api.setHandovers).toHaveBeenCalledWith(NEW_ID, ["meetup"]));
  });
});
