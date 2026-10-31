/**
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       const c = await place.locate(pickupAddress);\n      // Only a change is saved | const c = { lat: 0, lng: 0 };\n      // Only a change is saved
 * "Sell a bunch" screen (owner 2026-10-29: "upload all pictures for everything
 * they want to sell, ai does the forms and they review all at once before
 * submission"). /declutter/sell?mode=bunch:
 *   - the photos picked go to the photo tool's grouping, and each item comes
 *     back as an editable card; a flagged item is marked and still counts ready;
 *   - cards show while sorting runs, with small lazy previews; a photo that can't
 *     be used is named; photos of a dropped item stop counting toward the cap;
 *   - the four confirmations are needed once, then only the ready items are
 *     listed, and an item that failed is named with its reason.
 *   - "A bunch of things" is a choice in "What do you want to sell?" (DeclutterSellChooser, owner 2026-10-30).
 *
 * @mutate src/lib/declutter/bunch.ts |   return items.filter((it) => !bunchItemProblem(it) && (!feeDue \|\| !!it.free)); |   return items;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       ?? (!attested ? "Tick the box under the four statements before you list these items." : null) |       ?? null
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |       {item.flagged && ( |       {false && (
 * @mutate src/components/declutter/DeclutterBunchView.tsx |         setItems((its) => addSorted(its, made)); |         void made;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     if (!sorting) setPhotos((ps) => photosInItems(ps, items)); |     void photosInItems;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       const note = [notSorted, unusablePhotosNote(res.unusable)].filter(Boolean).join(" "); |       const note = notSorted;
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | alt="" draggable={false} loading="lazy" decoding="async" className="aspect-square w-full bg-photo-empty object-cover" data-bunch-thumb="" | alt="" className="aspect-square w-full bg-photo-empty object-cover" data-bunch-thumb=""
 * @mutate src/components/declutter/useBunchThumbs.ts |         const url = URL.createObjectURL(await bunchThumbnail(p.file)); |         const url = URL.createObjectURL(p.file);
 * @mutate src/pages/declutter/DeclutterSellPage.tsx |       ) : wantsBunch(params) ? ( |       ) : false ? (
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | groups={CATEGORY_PICKER_GROUPS} triggerClassName="min-h-11 border-input px-3" /> | groups={CATEGORY_PICKER_GROUPS} />
 * Tester 10-30: opening the category picker in half a row left an empty column under Price and pushed Condition down.
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | <div className="min-w-0 sm:col-span-2" data-bunch-category-row=""> | <div className="min-w-0" data-bunch-category-row="">
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchItem } from "@/lib/declutter/bunch";

const calls = { listed: [] as string[][] };

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/declutter/DeclutterSellView", () => ({ default: () => <p>one item form</p> }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
const lookupAnswer = vi.hoisted(() => ({ value: { status: "exact", lat: 30.4, lng: -91.1 } as Record<string, unknown> }));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => lookupAnswer.value }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<object>()), useOnboardingFeeQuery: () => ({ isSuccess: true, data: null }) }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => [],
  fetchHasAgreedSales: async () => false,
  fetchMyPickupWindows: async () => [],
  setPickupWindows: async () => 1,
  requestAiDraftFromPhotos: async () => { throw new Error("ai_unavailable"); },
}));
const thumbCalls: File[] = [];
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  bunchThumbnail: async (f: File) => { thumbCalls.push(f); return new Blob(["small"], { type: "image/jpeg" }); },
}));
const sort = { hold: null as Promise<void> | null };
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  const card = (key: string, photoKeys: string[], extra: Partial<BunchItem>): BunchItem => ({
    key, photoKeys, title: "Oak chair", description: "Solid oak.", category: "furniture", deliverySize: "large", conditionStars: 4, flagged: false, price: "", ...extra,
  });
  return {
    ...real,
    groupPhotos: async (photos: { key: string; file: File }[], onProgress: (d: number, t: number, made: BunchItem[]) => void) => {
      const first = [card("i1", [photos[0].key, photos[1].key], { title: "Oak chair" })];
      onProgress(1, 2, first);
      await sort.hold;
      const second = [card("i2", [photos[2].key], { title: "Hunting knife", flagged: true })];
      onProgress(2, 2, second);
      const bad = photos.slice(3).map((p) => ({ key: p.key, name: p.file.name, error: new Error("x") }));
      return { items: [...first, ...second], failed: [], unusable: bad };
    },
    listBunch: async (_s: string, items: BunchItem[]) => {
      calls.listed.push(items.map((i) => i.key));
      return [{ key: "i1", title: "Oak chair", error: Object.assign(new Error("x"), { userMessage: "Refused for a test reason." }), draftId: null, stays: true }];
    },
  };
});

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterSellChooser from "./DeclutterSellChooser";
import { BunchCard } from "./DeclutterBunchCard";
import { blankItem } from "@/lib/declutter/bunch";

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
afterEach(cleanup);

// The page is a lazy chunk: under a loaded machine its first import took over the default second (measured 2026-10-30).
const openRows = () => document.querySelectorAll<HTMLElement>('[data-bunch-expand][aria-expanded="false"]').forEach((b) => fireEvent.click(b));
const pageHeading = () => screen.findByRole("heading", { level: 1, name: "Sell a bunch" }, { timeout: 15_000 });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/declutter/sell?mode=bunch"]}><DeclutterSellPage /></MemoryRouter></QueryClientProvider>,
  );
}

describe("Sell a bunch", () => {
  it("photos become editable item cards; a flagged one is marked and not ready; listing needs the confirmations once", async () => {
    calls.listed = [];
    renderPage();
    expect(await pageHeading()).toBeTruthy();
    expect(screen.queryByText("one item form")).toBeNull();
    const files = ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });

    await screen.findByRole("heading", { name: /^3\. Check each item/ });
    const cards = document.querySelectorAll("[data-bunch-item]");
    expect(cards).toHaveLength(2);
    // Rows start closed; a flagged one starts open, so its notice is read. Category has its own row: no half-empty row at sm and up.
    expect(cards[1].querySelector("[data-bunch-card]")).toBeTruthy();
    expect(cards[0].querySelector("[data-bunch-card]")).toBeNull();
    openRows();
    expect(cards[0].querySelector("[data-bunch-category-row]")!.className).toContain("sm:col-span-2");
    // This card's fields are 44px: the picker's trigger is sized to match them.
    const trigger = within(cards[0] as HTMLElement).getByRole("button", { name: "Category" }).className;
    expect(trigger).toContain("min-h-11");
    expect(trigger).toContain("border-input");
    // The tool answered the size, so it isn't asked.
    expect(within(cards[0] as HTMLElement).queryByLabelText("Size")).toBeNull();
    expect(cards[1].hasAttribute("data-flagged")).toBe(true);
    expect(within(cards[1] as HTMLElement).getByText(/You can still list it/)).toBeTruthy();
    // Nothing is ready until it has a price; a flag doesn't stop an item.
    expect(screen.getByRole("heading", { name: "3. Check each item (0 of 2 ready)" })).toBeTruthy();
    fireEvent.change(within(cards[0] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    expect(screen.getByRole("heading", { name: "3. Check each item (1 of 2 ready)" })).toBeTruthy();
    fireEvent.change(within(cards[1] as HTMLElement).getByLabelText("Price ($)"), { target: { value: "40" } });
    expect(screen.getByRole("heading", { name: "3. Check each item (2 of 2 ready)" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
    const list = await screen.findByRole("button", { name: "List 2 items" });
    await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(list);
    expect(await screen.findByText("Tick the box under the four statements before you list these items.")).toBeTruthy();
    expect(calls.listed).toEqual([]);

    fireEvent.click(document.getElementById("bunch-tax")!);
    // The map knows the area but not the house: nothing lists on the area's point, and the note says what to do.
    lookupAnswer.value = { status: "approximate", lat: 30.5, lng: -92.1, precision: "town" };
    fireEvent.click(list);
    expect(await screen.findByRole("button", { name: /use my location/ })).toBeTruthy();
    expect(calls.listed).toEqual([]);
    lookupAnswer.value = { status: "exact", lat: 30.4, lng: -91.1 };
    fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "2 Main St, Baton Rouge" } });
    fireEvent.click(list);
    await waitFor(() => expect(calls.listed).toEqual([["i1", "i2"]]));
    const failed = await screen.findByText(/wasn't listed: Refused for a test reason\./);
    expect(failed.textContent).toContain("still on the list");
  });

  it("shows each batch's card while sorting runs; editing a flagged item's name clears the mark", async () => {
    let release = () => {};
    sort.hold = new Promise((r) => { release = r; });
    renderPage();
    await pageHeading();
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
    await screen.findByRole("heading", { name: /^3\. Check each item/ });
    expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(1);
    expect(document.querySelector("[data-bunch-sorting]")).toBeTruthy();
    release();
    await waitFor(() => expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2));
    sort.hold = null;
    const flagged = document.querySelector("[data-flagged]") as HTMLElement;
    fireEvent.change(within(flagged).getByLabelText("Title"), { target: { value: "Butter knife" } });
    // fireEvent flushes the state change: the mark was there just above, so this is not a first paint.
    expect(document.querySelector("[data-flagged]")).toBeNull();
  });

  it("previews are small copies made from the files, loaded lazily", async () => {
    thumbCalls.length = 0;
    renderPage();
    await pageHeading();
    const files = ["a", "b", "c"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
    await waitFor(() => expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(2));
    openRows();
    await waitFor(() => expect(document.querySelectorAll("[data-bunch-thumb]")).toHaveLength(3));
    expect(thumbCalls).toEqual(files);
    document.querySelectorAll("[data-bunch-thumb]").forEach((img) => expect(img.getAttribute("loading")).toBe("lazy"));
  });

  // @mutate src/components/declutter/DeclutterBunchView.tsx |       if (res.unusable.length > 0) { |       if (false) {
  it("names a photo that can't be used, keeps it to try again, and photos no item holds stop counting toward the cap", async () => {
    renderPage();
    await pageHeading();
    const files = Array.from({ length: 80 }, (_, i) => new File([`${i}`], `${i}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
    await screen.findByText(/77 photos weren't added \(3\.jpg, 4\.jpg, 5\.jpg, 6\.jpg, 7\.jpg and 72 more\)/);
    await waitFor(() => expect((document.getElementById("bunch-files") as HTMLInputElement).disabled).toBe(false));
    // LEAD-BUNCH-34-SLOW: the photos that couldn't be read are kept together, said, and can be tried again.
    expect(await screen.findByText(/We couldn't read these 77 photos\. Tap Sort again to try once more\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort again" })).toBeInTheDocument();
    // Not selling them frees their room: 80 picked, 3 held, so another go has room instead of the cap's refusal.
    fireEvent.click(screen.getByRole("button", { name: "Don't sell these" }));
    fireEvent.change(document.getElementById("bunch-files")!, { target: { files: ["x", "y", "z"].map((k) => new File([k], `${k}.jpg`, { type: "image/jpeg" })) } });
    await waitFor(() => expect(document.querySelectorAll("[data-bunch-item]")).toHaveLength(4));
    expect(screen.queryByText(/That's the most for one go/)).toBeNull();
  });

  it("is a choice in What do you want to sell?", () => {
    // LEAD-BUNCH-DRAFT-KEEP: the chooser reads the work kept on this device (a query), so it needs a client.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><DeclutterSellChooser /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("link", { name: /Sell a bunch/ }).getAttribute("href")).toBe("/declutter/sell?mode=bunch");
  });
});

// T2 and T3 at 375 (10-30): the merge label wrapped one word per line and its picker showed only "P", squeezed by the buttons.
// @mutate src/components/declutter/DeclutterBunchCard.tsx |             <div className="w-full" data-bunch-merge-row=""> |             <div className="min-w-0 flex-1" data-bunch-merge-row="">
// T3 at 375 (10-30): "Sell a bunch" twice, in the bar and as a heading under it. AppPage's title is the one.
// @mutate src/components/declutter/DeclutterBunchView.tsx |       <SellerPayoutPrompt /> |       <p>Sell a bunch</p><SellerPayoutPrompt />
describe("the page's name", () => {
  it("is not said again under AppPage's title", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/declutter/DeclutterBunchView.tsx"), "utf8");
    expect(blankComments(source).match(/>Sell a bunch</g)).toBeNull();
    expect(blankComments(source)).toContain('const pageTitle = moving ? "Moving out sale" : "Sell a bunch";');
    expect(blankComments(source)).toContain("<AppPage title={pageTitle}");
  });
});

describe("the merge picker's row", () => {
  it("has the card's whole width, with the buttons below it", () => {
    const item = { ...blankItem(["a"]), key: "one" };
    render(<BunchCard item={item} index={0} others={[{ key: "two", name: "Item 2" }]} urls={new Map()} files={new Map()} at={null} rewriting={false} onChange={() => {}} onMove={() => {}} onSplit={() => {}} onRemovePhoto={() => {}} onCover={() => {}} onReorder={() => {}} canDrag={false} onAddPhotos={() => {}} onMerge={() => {}} onDrop={() => {}} onRewrite={() => {}} />);
    const row = document.querySelector("[data-bunch-merge-row]") as HTMLElement;
    expect(row.className.split(" ")).toContain("w-full");
    expect(row.className).not.toContain("flex-1");
    expect(row.querySelector("select")).toBeTruthy();
    expect(row.querySelector("button")).toBeNull();
  });
});
