/**
 * Declutter posting audit 10-30 (bulk and moving): the review list is compact rows with changes for many at once, every
 * loss can be undone, a photo can be seen, added, removed and moved by its picture, the result opens at the top, and the
 * moving sale is this same page with an optional date.
 *
 * Finding 2, compact rows and bulk:
 * @mutate src/components/declutter/DeclutterBunchRow.tsx |       {open && <div className="border-t border-border">{children}</div>} |       <div className="border-t border-border">{children}</div>
 * @mutate src/components/declutter/DeclutterBunchRow.tsx |     if (nextPriceId) document.getElementById(nextPriceId)?.focus(); |     void nextPriceId;
 * @mutate src/components/declutter/DeclutterBunchRow.tsx | inputMode="decimal" enterKeyHint="next" | inputMode="decimal"
 * Finding 3, photos:
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | onClick={() => setBig(k)} data-bunch-photo={k} | onClick={() => toggle(k)} data-bunch-photo={k}
 * @mutate src/lib/declutter/bunch.ts | { ...it, photoKeys: [photoKey, ...it.photoKeys.filter((k) => k !== photoKey)] } | it
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     setItems((its) => addPhotosToItem(its, key, usable.map((p) => p.key))); |     void addPhotosToItem;
 * @mutate src/lib/declutter/bunch.ts | { ...it, photoKeys: it.photoKeys.filter((k) => k !== photoKey) } : it | it : it
 * Finding 4, undo:
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     setUndo({ said, before: items, photos, otherPrice }); |     void said;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     setPhotos(undo.photos); |     void undo.photos;
 * @mutate src/lib/declutter/bunch.ts |         title: theirWords \|\| !it.title.trim() ? from.title : it.title, |         title: it.title,
 * @mutate src/lib/declutter/bunch.ts |       const priced = typedPrice(it) ? it : typedPrice(from) ? from : it.price.trim() ? it : from; |       const priced = it;
 * @mutate src/lib/declutter/bunch.ts |   if (!from \|\| !into \|\| !typedPrice(from) \|\| !typedPrice(into) \|\| from.price.trim() === into.price.trim()) return null; |   return null;
 * Finding 9, the result:
 * @mutate src/components/declutter/DeclutterBunchResults.tsx |     heading.current?.focus(); |     void heading;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       {results && <BunchResults results={results} userId={user.id} inSale={!!moveDate} | {false && <BunchResults results={results!} userId={user.id} inSale={!!moveDate}
 * @mutate src/lib/declutter/bunch.ts | status: r.status, id: p.id, | status: r.status,
 * Finding 15, what's left:
 * @mutate src/components/declutter/DeclutterBunchView.tsx |     setOpenRows((m) => new Map(m).set(key, true));\n    const id = need | const id = need
 * Finding 14, saved drafts:
 * @mutate src/components/declutter/BunchDraftsSection.tsx |   const going = drafts.filter((d) => !noPhotos(d.id) && !leftOut.has(d.id)); |   const going = drafts;
 * Finding 16, progress:
 * @mutate src/lib/declutter/bunch.ts |   return `${so} ${timeLeft(((total - done) * AI_CHECK_GAP_MS) / 1000)}`; |   return `${done} of ${total} batches done`;
 * Finding 18, a split item:
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       void writeItem(made, `Item ${next.indexOf(made) + 1}`, true); |       void made;
 * Finding 20, names:
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | aria-label={`Don't sell ${name}`} | aria-label="Don't sell this"
 * Size only when the tool didn't answer (lead 10-30):
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |         {item.sizeUnknown && ( |         {true && (
 * @mutate src/lib/declutter/bunch.ts |   return it.sizeUnknown ? BUNCH_SIZE_PROBLEM : null; |   return null;
 * The moving sale:
 * @mutate src/lib/declutter/bunch.ts |           id = choices.moveOutOn\n            ? await deps.createMoveDraft(choices.moveOutOn, place, fields)\n            : await deps.createDraft(fields, appId); |           id = await deps.createDraft(fields, appId);
 * @mutate src/components/declutter/DeclutterBunchView.tsx | { ...choices.choices, moveOutOn: moveDate \|\| null }, | choices.choices,
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   const showMove = movingOpen && (moving \|\| !!moveDate); |   const showMove = false;
 * @mutate src/components/declutter/DeclutterBunchView.tsx |       ?? (moveDate ? moveDateProblem(moveDate, today) : null)\n |
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BunchChoices, BunchItem, GroupAnswer, ListDeps } from "@/lib/declutter/bunch";

const state = vi.hoisted(() => ({
  listed: [] as { items: BunchItem[]; choices: BunchChoices | undefined }[],
  outcome: null as null | ((items: BunchItem[]) => unknown[]),
  draft: vi.fn(),
  mine: [] as { id: string; status: string; title: string; current_price_cents: number }[],
  withPhotos: [] as string[],
  moveOutOn: null as string | null,
  published: [] as string[][],
  hold: null as Promise<void> | null,
}));

// LEAD-BUNCH-34-SLOW: no early photo uploads here (they would reach prod storage); declutterBunchEarlyUpload.test.ts pins them.
vi.mock("@/lib/declutter/bunchStage", () => ({
  BunchStager: class {
    idFor() { return undefined; }
    path() { return Promise.resolve(null); }
    used() {}
    sync() { return new Map(); }
  },
}));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/components/declutter/DeclutterPriceHint", () => ({ default: () => null }));
vi.mock("@/components/declutter/BunchFeeGate", () => ({ BunchFeeGate: () => null, useSetupFeeDueCents: () => null }));
vi.mock("@/components/declutter/useBunchSaved", () => ({
  useBunchSaved: () => ({ note: null, restoredCount: 0, dismissRestored: () => {}, applyStep: () => {}, clearSaved: () => {} }),
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/lib/addressLookup", () => ({ lookUpAddress: async () => ({ status: "exact", lat: 30.4, lng: -91.1 }) }));
vi.mock("@/lib/declutter/porchDays", () => ({ fetchMyPorchDays: async () => null, saveMyPorchDays: async () => [], PORCH_DAYS_NOT_DEPLOYED: "not_deployed" }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/lastSetup", () => ({ fetchLastSetup: async () => null }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<object>()), fetchSellerDefaults: async () => null, saveSellerDefaults: async () => true }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => state.withPhotos.map((id) => ({ item_id: id })),
  fetchMyPickupWindows: async () => [],
  setPickupWindows: async () => 1,
  requestAiDraftFromPhotos: state.draft,
}));
vi.mock("@/lib/declutter/moves", async (orig) => ({
  ...(await orig<object>()),
  fetchMyMoveItems: async () => [],
  fetchMyMoveOutDate: async () => state.moveOutOn,
  fetchMyMovingSale: async () => null,
  louisianaToday: () => "2026-10-30",
  publishMany: async (ids: string[]) => { state.published.push(ids); return ids.map((id) => ({ id, status: "live" })); },
}));
vi.mock("@/lib/declutter/photos", async (orig) => ({
  ...(await orig<object>()),
  bunchThumbnail: async () => new Blob(["small"], { type: "image/jpeg" }),
  cleanListingPhoto: async (f: File) => f,
}));
vi.mock("@/lib/declutter/bunch", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/bunch")>();
  const sorted = (key: string, photoKeys: string[], extra: Partial<BunchItem>): BunchItem => ({ ...real.blankItem(photoKeys), key, sizeUnknown: false, description: "Solid.", category: "furniture", conditionStars: 4, ...extra });
  return {
    ...real,
    groupPhotos: async (photos: { key: string }[], onProgress: (d: number, t: number, made: BunchItem[]) => void) => {
      const made = [
        sorted("i1", photos.slice(0, 2).map((p) => p.key), { title: "Oak chair", price: "40", aiPrice: "40" }),
        sorted("i2", photos.slice(2, 3).map((p) => p.key), { title: "Brass lamp", price: "" }),
      ];
      if (photos[3]) made.push(sorted("i3", [photos[3].key], { title: "Side table", price: "30", aiPrice: "30" }));
      onProgress(1, 1, made);
      return { items: made, failed: [], unusable: [] };
    },
    listBunch: async (_s: string, items: BunchItem[], _p: unknown, _pl: unknown, _w: unknown, _o: unknown, _d: unknown, _st: unknown, choices?: BunchChoices) => {
      state.listed.push({ items, choices });
      await state.hold;
      return state.outcome ? state.outcome(items) : items.map((i) => ({ key: i.key, title: i.title, status: "live", id: `id-${i.key}` }));
    },
  };
});

import BunchFlow from "./DeclutterBunchView";
import { addPhotosToItem, blankItem, bulkEdit, bunchItemNeed, bunchItemProblem, bunchNeedsLine, editBunchItem, itemsFromAnswer, listingProgressLine, makeCover, mergeItems, mergePriceClash, sortProgressLine, takePhotoOff } from "@/lib/declutter/bunch";

const realListBunch = async () => (await vi.importActual<typeof import("@/lib/declutter/bunch")>("@/lib/declutter/bunch")).listBunch;

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
beforeEach(() => {
  state.listed = [];
  state.outcome = null;
  state.draft.mockReset();
  state.mine = [];
  state.withPhotos = [];
  state.moveOutOn = null;
  state.published = [];
  state.hold = null;
});
afterEach(cleanup);

async function open(moving = false, photos = 4) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow moving={moving} /></MemoryRouter></QueryClientProvider>);
  const files = Array.from({ length: photos }, (_, i) => new File([`${i}`], `${i}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(document.getElementById("bunch-files")!, { target: { files } });
  await screen.findByRole("heading", { name: /^\d\. Check each item/ });
}
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-bunch-row]")];
const row = (key: string) => document.querySelector(`[data-bunch-row="${key}"]`) as HTMLElement;
const openRow = (key: string) => fireEvent.click(row(key).querySelector("[data-bunch-expand]")!);
const undoBar = () => document.querySelector("[data-bunch-undo]") as HTMLElement | null;
const undo = () => fireEvent.click(within(undoBar()!).getByRole("button", { name: "Undo" }));

async function listNow() {
  fireEvent.change(screen.getByLabelText("Pickup address"), { target: { value: "1 Main St, Baton Rouge" } });
  fireEvent.change(row("i2").querySelector("input[aria-label='Price ($)']")!, { target: { value: "15" } });
  fireEvent.click(document.getElementById("bunch-tax")!);
  const list = await screen.findByRole("button", { name: "List 3 items" });
  await waitFor(() => expect((list as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(list);
}

describe("finding 2: compact rows, each edited on its own", () => {
  it("a closed row has its picture, name, category and condition, price in place, and no form until it's tapped", async () => {
    await open();
    expect(rows()).toHaveLength(3);
    expect(row("i1").textContent).toContain("Oak chair");
    expect(row("i1").textContent).toContain("Furniture");
    expect(row("i1").querySelector("[data-bunch-card]")).toBeNull();
    expect(row("i1").querySelectorAll("input, select, textarea, button[role='checkbox']").length).toBeLessThanOrEqual(2);
    openRow("i1");
    expect(within(row("i1")).getByLabelText("Title")).toBeTruthy();
  });

  it("Next on the phone keyboard goes to the next item's price", async () => {
    await open();
    const first = row("i1").querySelector<HTMLInputElement>("input[aria-label='Price ($)']")!;
    const second = row("i2").querySelector<HTMLInputElement>("input[aria-label='Price ($)']")!;
    expect(first.getAttribute("enterkeyhint")).toBe("next");
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement).toBe(second);
  });

  // LEAD-BUNCH-REMOVE-PCT (owner 2026-10-31): no bulk-edit box and no per-item choose boxes; each item is edited on its
  // own (tap to open, the price on its row). The bulk helper stays only for a merge's "use the other price".
  // @mutate src/components/declutter/DeclutterBunchRow.tsx |       <div className="flex items-center gap-2 p-2">\n | <div className="flex items-center gap-2 p-2"><input type="checkbox" aria-label={`Choose ${name}`} />\n
  it("there is no bulk-edit box and no choose boxes: each item is edited on its own", async () => {
    await open();
    expect(document.querySelector("[data-bunch-bulk]")).toBeNull();
    expect(screen.queryByText(/These change all|Choose all|% off suggested|Price below our suggestion/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Set price|Make free|Set condition)$/ })).toBeNull();
    expect(screen.queryAllByRole("checkbox", { name: /^Choose / })).toHaveLength(0);
    expect(rows().length).toBeGreaterThan(1);
  });

  it("bulkEdit: only those items", () => {
    const a = { ...blankItem(["a"]), key: "a", price: "3", aiPrice: "3" };
    const b = { ...blankItem(["b"]), key: "b", price: "9", aiPrice: "9", free: true };
    expect(bulkEdit([a, b], new Set(["a"]), { conditionStars: 1 })[1].conditionStars).toBe(3);
  });
});

describe("finding 3: a photo can be seen, added, removed, made the cover and moved by its picture", () => {
  it("tap to see it big; Make cover puts it first; Move picks an item by its picture and takes one tap", async () => {
    await open();
    openRow("i1");
    const photos = () => [...row("i1").querySelectorAll<HTMLElement>("[data-bunch-photo]")].map((b) => b.dataset.bunchPhoto);
    const [first, second] = photos();
    fireEvent.click(row("i1").querySelector(`[data-bunch-photo="${second}"]`)!);
    const sheet = await waitFor(() => { const el = document.querySelector("[data-bunch-photo-sheet]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(sheet.querySelector("[data-bunch-big-photo]")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Make cover" }));
    expect(photos()).toEqual([second, first]);

    fireEvent.click(row("i1").querySelector(`[data-bunch-photo="${first}"]`)!);
    const again = await waitFor(() => { const el = document.querySelector("[data-bunch-photo-sheet]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(within(again).getByRole("button", { name: "Move this photo to Brass lamp" }).querySelector("img")).toBeTruthy();
    fireEvent.click(within(again).getByRole("button", { name: "Move this photo to Brass lamp" }));
    expect(photos()).toEqual([second]);
    undo();
    expect(photos()).toEqual([second, first]);
  });

  it("Remove photo takes it off; removing the last one removes the item, and Undo brings it back", async () => {
    await open();
    openRow("i2");
    fireEvent.click(row("i2").querySelector("[data-bunch-photo]")!);
    const sheet = await waitFor(() => { const el = document.querySelector("[data-bunch-photo-sheet]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove photo" }));
    expect(row("i2")).toBeNull();
    expect(undoBar()!.textContent).toContain("last photo");
    undo();
    expect(row("i2")).toBeTruthy();
  });

  it("Add photo joins this item without the photo tool", async () => {
    await open();
    openRow("i2");
    const input = within(row("i2")).getByLabelText("Add a photo to Brass lamp");
    fireEvent.change(input, { target: { files: [new File(["n"], "n.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(row("i2").querySelectorAll("[data-bunch-photo]")).toHaveLength(2));
    expect(rows()).toHaveLength(3);
  });

  it("the tick chooses several, to move or split together", async () => {
    await open();
    openRow("i1");
    const ticks = row("i1").querySelectorAll("[data-bunch-tick]");
    fireEvent.click(ticks[0]);
    expect(ticks[0].getAttribute("aria-pressed")).toBe("true");
    const chosen = row("i1").querySelector("[data-bunch-chosen]") as HTMLElement;
    expect(chosen.querySelectorAll("[data-bunch-pick]")).toHaveLength(2);
    expect(within(chosen).getByRole("button", { name: "Split into a new item" })).toBeTruthy();
  });

  it("helpers: the cover moves first and nothing else changes; add goes on the end", () => {
    const a = { ...blankItem(["x", "y", "z"]), key: "a" };
    expect(makeCover([a], "a", "z")[0].photoKeys).toEqual(["z", "x", "y"]);
    expect(makeCover([a], "a", "nope")[0].photoKeys).toEqual(["x", "y", "z"]);
    expect(addPhotosToItem([a], "a", ["n"])[0].photoKeys).toEqual(["x", "y", "z", "n"]);
    expect(takePhotoOff([a], "a", "y")[0].photoKeys).toEqual(["x", "z"]);
  });
});

describe("finding 4: Merge and Don't sell this can be undone, and a merge keeps what was typed", () => {
  it("Don't sell this says so, and Undo brings the item and its typed words back", async () => {
    await open();
    openRow("i2");
    fireEvent.change(within(row("i2")).getByLabelText("Title"), { target: { value: "My grandmother's lamp" } });
    fireEvent.click(within(row("i2")).getByRole("button", { name: "Don't sell My grandmother's lamp" }));
    expect(row("i2")).toBeNull();
    undo();
    expect((within(row("i2")).getByLabelText("Title") as HTMLInputElement).value).toBe("My grandmother's lamp");
    expect(undoBar()).toBeNull();
  });

  it("Merge keeps the words and price the seller typed; Undo puts both items back", async () => {
    await open();
    openRow("i2");
    fireEvent.change(within(row("i2")).getByLabelText("Title"), { target: { value: "My grandmother's lamp" } });
    fireEvent.change(within(row("i2")).getByLabelText("Price ($)"), { target: { value: "175" } });
    fireEvent.change(within(row("i2")).getByLabelText("Same thing as another item?"), { target: { value: "i1" } });
    fireEvent.click(within(row("i2")).getByRole("button", { name: "Merge My grandmother's lamp" }));
    expect(row("i2")).toBeNull();
    expect(row("i1").textContent).toContain("My grandmother's lamp");
    expect((row("i1").querySelector("input[aria-label='Price ($)']") as HTMLInputElement).value).toBe("175");
    undo();
    expect(rows()).toHaveLength(3);
    expect((row("i1").querySelector("input[aria-label='Price ($)']") as HTMLInputElement).value).toBe("40");
  });

  it("two typed prices: the kept item's stands and the other is offered", async () => {
    await open();
    fireEvent.change(row("i1").querySelector("input[aria-label='Price ($)']")!, { target: { value: "50" } });
    openRow("i2");
    fireEvent.change(within(row("i2")).getByLabelText("Price ($)"), { target: { value: "175" } });
    fireEvent.change(within(row("i2")).getByLabelText("Same thing as another item?"), { target: { value: "i1" } });
    fireEvent.click(within(row("i2")).getByRole("button", { name: /^Merge/ }));
    expect((row("i1").querySelector("input[aria-label='Price ($)']") as HTMLInputElement).value).toBe("50");
    fireEvent.click(within(undoBar()!).getByRole("button", { name: "Use $175 instead" }));
    expect((row("i1").querySelector("input[aria-label='Price ($)']") as HTMLInputElement).value).toBe("175");
  });

  it("merge rules: longer details stay, the tool's words lose to the seller's, a flag is kept", () => {
    const tool = { ...blankItem(["a"]), key: "t", title: "Lamp", description: "Short.", flagged: true };
    const typed = editBunchItem([{ ...blankItem(["b"]), key: "s", title: "x", description: "A much longer description." }], "s", { title: "Gran's lamp" })[0];
    const [m] = mergeItems([typed, tool], "s", "t");
    expect([m.title, m.description, m.flagged, m.photoKeys]).toEqual(["Gran's lamp", "A much longer description.", true, ["a", "b"]]);
    expect(mergePriceClash([{ ...typed, price: "5" }, { ...tool, price: "5" }], "s", "t")).toBeNull();
    expect(mergePriceClash([{ ...typed, price: "5" }, { ...tool, price: "6", aiPrice: "6" }], "s", "t")).toBeNull();
    expect(mergePriceClash([{ ...typed, price: "5" }, { ...tool, price: "6" }], "s", "t")).toBe("5");
  });
});

describe("finding 9: the result opens at the top and takes focus", () => {
  it("names each listing with its link, puts what failed first, and offers share and list more", async () => {
    state.outcome = (items) => [
      { key: items[0].key, title: items[0].title, status: "live", id: "id-1" },
      { key: items[1].key, title: items[1].title, status: "pending_review", id: "id-2" },
      { key: items[2].key, title: items[2].title, error: Object.assign(new Error("x"), { userMessage: "Refused." }), draftId: null, stays: true },
    ];
    await open();
    await listNow();
    const card = await waitFor(() => { const el = document.querySelector("[data-bunch-results]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(document.activeElement).toBe(within(card).getByRole("heading", { name: "What happened" }));
    // Above the steps, so it's what the seller sees.
    expect(card.compareDocumentPosition(document.getElementById("bunch-photos") as HTMLElement ?? document.querySelector("#bunch-files")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Oak chair" }).getAttribute("href")).toBe("/declutter/item/id-1");
    expect(card.querySelector("[data-bunch-failed]")!.compareDocumentPosition(card.querySelector("[data-bunch-listed]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Share your listings" })).toBeTruthy();
    expect(within(card).getByRole("link", { name: "See your listings" }).getAttribute("href")).toBe("/declutter?view=selling");
    fireEvent.click(within(card).getByRole("button", { name: "Fix Side table" }));
    await waitFor(() => expect(row("i3").querySelector("[data-bunch-card]")).toBeTruthy());
    fireEvent.click(within(card).getByRole("button", { name: "List more" }));
    expect(document.querySelector("[data-bunch-results]")).toBeNull();
  });

  it("every listed item's id reaches the result", async () => {
    const deps = {
      createDraft: vi.fn(async () => "d1"), createMoveDraft: vi.fn(async () => "m1"), updateDraft: vi.fn(), addPhoto: vi.fn(async () => "ph"), removePhoto: vi.fn(),
      itemStatuses: vi.fn(async () => new Map()), withdrawItem: vi.fn(), setHandovers: vi.fn(), setDropPct: vi.fn(), setKeepUp: vi.fn(),
      publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
    } as unknown as ListDeps;
    const item = { ...blankItem(["p"]), key: "k", title: "Oak", price: "10", sizeUnknown: false };
    const place = { areaLabel: "Mid-City", pickupAddress: "1 Main", pickupLat: 30, pickupLng: -91 };
    const out = await (await realListBunch())("u1", [item], new Map([["p", new File(["p"], "p")]]), place, ["porch"], () => {}, deps);
    expect(out[0]).toMatchObject({ status: "live", id: "d1" });
  });
});

describe("finding 15: what's left points at the field", () => {
  it("says how many need what, and tapping it opens the item at that field", async () => {
    await open();
    const needs = document.querySelector("[data-bunch-needs]") as HTMLElement;
    expect(needs.textContent).toBe("1 needs a price");
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    act(() => fireEvent.click(needs));
    raf.mockRestore();
    expect(row("i2").querySelector("[data-bunch-card]")).toBeTruthy();
  });

  it("counts each need", () => {
    const named = { ...blankItem(["a"]), title: "Oak", sizeUnknown: false };
    expect(bunchNeedsLine([named, { ...named }, { ...blankItem(["b"]), price: "5", sizeUnknown: false }])).toBe("2 need a price, 1 needs a name");
    expect(bunchNeedsLine([{ ...named, price: "5" }])).toBeNull();
  });
});

describe("finding 14: saved drafts are named, and one with no photos is linked, not listed", () => {
  it("lists only the ticked drafts that have photos", async () => {
    state.mine = [
      { id: "d1", status: "draft", title: "Old couch", current_price_cents: 5000 },
      { id: "d2", status: "draft", title: "Old rug", current_price_cents: 2000 },
      { id: "d3", status: "draft", title: "No pictures", current_price_cents: 2000 },
    ];
    state.withPhotos = ["d1", "d2"];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><BunchFlow /></MemoryRouter></QueryClientProvider>);
    const link = await screen.findByRole("link", { name: "Add photos to No pictures" });
    expect(link.getAttribute("href")).toBe("/declutter/sell?item=d3");
    fireEvent.click(within(document.querySelector("[data-bunch-drafts-list]") as HTMLElement).getByRole("checkbox", { name: "Old rug" }));
    fireEvent.click(document.getElementById("bunch-drafts-tax")!);
    fireEvent.click(screen.getByRole("button", { name: "List 1 draft" }));
    await waitFor(() => expect(state.published).toEqual([["d1"]]));
  });
});

describe("finding 16: progress talks about the seller's things", () => {
  it("sorting says what's found and how long is left, never batches", () => {
    expect(sortProgressLine(2, 14, 5)).toBe("Found 5 items so far. About 1 minute left.");
    expect(sortProgressLine(0, 1, 0)).toBe("Looking through your photos. Less than a minute left.");
    expect(sortProgressLine(0, 10, 0)).not.toMatch(/batch/);
  });
  it("listing names the item, and which half it's in", () => {
    expect(listingProgressLine(0, 8, ["Lamp", "Chair", "Rug", "Desk"])).toBe("Getting 1 of 4 ready: Lamp. About 1 minute left.");
    expect(listingProgressLine(6, 8, ["Lamp", "Chair", "Rug", "Desk"])).toBe("Listing 3 of 4: Rug. Less than a minute left.");
    expect(listingProgressLine(0, 8, [])).toBe("Getting 1 of 4 ready. About 1 minute left.");
  });
  it("while listing, the bar announces it in those words", async () => {
    let go = () => {};
    state.hold = new Promise((r) => { go = r; });
    await open();
    await listNow();
    const line = await waitFor(() => { const el = document.querySelector("[data-bunch-progress]") as HTMLElement; expect(el).not.toBeNull(); return el; });
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(line.closest("[data-bunch-bar]")).toBeTruthy();
    expect(line.textContent).toContain("Getting 1 of 3 ready: Oak chair.");
    expect(line.textContent).not.toMatch(/steps|batch/);
    go();
    await waitFor(() => expect(document.querySelector("[data-bunch-results]")).not.toBeNull());
    expect(document.querySelector("[data-bunch-progress]")).toBeNull();
  });
});

describe("finding 18: a split item gets its own words", () => {
  it("it's written without another tap, keeps the flag rule, and what the seller typed meanwhile stays", async () => {
    let answer: (v: unknown) => void = () => {};
    state.draft.mockImplementation(() => new Promise((r) => { answer = r; }));
    await open();
    openRow("i1");
    fireEvent.click(row("i1").querySelectorAll("[data-bunch-tick]")[1]);
    fireEvent.click(within(row("i1").querySelector("[data-bunch-chosen]") as HTMLElement).getByRole("button", { name: "Split into a new item" }));
    await waitFor(() => expect(state.draft).toHaveBeenCalledTimes(1));
    const made = rows()[1];
    fireEvent.change(within(made).getByLabelText("Price ($)"), { target: { value: "12" } });
    await act(async () => { answer({ title: "Oak stool", description: "Round.", category: "furniture", deliverySize: "small", conditionStars: 4, flagged: false, priceDollars: 20 }); });
    await waitFor(() => expect((within(rows()[1]).getByLabelText("Title") as HTMLInputElement).value).toBe("Oak stool"));
    expect((within(rows()[1]).getByLabelText("Price ($)") as HTMLInputElement).value).toBe("12");
    expect(within(rows()[1]).queryByLabelText("Size")).toBeNull();
  });
});

describe("finding 20: repeated buttons say which item", () => {
  it("Merge, Don't sell, Write it again and Free carry the item's name", async () => {
    await open();
    openRow("i1");
    const r = within(row("i1"));
    expect(r.getByRole("button", { name: "Don't sell Oak chair" })).toBeTruthy();
    expect(r.getByRole("button", { name: "Merge Oak chair" })).toBeTruthy();
    expect(r.getByRole("button", { name: "Write it again: Oak chair" })).toBeTruthy();
    expect(r.getByRole("checkbox", { name: "Give Oak chair away free" })).toBeTruthy();
    expect(r.getByRole("button", { name: "See Oak chair, photo 1" })).toBeTruthy();
  });
});

describe("size is asked only when the photo tool didn't answer it (lead 10-30)", () => {
  it("answered: not asked, and not a problem; not answered: asked, and the item waits for it", () => {
    const answer: GroupAnswer = { items: [{ photos: [0], title: "Oak", description: "", category: "furniture", deliverySize: "small", conditionStars: 4, flagged: false, priceDollars: 20 }], leftover: [1] };
    const photo = (k: string) => ({ key: k, file: new File([k], k) });
    const [told, blank] = itemsFromAnswer(answer, [photo("a"), photo("b")]);
    expect(told.sizeUnknown).toBe(false);
    expect(bunchItemProblem(told)).toBeNull();
    // A photo the tool didn't place waits in the not-sorted pile; "These are one item" makes it an item, size not known.
    expect(blank.notSorted).toBe(true);
    expect(bunchItemNeed(blank)).toBeNull();
    expect(blank.sizeUnknown).toBe(true);
    const named = { ...blank, notSorted: false, title: "Rug", price: "5" };
    expect(bunchItemProblem(named)).toMatch(/Pick a size/);
    const [picked] = editBunchItem([named], named.key, { deliverySize: "xl" });
    expect(picked.sizeUnknown).toBe(false);
    expect(bunchItemProblem(picked)).toBeNull();
  });

  it("the form shows Size only while it's unknown", async () => {
    await open();
    openRow("i1");
    expect(within(row("i1")).queryByLabelText("Size")).toBeNull();
    expect(within(row("i1")).getByLabelText("Title")).toBeTruthy();
    expect(within(row("i1")).getByLabelText("Description")).toBeTruthy();
    expect(within(row("i1")).getByLabelText("Condition")).toBeTruthy();
  });
});

describe("the moving sale is this page with an optional date", () => {
  const place = { areaLabel: "Mid-City", pickupAddress: "1 Main", pickupLat: 30, pickupLng: -91 };
  const makeDeps = () => ({
    createDraft: vi.fn(async () => "plain"), createMoveDraft: vi.fn(async () => "moved"), updateDraft: vi.fn(), addPhoto: vi.fn(async () => "ph"), removePhoto: vi.fn(),
    itemStatuses: vi.fn(async () => new Map()), withdrawItem: vi.fn(), setHandovers: vi.fn(), setDropPct: vi.fn(), setKeepUp: vi.fn(),
    publishMany: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, status: "live" as const }))),
  });
  const item = { ...blankItem(["p"]), key: "k", title: "Oak", price: "40", sizeUnknown: false };
  const files = new Map([["p", new File(["p"], "p")]]);
  const choices = { keepUp: false, drops: true, dropPct: 5, floorPct: 50 };

  it("a date makes the draft through the moving sale's call, and the price-drop step is still set (audit finding 17)", async () => {
    const deps = makeDeps();
    await (await realListBunch())("u1", [item], files, place, ["porch"], () => {}, deps as unknown as ListDeps, () => {}, { ...choices, moveOutOn: "2026-11-14" });
    expect(deps.createMoveDraft).toHaveBeenCalledWith("2026-11-14", place, expect.objectContaining({ title: "Oak", priceCents: 4000, floorPriceCents: 2000 }));
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(deps.setDropPct).toHaveBeenCalledWith("moved", 5);
  });

  it("no date is an ordinary listing", async () => {
    const deps = makeDeps();
    await (await realListBunch())("u1", [item], files, place, ["porch"], () => {}, deps as unknown as ListDeps, () => {}, { ...choices, moveOutOn: null });
    expect(deps.createDraft).toHaveBeenCalledTimes(1);
    expect(deps.createMoveDraft).not.toHaveBeenCalled();
  });

  it("the date is on the moving page only, is optional, reaches the listing, and a past one stops it beside the field", async () => {
    await open(true);
    expect(screen.getByRole("heading", { level: 1, name: "Moving out sale" })).toBeTruthy();
    expect(document.querySelector("[data-bunch-move]")).toBeTruthy();
    await listNow();
    await waitFor(() => expect(state.listed).toHaveLength(1));
    expect(state.listed[0].choices?.moveOutOn).toBeNull();
    cleanup();

    await open(true);
    fireEvent.change(document.getElementById("bunch-move-date")!, { target: { value: "2026-10-01" } });
    expect(document.querySelector("[data-bunch-move-problem]")!.textContent).toMatch(/past/);
    state.listed = [];
    await listNow();
    expect(await screen.findByText(/can't be in the past/, { selector: "[data-bunch-problem-list]" })).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById("bunch-move-date"));
    expect(state.listed).toEqual([]);
    fireEvent.change(document.getElementById("bunch-move-date")!, { target: { value: "2026-11-14" } });
    fireEvent.click(screen.getByRole("button", { name: "List 3 items" }));
    await waitFor(() => expect(state.listed).toHaveLength(1));
    expect(state.listed[0].choices?.moveOutOn).toBe("2026-11-14");
    expect(await screen.findByRole("link", { name: "See your sale" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share your sale" })).toBeTruthy();
  });

  it("the plain page has no date; a seller with a sale adds to it on its date, and can end it", async () => {
    await open(false);
    expect(document.querySelector("[data-bunch-move]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Sell a bunch" })).toBeTruthy();
    cleanup();

    state.moveOutOn = "2026-11-20";
    await open(true);
    await waitFor(() => expect((document.getElementById("bunch-move-date") as HTMLInputElement).value).toBe("2026-11-20"));
    expect(await screen.findByRole("button", { name: "End the moving sale" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hire a Helpr for moving day" }).getAttribute("href")).toContain("2026-11-20");
  });
});
