/**
 * Photo-first selling on ONE screen (owner 2026-10-19 photo first, as on Mercari / OfferUp; owner 2026-10-29 "ai
 * should always be doing most of the work for declutter listing"): a NEW listing is one screen, photos at the top,
 * Claude's listing as summary rows, the tax box and one "Post it". Before Post the photos wait on
 * the device (previews only, nothing uploaded); Post creates the draft and uploads them to it, then lists it.
 * The API is stubbed: this checks the order of calls, not the backend.
 *
 * @mutate src/components/declutter/useSellFlowState.ts |       await uploadHeld(id, waiting); |       void waiting;
 * @mutate src/components/declutter/useSellFlowState.ts |       setHeld((h) => [...h, ...good]);\n |       void good;\n
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |   const count = uploaded.length + held.length; |   const count = uploaded.length;
 * @mutate src/components/declutter/SellOneScreen.tsx |           <SellPhotos\n |           <span hidden />{false && <SellPhotos\n
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx |             ) : uploaded.length === 0 && i === 0 && <CoverChip />} |             ) : <CoverChip />}
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
/** What the upload does: which photos fail, a hold to look at a slow Post, and what reached the draft. */
const upload = {
  failing: new Set<string>(),
  gate: null as Promise<void> | null,
  onDraft: [] as { id: string; storage_path: string }[],
};
/** LEAD-POST-SLOW (a): each photo's early upload, the id Post created with, and early objects Post didn't use. */
const early = { staged: [] as string[], attached: [] as string[], createdWith: [] as (string | undefined)[], dropped: [] as string[], serverId: null as string | null };
/** LEAD-POST-SLOW: holds for the photo check and the tax tick, to see what Post does while each is still out. */
const post = { checkGate: null as Promise<void> | null, attestGate: null as Promise<void> | null, checksStarted: 0, attested: 0 };
/** Claude's answer: resolves at once unless a test holds it to look at the "writing" state. */
const aiAnswer = {
  fails: false,
  hold: false,
  release: null as null | (() => void),
  // Photo coach (owner 2026-10-29): a test may add a cover pick and a photo tip.
  extra: {} as { coverPhoto?: number; photoTip?: string; description?: string },
  next(): Promise<typeof DRAFT> {
    const d = { ...DRAFT, ...this.extra };
    if (!this.hold) return Promise.resolve(d);
    return new Promise((res) => { this.release = () => res(d); });
  },
};

// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
// Whether a photo can be prepared is a browser matter (jsdom has no canvas): "bad*" can't.
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  cleanListingPhoto: async (f: File) => {
    if (f.name.startsWith("bad")) throw new (await import("@/lib/declutter/errors")).ListingPhotoError("We couldn't prepare this photo.");
    return f;
  },
}));
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
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.45, lng: -91.15 }) }));
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
  fetchPhotos: async () => upload.onDraft,
  fetchHasAgreedSales: async () => false,
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  // Before 20261031160546 is live the server picks its own id (early.serverId); after it, the one the app chose.
  createDraft: async (f: { priceCents: number; floorPriceCents: number }, withId?: string) => {
    calls.push("createDraft");
    drafts.push(f);
    early.createdWith.push(withId);
    return early.serverId ?? withId ?? NEW_ID;
  },
  stageListingPhoto: async (_u: string, id: string, f: File) => { early.staged.push(`${id}:${f.name}`); return `u1/declutter/${id}/${f.name}`; },
  dropStagedPhotos: async (paths: string[]) => { early.dropped.push(...paths); },
  setDropPct: async (id: string, pct: number) => { drops.push([id, pct]); return pct; },
  fetchItemDropState: async () => null,
  updateDraft: async () => "ok",
  setPorchOk: async () => true,
  setKeepUp: async () => true,
  setHandovers: vi.fn(async (_id: string, ways: string[]) => ways),
  fetchItemHandovers: async () => null,
  addPhotoSteadily: async (_u: string, id: string, f: File, o?: { uploadedPath?: string }) => {
    await upload.gate;
    if (upload.failing.has(f.name)) throw new Error("photo_not_uploaded");
    calls.push(`addPhoto:${id}:${f.name}`);
    if (o?.uploadedPath) early.attached.push(o.uploadedPath);
    upload.onDraft.push({ id: `p-${f.name}`, storage_path: f.name });
    return "p";
  },
  removePhoto: async () => undefined,
  requestAiDraft: async () => ({}),
  // Owner 2026-10-28: a new listing's held photos go to Claude by themselves (SellAiDraft.tsx).
  requestAiDraftFromPhotos: (files: File[]) => { aiCalls.push(files.map((f) => f.name)); return aiAnswer.fails ? Promise.reject(new Error("ai_unavailable")) : aiAnswer.next(); },
  requestAiCheck: async () => ({ checked: true, flagged: false }),
  requestAiCheckWithRetry: async () => { post.checksStarted += 1; calls.push("check"); await post.checkGate; return { checked: true, flagged: false }; },
  setPickupWindows: async () => { calls.push("windows"); return 1; },
  attestItem: async () => { await post.attestGate; post.attested += 1; calls.push("attest"); },
  publishItem: async () => { calls.push("publish"); return "live"; },
  // LEAD-OFFERS-CHOICE part (2): offers off goes on the draft before it is up.
  setOfferRules: async (id: string, accepts: boolean, auto: boolean) => { calls.push(`offers:${id}:${accepts}:${auto}`); },
}));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import * as api from "@/lib/declutter/api";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

/** Where Post lands: the address and the router state the "Your listing is live" sheet reads. */
function SellingTabProbe() {
  const loc = useLocation();
  return <p data-testid="landed" data-search={loc.search} data-state={JSON.stringify(loc.state)}>Selling tab</p>;
}

function open(entry = "/declutter/sell") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
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
    upload.failing = new Set();
    upload.gate = null;
    upload.onDraft.length = 0;
    aiCalls.length = 0;
    drafts.length = 0;
    drops.length = 0;
    aiAnswer.fails = false;
    aiAnswer.hold = false;
    aiAnswer.release = null;
    aiAnswer.extra = {};
    post.checkGate = null;
    post.attestGate = null;
    post.checksStarted = 0;
    post.attested = 0;
    early.staged.length = 0;
    early.attached.length = 0;
    early.createdWith.length = 0;
    early.dropped.length = 0;
    early.serverId = null;
    // The id the app picks for a new listing at its first photo (LEAD-POST-SLOW (a)).
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID as ReturnType<typeof crypto.randomUUID>);
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  // Owner 2026-10-29: a new listing is ONE screen. No step walk ("Continue", "1 of 5"); the summary rows and one Post.
  // @mutate src/components/declutter/DeclutterSellView.tsx |   if (!itemId) return <SellOneScreen />; |   void SellOneScreen;
  // @mutate src/components/declutter/SellOneScreen.tsx |           {s.publishing ? (s.postStep ?? "Posting…") : "Post it"} |           {s.publishing ? (s.postStep ?? "Posting…") : "Continue"}
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
    // The one switch is the Price row's Accept offers (LEAD-OFFERS-CHOICE part (2), owner 2026-10-31); no other setting is here.
    expect(screen.queryAllByRole("switch").map((s) => s.id)).toEqual(["sell-offers"]);
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

  // LEAD-OFFERS-CHOICE part (2) (owner 2026-10-31): the Price row's own Accept offers starts from the saved default,
  // and OFF is saved on the draft before it is listed. On (the server's default) sends nothing.
  // @mutate src/components/declutter/useSellerDefaultsPrefill.ts |     setOffersWanted?.(row ? row.acceptsOffers : SELLER_DEFAULTS.acceptsOffers); |     void row;
  // @mutate src/components/declutter/useSellFlowState.ts |         !urlItemId && !offersWanted && !form.free | false
  // @mutate src/components/declutter/SellFormParts.tsx | onCheckedChange={(v) => setOffersWanted(v === true)} | onCheckedChange={() => {}}
  // @mutate src/components/declutter/useSellerDefaultsPrefill.ts |       acceptsOffers: offersWanted ?? saved.data?.acceptsOffers ?? SELLER_DEFAULTS.acceptsOffers, |       acceptsOffers: saved.data?.acceptsOffers ?? SELLER_DEFAULTS.acceptsOffers,
  it("Accept offers starts from the saved default; off is saved on the draft before it is listed, and remembered", async () => {
    savedRow.value = { keepUp: false, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: false };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg", "c.jpg");
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    const offers = await screen.findByRole("switch", { name: /Accept offers/ });
    await waitFor(() => expect(offers).toHaveAttribute("aria-checked", "false"));
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(calls).toContain("publish"));
    expect(calls.indexOf(`offers:${NEW_ID}:false:false`)).toBeGreaterThan(-1);
    expect(calls.indexOf(`offers:${NEW_ID}:false:false`)).toBeLessThan(calls.indexOf("publish"));
  });

  it("Accept offers turned on in the form sends nothing (the server's default) and is what is remembered", async () => {
    savedRow.value = { keepUp: false, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: false };
    const defaults = await import("@/lib/declutter/sellerDefaults");
    const save = vi.spyOn(defaults, "saveSellerDefaults");
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg", "c.jpg");
    expect(await screen.findByText("We wrote your listing. Check it before you post")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    const offers = await screen.findByRole("switch", { name: /Accept offers/ });
    await waitFor(() => expect(offers).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(offers);
    expect(offers).toHaveAttribute("aria-checked", "true");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(calls).toContain("publish"));
    expect(calls.some((c) => c.startsWith("offers:"))).toBe(false);
    await waitFor(() => expect(save).toHaveBeenCalledWith("u1", expect.objectContaining({ acceptsOffers: true })));
    save.mockRestore();
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
    expect(calls).toEqual([]); // no draft yet: the photos go up into the folder of the id Post will create

    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    // Owner 2026-10-30 (via the lead): drops are ON by default, with the lowest price at half the asking price.
    // @mutate src/lib/declutter/sellerDefaults.ts | { keepUp: true, drops: true, dropPct: 5, | { keepUp: true, drops: false, dropPct: 5,
    await waitFor(() => expect(document.querySelector("[data-sell-outcome]")?.textContent).toContain("Price drops: on, 5% each evening, never below $20."));
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() =>
      expect(calls).toEqual(["createDraft", `addPhoto:${NEW_ID}:a.jpg`, `addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:c.jpg`, "attest", "publish", "check"]),
    );
    // The seller's choice is what the server stores: their lowest price and their step.
    // @mutate src/components/declutter/useSellFlowState.ts |       if (!form.free) await setDropPct(id, choice.dropPct); |       void choice;
    expect(drafts).toEqual([expect.objectContaining({ priceCents: 4000, floorPriceCents: 2000 })]);
    expect(drops).toEqual([[NEW_ID, 5]]);
  });

  // LEAD-POST-SLOW (a), owner 2026-10-31 ("nothing slow for users, under 2 s"): photos go up the moment they are added,
  // into the folder of the id the app picked; Post creates the draft with that id and only attaches them.
  // @mutate src/components/declutter/useSellFlowState.ts |       stage(ready); |       void ready;
  // @mutate src/components/declutter/useSellFlowState.ts |       const id = await createDraft(fields, wanted ?? undefined); |       const id = await createDraft(fields);
  it("photos upload when added, not on Post; Post creates the draft with their id and only attaches them", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await waitFor(() => expect(early.staged).toEqual([`${NEW_ID}:a.jpg`, `${NEW_ID}:b.jpg`]));
    expect(calls).toEqual([]);
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(calls).toContain("publish"));
    expect(early.createdWith).toEqual([NEW_ID]);
    // Attached from where they already are, in the seller's order; nothing uploaded twice, nothing thrown away.
    expect(early.attached).toEqual([`u1/declutter/${NEW_ID}/a.jpg`, `u1/declutter/${NEW_ID}/b.jpg`]);
    expect(early.staged).toHaveLength(2);
    expect(early.dropped).toEqual([]);
  });

  it("a photo taken out before Post, or a server that picked another id, never leaves an early upload attached", async () => {
    early.serverId = "11111111-2222-4333-8444-555555555555";
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await waitFor(() => expect(early.staged).toHaveLength(2));
    fireEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "40" } });
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(calls).toContain("publish"));
    // The old server's id: b.jpg is uploaded again into the right folder, and both early objects are removed.
    expect(calls).toContain(`addPhoto:${early.serverId}:b.jpg`);
    expect(early.attached).toEqual([]);
    await waitFor(() => expect(early.dropped.sort()).toEqual([`u1/declutter/${NEW_ID}/a.jpg`, `u1/declutter/${NEW_ID}/b.jpg`]));
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

  // Audit posting 1030 #2: a failed photo was thrown away and the listing went live without it.
  // @mutate src/components/declutter/useSellFlowState.ts |       if (failedPhotos.current > 0) return; |       void failedPhotos;
  // @mutate src/components/declutter/useSellFlowState.ts |     setHeld((h) => [...h.filter((f) => !up.has(f)), ...failed.filter((f) => !h.includes(f))]); |     setHeld([]);
  // @mutate src/components/declutter/SellOneScreen.tsx | onClick={() => void s.onPublish({ withoutFailed: true })} | onClick={() => void s.onPublish()}
  describe("a photo that fails at Post", () => {
    async function postWithAFailure() {
      upload.failing = new Set(["b.jpg", "d.jpg"]);
      open();
      await screen.findByRole("heading", { name: "Show it off" });
      addPhotos("a.jpg", "b.jpg", "c.jpg", "d.jpg");
      await screen.findByText("We wrote your listing. Check it before you post");
      fillWaysAndTax();
      fireEvent.click(screen.getByRole("button", { name: "Post it" }));
      return screen.findByText(/2 photos didn't upload/);
    }

    it("stays on screen, marked, and nothing is published", async () => {
      await postWithAFailure();
      expect(calls).not.toContain("publish");
      expect(document.querySelectorAll("[data-photo-failed]")).toHaveLength(2);
      expect(document.querySelector("[data-photo-count]")?.textContent).toContain("4 of 12");
      expect(screen.queryByTestId("landed")).toBeNull();
    });

    it("Try again sends only the failed ones, then publishes", async () => {
      await postWithAFailure();
      upload.failing = new Set();
      calls.length = 0;
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByTestId("landed");
      expect(calls).toEqual([`addPhoto:${NEW_ID}:b.jpg`, `addPhoto:${NEW_ID}:d.jpg`, "attest", "publish", "check"]);
    });

    it("Post with 2 photos is the seller's choice: it publishes what went up and drops the rest", async () => {
      await postWithAFailure();
      calls.length = 0;
      fireEvent.click(await screen.findByRole("button", { name: "Post with 2 photos" }));
      await screen.findByTestId("landed");
      expect(calls).toEqual(["attest", "publish", "check"]);
    });

    it("with none up, Post with is not offered", async () => {
      upload.failing = new Set(["a.jpg"]);
      open();
      await screen.findByRole("heading", { name: "Show it off" });
      addPhotos("a.jpg");
      await screen.findByText("We wrote your listing. Check it before you post");
      fillWaysAndTax();
      fireEvent.click(screen.getByRole("button", { name: "Post it" }));
      await screen.findByText(/1 photo didn't upload/);
      expect(screen.queryByRole("button", { name: /^Post with/ })).toBeNull();
    });
  });

  // Audit posting 1030 #6: Write it again wiped what the seller had corrected.
  // @mutate src/components/declutter/SellAiDraft.tsx |   const theirs = AI_KEYS.filter((k) => before.theirs.includes(k) \|\| current[k] !== before.base[k]); |   const theirs = AI_KEYS.filter((k) => before.theirs.includes(k) && current[k] !== before.base[k]);
  it("Write it again keeps what the seller changed and fills the rest", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My grandmother's dresser" } });
    fireEvent.click(screen.getByRole("button", { name: "Done title" }));
    aiAnswer.extra = { description: "Rewritten words." };
    fireEvent.click(screen.getByRole("button", { name: "Write it again" }));
    await waitFor(() => expect(rowValue("description")).toBe("Rewritten words."));
    expect(rowValue("title")).toBe("My grandmother's dresser");
    // And again: still theirs.
    fireEvent.click(screen.getByRole("button", { name: "Write it again" }));
    await waitFor(() => expect(aiCalls).toHaveLength(3));
    await screen.findByRole("button", { name: "Write it again" });
    expect(rowValue("title")).toBe("My grandmother's dresser");
  });

  // Audit posting 1030 #7: tapping Post while the AI wrote said "Give the item a name".
  // @mutate src/components/declutter/SellOneScreen.tsx |     if (writing) {\n      setTried(false); |     if (false) {\n      setTried(false);
  // @mutate src/components/declutter/SellOneScreen.tsx |   const writing = s.ai.state.status === "busy"; |   const writing = false;
  it("Post while the AI is writing says so, and posts by itself when it finishes", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We're writing your listing…");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(await screen.findByText("Still writing your listing. It posts when that's done.")).toBeInTheDocument();
    expect(screen.queryByTestId("sell-form-problem")).toBeNull();
    expect(calls).toEqual([]);
    aiAnswer.release!();
    await screen.findByTestId("landed");
    expect(calls).toContain("publish");
  });

  it("Post while the AI is writing still says what is really missing, and Don't post yet stops it", async () => {
    aiAnswer.hold = true;
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We're writing your listing…");
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect((await screen.findByTestId("sell-form-problem")).textContent).not.toMatch(/name of at least/);
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    fireEvent.click(await screen.findByRole("button", { name: "Don't post yet" }));
    aiAnswer.release!();
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(calls).not.toContain("publish");
  });

  // Audit posting 1030 #8: Edit opened the row and left the cursor elsewhere.
  // @mutate src/components/declutter/SellSummaryCard.tsx | [role=radio][aria-checked=true]")?.focus(); | [role=radio][aria-checked=true]");
  // @mutate src/components/declutter/SellSummaryCard.tsx | <p onClick={instead ? undefined : onToggle} | <p
  it("opening a row puts the cursor in it, and tapping the value opens it too", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    fireEvent.click(screen.getByRole("button", { name: "Done title" }));
    fireEvent.click(document.querySelector('[data-summary-row="description"] [data-summary-value]')!);
    expect(document.activeElement).toBe(document.getElementById("sell-desc"));
  });

  // Audit posting 1030 #9: the AI changed the cover silently and the seller couldn't change it back.
  // @mutate src/components/declutter/useSellFlowState.ts |     setCoverUndo(was[0] ?? null); |     void was;
  // @mutate src/components/declutter/useSellFlowState.ts |     if (coverChosen.current) return; |     void coverChosen;
  // @mutate src/components/declutter/DeclutterSellPhotos.tsx | onClick={() => onMakeCover(i)} | onClick={() => {}}
  it("the seller can make any photo the cover, and undo the AI's pick; after that the AI leaves it alone", async () => {
    aiAnswer.extra = { coverPhoto: 1 };
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg", "c.jpg");
    await screen.findByText("We picked the best photo for the cover.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("We picked the best photo for the cover.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Make photo 3 the cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Write it again" }));
    await waitFor(() => expect(aiCalls).toHaveLength(2));
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(screen.queryByText("We picked the best photo for the cover.")).toBeNull();
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByTestId("landed");
    expect(calls.filter((c) => c.startsWith("addPhoto")).map((c) => c.split(":")[2])).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
  });

  // Audit posting 1030 #12, #13: a giveaway talked about selling and offered a price.
  // @mutate src/components/declutter/SellOneScreen.tsx | title={form.free ? "Give it away" : "Sell an item"} | title="Sell an item"
  // @mutate src/components/declutter/SellSummaryCard.tsx | instead={form.free ? { label: "Charge for it", onClick: () => { set("free", false); setOpen(() => "price"); } } : undefined} | instead={undefined}
  // @mutate src/components/declutter/SellOneScreen.tsx | {!form.free && ai.state.status !== "done" && !s.keptWork.restored && <SellItForMeEntry />} | {<SellItForMeEntry />}
  it("Free: the words are a giveaway's, no price is suggested, and Edit price is Charge for it", async () => {
    open("/declutter/sell?free=1");
    await screen.findByRole("heading", { name: "Give it away" });
    expect(screen.queryByText("Photos that sell")).toBeNull();
    expect(screen.queryByText(/Sell it for me/)).toBeNull();
    expect(screen.getByText("Good photos")).toBeInTheDocument();
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(document.querySelector("[data-ai-price]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit price" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Charge for it" }));
    expect(document.activeElement).toBe(document.querySelector('[data-summary-row="price"] input'));
  });

  // Audit posting 1030 #19: Post reported one problem per tap.
  // @mutate src/components/declutter/SellOneScreen.tsx |     const here = tried ? problems.find((p) => p.at === at) : null; |     const here = tried && bad?.at === at ? bad : null;
  it("Post marks every problem at once and scrolls to the first", async () => {
    aiAnswer.extra = {};
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    const shown = (await screen.findAllByTestId("sell-form-problem")).map((p) => p.getAttribute("data-problem-at"));
    expect(shown).toEqual(expect.arrayContaining(["photos", "title", "price", "tax"]));
  });

  // Audit posting 1030 #18: no preview before posting.
  // @mutate src/components/declutter/SellOneScreen.tsx |         <BuyerPreview s={s} />\n |         {null}\n
  it("a preview as a buyer sits above Post, once there is a photo and a title", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    expect(document.querySelector("[data-sell-preview]")).toBeNull();
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    const preview = document.querySelector("[data-sell-preview]")!;
    expect(preview.textContent).toContain(DRAFT.title);
    expect(preview.textContent).toContain("$45");
  });

  // Audit posting 1030 #4: a photo that looked fine was lost at Post, with the AI panel taking the blame.
  // @mutate src/components/declutter/useSellFlowState.ts |           ready.push([f, await cleanListingPhoto(f)]); |           ready.push([f, f]);
  it("a photo this device can't prepare is said when it is added, by name, and isn't counted", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "bad.heic");
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(document.querySelector("[data-photo-count]")?.textContent).toContain("1 of 12");
    expect(document.querySelector("[data-photo-refused]")?.textContent).toMatch(/bad\.heic/);
    expect(aiCalls).toEqual([["a.jpg"]]);
  });

  // Audit posting 1030 #5: a slow Post said only "Posting…".
  // @mutate src/components/declutter/useSellFlowState.ts |       setPostStep(early ? `Adding photo ${i + 1} of ${list.length}` : `Uploading photo ${i + 1} of ${list.length}`); |       void early;
  it("a slow Post says which photo it is on", async () => {
    let release = () => {};
    upload.gate = new Promise<void>((r) => { release = r; });
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    // Already up since they were added (LEAD-POST-SLOW (a)): Post only attaches them.
    expect(await screen.findByRole("button", { name: "Adding photo 1 of 2" })).toBeDisabled();
    release();
    await screen.findByTestId("landed");
  });

  it("a slow Post that must still upload a photo says so (the server picked another id)", async () => {
    early.serverId = "11111111-2222-4333-8444-555555555555";
    let release = () => {};
    upload.gate = new Promise<void>((r) => { release = r; });
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(await screen.findByRole("button", { name: "Uploading photo 1 of 2" })).toBeDisabled();
    release();
    await screen.findByTestId("landed");
  });

  it("price drops off in settings: the lowest price is saved as the price and the step as 0, so it never drops", async () => {
    savedRow.value = { keepUp: true, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
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
    // @mutate src/components/declutter/SellOneScreen.tsx |     const here = tried ? problems.find((p) => p.at === at) : null; |     const here = problems.find((p) => p.at === at);
    expect(screen.queryByTestId("sell-form-problem")).toBeNull();
    // @mutate src/components/declutter/SellOneScreen.tsx |     if (bad) { |     if (false) {
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getAllByTestId("sell-form-problem")[0]).toHaveTextContent("Add at least 1 photo.");
    expect(calls).toEqual([]);
  });

  // Audit DC-2: each blocker is said IN its own row; by the button only a short pointer.
  // @mutate src/components/declutter/SellSummaryCard.tsx |       {open && !instead && children}\n      {problem} |       {open && !instead && children}
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
  // @mutate src/components/declutter/SellOneScreen.tsx | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} oneScreen free={form.free} /> | <SellAiDraftPanel state={ai.state} onRun={() => void ai.run()} free={form.free} />
  // @mutate src/components/declutter/DeclutterSellPhotos.tsx | {held.length > 0 && !heldFailed ? " · these go up when you post" : ""} | {held.length > 0 && !heldFailed ? " · these go up when you post on step 4" : ""}
  it("the one screen never talks about steps (DC-1)", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg", "b.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    expect(screen.getByText("Check it below and change anything.")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-count]")?.textContent).toMatch(/these go up when you post$/);
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
  // @mutate src/components/declutter/SellAiDraft.tsx |         setForm(() => merged.form); |         void merged;
  // @mutate src/components/declutter/SellAiDraft.tsx |     price: typeof d.priceDollars === "number" && d.priceDollars >= 1 ? String(d.priceDollars) : current.price, |     price: current.price,
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
    // Audit posting 1030 #17: said once, in the rows below, not twice.
    // @mutate src/components/declutter/SellAiDraft.tsx |         {!oneScreen && <div className="space-y-1"> |         {<div className="space-y-1">
    expect(document.querySelector("[data-ai-title]")).toBeNull();
    expect(document.querySelectorAll("[data-ai-price]")).toHaveLength(1);
    expect(document.querySelector("[data-ai-price]")).toHaveTextContent(`Suggested price: $45 · ${DRAFT.priceReason}`);
    // Audit posting 1030 #10: a photo added afterwards is read too, by itself, from every photo now held.
    // @mutate src/components/declutter/SellAiDraft.tsx |     if (photosAdded > readPhotos.current && readPhotos.current < AI_DRAFT_PHOTOS) void run(false); |     void readPhotos;
    aiAnswer.hold = false;
    addPhotos("c.jpg");
    await screen.findByText(/^3 of 12/);
    await waitFor(() => expect(aiCalls).toEqual([["a.jpg", "b.jpg"], ["a.jpg", "b.jpg", "c.jpg"]]));
    await screen.findByText("We wrote your listing. Check it before you post");
    // Past what the AI reads (4 photos), it isn't asked again.
    addPhotos("d.jpg");
    await waitFor(() => expect(aiCalls).toHaveLength(3));
    await screen.findByText("We wrote your listing. Check it before you post");
    addPhotos("e.jpg");
    await screen.findByText(/^5 of 12/);
    expect(aiCalls).toHaveLength(3);
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
  // @mutate src/components/declutter/SellOneScreen.tsx |   if (s.savedWays.length === 0 && !out.some((p) => p.at === "settings")) out.push( |   if (false) out.push(
  // DC-4 (owner 2026-10-29): buyers can always choose Helpr delivery, so it is said plainly, never offered as a tick.
  // @mutate src/components/declutter/SellHandoverChoices.tsx | (Object.keys(HANDOVER_CHOICE) as SellerHandover[]).filter((w) => w !== "delivery"); | (Object.keys(HANDOVER_CHOICE) as SellerHandover[]);
  // @mutate src/components/declutter/SellHandoverChoices.tsx |       {!free && <p className="text-ds-13 text-muted-foreground" data-helpr-delivery-always="">{HELPR_DELIVERY_ALWAYS}</p>} |
  it("the ways come from the seller's settings, and the choices never offer door pickup or a Helpr delivery tick", async () => {
    vi.mocked(api.setHandovers).mockClear();
    savedRow.value = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["delivery"], acceptsOffers: true };
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
    savedRow.value = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["meetup"], acceptsOffers: true };
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
  // LEAD-POST-SLOW (owner 2026-10-31: "Post it does nothing, or posts only after a very long delay"; "nothing slow
  // for users, under 2 s"). Prod, measured from the request log of the owner's own Post (c87b7de4): 5.8 s from the
  // draft to live, 3.9 s of it the photo check that publish waited for. Post now publishes at once and asks for the
  // check right after (20261031152545: a flag takes the listing down and tells the seller).
  // @mutate src/components/declutter/useSellFlowState.ts |       const status = await publishItem(id); |       await requestAiCheckWithRetry(id);\n      const status = await publishItem(id);
  it("LEAD-POST-SLOW: Post lands on Selling while the photo check is still out, and the check is asked after publish", async () => {
    let releaseCheck = () => {};
    post.checkGate = new Promise<void>((r) => { releaseCheck = r; });
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    fillWaysAndTax();
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    await screen.findByTestId("landed");
    // The check is asked only once the listing is up.
    expect(calls.slice(-3)).toEqual(["attest", "publish", "check"]);
    releaseCheck();
  });

  // The owner's second Post on 10-31 never reached the server (no declutter_create_item in the request log between
  // 14:40:30 and 14:41:47Z): a tap that stops on the device must say why right by the button, in the row's own words.
  // @mutate src/components/declutter/SellOneScreen.tsx | Not posted yet: {bad.message} Fix | Fix
  it("LEAD-POST-SLOW: a Post that stops on the device names what stops it, right by the button", async () => {
    open();
    await screen.findByRole("heading", { name: "Show it off" });
    addPhotos("a.jpg");
    await screen.findByText("We wrote your listing. Check it before you post");
    // Everything but the tax tick.
    fireEvent.click(screen.getByRole("button", { name: "Post it" }));
    expect(screen.getByTestId("sell-form-pointer")).toHaveTextContent("Not posted yet: Tick the box about this item before you list it.");
    expect(calls).toEqual([]);
  });
});
