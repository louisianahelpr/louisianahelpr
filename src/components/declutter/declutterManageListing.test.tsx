/**
 * Board 158: the Manage a listing sheet and the paused card. Each row makes the
 * one real call (migration 20261020064354_declutter_manage_listing.sql; its
 * backend proof is ~/.lh-pglite/b3b-manage-listing.mjs, PGlite 3x). "Edit listing" (audit 1028 D1-1, migration
 * 20261029205908, PGlite T11 in src/test/pglite/declutterHandoverChoices.pglite.mjs) shows for a live listing only.
 * @mutate src/components/declutter/DeclutterManageListing.tsx |               {item.status === "live" && ( |               {false && (
 * @mutate src/components/declutter/DeclutterManageListing.tsx |               : free ? "Pause it or take it down." : "Change the price, stop the drops, pause it or take it down."} |               : "Change the price, stop the drops, pause it or take it down."}
 * @mutate src/components/declutter/DeclutterManageListing.tsx |         {view === "edit" && <DeclutterEditListing item={item} onDone={close} />} |
 *
 * @mutate src/components/declutter/DeclutterManageListing.tsx |   const deployed = state.data !== "not_deployed"; |   const deployed = true;
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                   onCheckedChange={(on) => drops.mutate(on)} |                   onCheckedChange={(on) => drops.mutate(!on)}
 * @mutate src/components/declutter/DeclutterManageListing.tsx |       if (relist) await relistListing(item.id); |
 * @mutate src/components/declutter/DeclutterManageListing.tsx |         if (!problem) save.mutate(undefined); |         save.mutate(undefined);
 * @mutate src/components/declutter/DeclutterManageListing.tsx |       : priceCents > item.price_cents | : false
 * @mutate src/components/declutter/DeclutterManageListing.tsx |                   <RowText title="Pause listing">Hide it without losing it. Open offers close.</RowText> |                   <RowText title="Pause listing">Hide it without losing it.</RowText>
 * OWN-FREE "make it free after __ days" (AutoFreeRow, replacing Q2430's "Free on day 12"; backend proof
 * src/test/pglite/declutterAutoFreeDays.pglite.mjs).
 * @mutate src/components/declutter/AutoFreeRow.tsx | onChange={(d) => { if (!pick.isPending && d !== days) pick.mutate(d); }} | onChange={(d) => { if (!pick.isPending && d !== days) pick.mutate(days); }}
 * @mutate src/components/declutter/AutoFreeRow.tsx |   if (state.data === "not_deployed") return null; |   if (false) return null;
 * "Keep it up until it sells" (owner 2026-10-29; KeepUpRow; backend proof src/test/pglite/declutterKeepUp.pglite.mjs).
 * @mutate src/components/declutter/KeepUpRow.tsx | onCheckedChange={(v) => flip.mutate(v)} | onCheckedChange={(v) => flip.mutate(!v)}
 * @mutate src/components/declutter/KeepUpRow.tsx |   if (!itemId \|\| state.data === "not_deployed") return null; |   if (!itemId) return null;
 * @mutate src/components/declutter/DeclutterManageListing.tsx |               <KeepUpRow itemId={item.id} rowClassName={ROW} /> |
 * Smart offers (d), owner 2026-10-29 (DeclutterOfferRules; backend proof src/test/pglite/declutterSmartOffers.pglite.mjs).
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | onCheckedChange={(v) => rules.mutate({ accepts: v, auto: v && auto })} | onCheckedChange={(v) => rules.mutate({ accepts: v, auto })}
 * @mutate src/components/declutter/DeclutterOfferRules.tsx |   const on = acceptsOffers !== false; |   const on = true;
 * @mutate src/components/declutter/DeclutterOfferRules.tsx |   const auto = priv.data?.auto_offers === true; |   const auto = false;
 * @mutate src/components/declutter/DeclutterOfferRules.tsx | onClick={() => saveFloor.mutate(suggestion.floorCents)} | onClick={() => saveFloor.mutate(floorCents ?? 0)}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: unknown[][] = [];
const manage = { floor_price_cents: 3000, drops_stopped: false };
let deployed = true;
let autoFree: number | null | "not_deployed" = null;
let keepUp: boolean | "not_deployed" = false;
const offerRules = vi.hoisted(() => ({ auto: false }));
const stateReads = vi.hoisted(() => ({ n: 0 }));
const autoFreeReads = vi.hoisted(() => ({ n: 0 }));
const dropPct = vi.hoisted(() => ({ value: 5 }));

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/api", () => ({
  // Records that the manage-state read RESOLVED, so a test can wait for the data before asserting an absence.
  fetchManageState: async () => { const r = deployed ? manage : "not_deployed"; stateReads.n++; return r; },
  setListingPrice: async (...a: unknown[]) => { calls.push(["price", ...a]); return a[1]; },
  setListingDrops: async (...a: unknown[]) => { calls.push(["drops", ...a]); return a[1]; },
  pauseListing: async (...a: unknown[]) => { calls.push(["pause", ...a]); return "paused"; },
  relistListing: async (...a: unknown[]) => { calls.push(["relist", ...a]); return "live"; },
  withdrawItem: async (...a: unknown[]) => { calls.push(["withdraw", ...a]); },
  markSoldElsewhere: async (...a: unknown[]) => { calls.push(["sold_elsewhere", ...a]); },
  // The auto-free read resolves AFTER the manage-state read, as it did on a loaded CI runner (main Vitest
  // run 40816183893, issue #3685): an absence asserted before it resolved saw the row's loading render.
  fetchAutoFreeDays: async () => { await new Promise((r) => setTimeout(r, 30)); const r = autoFree; autoFreeReads.n++; return r; },
  fetchItemDropState: async () => ({ sale_mode: "offers", last_price_drop_on: null, drop_pct: dropPct.value }),
  setAutoFreeDays: async (...a: unknown[]) => { calls.push(["auto_free", ...a]); return a[1]; },
  fetchKeepUp: async () => keepUp,
  setKeepUp: async (...a: unknown[]) => { calls.push(["keep_up", ...a]); return a[1]; },
  fetchMyItemPrivate: async () => ({ floor_price_cents: 3000, pickup_address: "x", pickup_lat: 0, pickup_lng: 0, auto_offers: offerRules.auto }),
  setOfferRules: async (...a: unknown[]) => { calls.push(["offer_rules", ...a]); },
  editListing: async (...a: unknown[]) => { calls.push(["edit", ...a]); return "live"; },
  fetchItemHandovers: async () => ["porch"],
}));
// The edit form's porch-day chips read the seller's own setting; they have their own test (sellPorchDays.test.tsx).
vi.mock("./SellPorchDays", () => ({ SellPorchDays: () => null }));
vi.mock("@/lib/declutter/aiReply", () => ({
  requestSuggestedFloor: async (...a: unknown[]) => { calls.push(["suggest_floor", ...a]); return { floorCents: 2500, reason: "Similar lamps sold for $25 to $35 near you." }; },
  suggestedReplyErrorMessage: () => "unavailable",
}));

import { ManageListingSheet, SellerListingPanel } from "./DeclutterManageListing";

const item = (over: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "me", status: "live", title: "Mid-century lamp", description: "", category: "home_decor",
  condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 3800, area_label: "Delcambre",
  area_lat: 29.9, area_lng: -91.9, created_at: "2026-10-18T00:00:00Z", porch_ok: true, ...over,
});
function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}>{node}</QueryClientProvider></MemoryRouter>);
}
const sheet = (over: Record<string, unknown> = {}) =>
  wrap(<ManageListingSheet item={item(over) as never} coverUrl={null} open onOpenChange={() => {}} />);

beforeEach(() => {
  calls.length = 0;
  manage.drops_stopped = false;
  deployed = true;
  dropPct.value = 5;
  offerRules.auto = false;
});

describe("Smart offers rows (owner 2026-10-29)", () => {
  it("offers on: Accept offers, Lowest you'll take and Answer offers for me; turning offers off saves auto off too", async () => {
    offerRules.auto = true;
    sheet({ accepts_offers: true });
    const accept = await screen.findByRole("switch", { name: "Accept offers" });
    expect(accept.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Lowest you'll take")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Answer offers for me" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(accept);
    await waitFor(() => expect(calls).toContainEqual(["offer_rules", "i1", false, false]));
  });

  it("offers off: no lowest-price or auto row", async () => {
    sheet({ accepts_offers: false });
    const accept = await screen.findByRole("switch", { name: "Accept offers" });
    expect(accept.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Lowest you'll take")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Answer offers for me" })).toBeNull();
  });

  it("Claude's suggestion is saved only when the seller taps Use", async () => {
    sheet({ accepts_offers: true });
    fireEvent.click(await screen.findByRole("button", { name: "Suggest one" }));
    expect(await screen.findByText(/Similar lamps sold/)).toBeTruthy();
    expect(calls.some((c) => c[0] === "price")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use $25" }));
    await waitFor(() => expect(calls).toContainEqual(["price", "i1", 3800, 2500]));
  });
});

describe("Manage a listing (board 158)", () => {
  it("shows only the rows the server can do, with the real price and lowest price", async () => {
    sheet();
    expect(await screen.findByText("Now $38 · lowest $30")).toBeTruthy();
    for (const t of ["Change price or lowest price", "Lower the price over time", "Pause listing", "Mark sold elsewhere", "Delete listing"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getByText("Hide it without losing it. Open offers close.")).toBeTruthy();
  });

  it("D1-1: a live listing offers Edit listing, which opens the edit form; a paused one does not", async () => {
    const v = sheet();
    fireEvent.click(await screen.findByText("Edit listing"));
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toHaveValue("Mid-century lamp");
    v.unmount();
    sheet({ status: "paused" });
    await screen.findByText("Relist");
    expect(screen.queryByText("Edit listing")).toBeNull();
  });

  it("before the migration reaches prod, only taking it down is offered", async () => {
    deployed = false;
    sheet();
    expect(await screen.findByText("Mark sold elsewhere")).toBeTruthy();
    // Wait for the DATA (the manage-state read resolved and React settled), then assert the absence.
    await waitFor(() => expect(stateReads.n).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByText("Change price or lowest price")).toBeNull();
    expect(screen.queryByText("Lower the price over time")).toBeNull();
    expect(screen.queryByText("Pause listing")).toBeNull();
    expect(screen.getByText("Delete listing")).toBeTruthy();
  });

  // Audit 2 SE2-3 (A2-10): with a day count chosen, the row says it wins over a stopped price; Never says nothing of it.
  // @mutate src/components/declutter/AutoFreeRow.tsx |       {days !== null && <p | {false && <p
  it("make it free after 14 days: says it wins over a stopped price", async () => {
    autoFree = 14;
    const first = sheet();
    expect(await screen.findByText("This wins over a stopped price: on day 14 it's free.")).toBeInTheDocument();
    first.unmount();
    autoFree = null;
    sheet();
    await screen.findByRole("combobox", { name: "If it doesn't sell, make it free after" });
    expect(screen.queryByText(/wins over a stopped price/)).toBeNull();
  });

  // LEAD-FREE-AFTER-DROPDOWN (owner 2026-10-31): one row, the label on the left, a native labelled dropdown on the right.
  // @mutate src/components/declutter/AutoFreeRow.tsx |       <div className="flex items-center justify-between gap-3" data-auto-free-row=""> |       <div className="space-y-2" data-auto-free-row="">
  // @mutate src/components/declutter/AutoFreeRow.tsx |         <label htmlFor={id} | <label
  it("make it free after: one row, label left, native dropdown right, explainer under it", async () => {
    autoFree = null;
    sheet();
    const pick = await screen.findByRole("combobox", { name: "If it doesn't sell, make it free after" });
    expect(pick.tagName).toBe("SELECT");
    const row = pick.closest("[data-auto-free-row]")!;
    expect(row.className).toMatch(/\bflex\b/);
    expect(row.className).not.toMatch(/\bflex-col\b|\bflex-wrap\b/);
    expect(row.firstElementChild!.tagName).toBe("LABEL");
    expect(row.lastElementChild).toBe(pick);
    expect(row.parentElement!.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(row.nextElementSibling?.textContent).toBeTruthy(); // the explainer stays under it
  });

  it("make it free after __ days: Never by default, each choice sends the seller's choice; hidden before the migration is on prod (OWN-FREE)", async () => {
    autoFree = null;
    const a = sheet();
    const pick = await screen.findByRole("combobox", { name: "If it doesn't sell, make it free after" });
    const options = Array.from((pick as HTMLSelectElement).options).map((c) => c.textContent);
    expect(options).toEqual(["Never make it free", "7 days", "14 days", "21 days", "30 days"]);
    expect((pick as HTMLSelectElement).value).toBe("never");
    expect(screen.queryByText("Free on day 12")).toBeNull();
    fireEvent.change(pick, { target: { value: "21" } });
    await waitFor(() => expect(calls).toContainEqual(["auto_free", "i1", 21]));
    a.unmount();
    autoFree = 7;
    calls.length = 0;
    const b = sheet();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "If it doesn't sell, make it free after" }) as HTMLSelectElement).value).toBe("7"));
    fireEvent.change(screen.getByRole("combobox", { name: "If it doesn't sell, make it free after" }), { target: { value: "never" } });
    await waitFor(() => expect(calls).toContainEqual(["auto_free", "i1", null]));
    b.unmount();
    autoFree = "not_deployed";
    const readsBefore = autoFreeReads.n;
    sheet();
    expect(await screen.findByText("Lower the price over time")).toBeTruthy();
    // Wait for the auto-free DATA ("not_deployed" resolved and React settled), then assert the absence.
    await waitFor(() => expect(autoFreeReads.n).toBeGreaterThan(readsBefore));
    await act(async () => {});
    expect(screen.queryByRole("combobox", { name: "If it doesn't sell, make it free after" })).toBeNull();
    autoFree = null;
  });

  // Owner 2026-10-29: "Keep it up until it sells", with its one-line explainer, for a priced or a free listing.
  it("Keep it up until it sells: the switch sends the seller's choice, free listings too; hidden before the migration is on prod", async () => {
    keepUp = false;
    const a = sheet();
    const sw = await screen.findByRole("switch", { name: "Keep it up until it sells" });
    expect(screen.getByText("It renews every 30 days until someone buys it. You can turn this off anytime.")).toBeInTheDocument();
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sw);
    await waitFor(() => expect(calls).toContainEqual(["keep_up", "i1", true]));
    a.unmount();
    const b = sheet({ price_cents: 0, current_price_cents: 0 });
    expect(await screen.findByRole("switch", { name: "Keep it up until it sells" })).toBeInTheDocument();
    b.unmount();
    keepUp = "not_deployed";
    sheet();
    expect(await screen.findByText("Lower the price over time")).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByText("Keep it up until it sells")).toBeNull();
    keepUp = false;
  });

  // Audit DC-5: one label, one direction. Manage said "Stop price drops" (on = stopped) while the sell form said
  // "Lower the price over time" (on = drops). Now both say the form's words and on = it drops.
  // @mutate src/components/declutter/DeclutterManageListing.tsx |                   checked={!stopped} |                   checked={stopped}
  // @mutate src/components/declutter/DeclutterManageListing.tsx |                 <RowText title={DROPS_SWITCH_LABEL} id="manage-drops"> |                 <RowText title="Stop price drops" id="manage-drops">
  // @mutate src/components/declutter/SellFormParts.tsx | <span className="block text-ds-15 font-semibold text-foreground">{DROPS_SWITCH_LABEL}</span> | <span className="block text-ds-15 font-semibold text-foreground">Lower the price?</span>
  it("the drops switch has the sell form's name and on = it drops; off turns them off, on turns them back on (DC-5)", async () => {
    const { DROPS_SWITCH_LABEL } = await import("./sellForm");
    const SellFormParts = await import("./SellFormParts");
    expect(DROPS_SWITCH_LABEL).toBe("Lower the price over time");
    // The sell form's own switch reads the same constant (source check: the form needs the whole sell state to render).
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const formSrc = blankComments(readFileSync("src/components/declutter/SellFormParts.tsx", "utf8"));
    expect(typeof SellFormParts.SellDropsCard).toBe("function");
    expect(formSrc).toMatch(/<label htmlFor="sell-drops"[\s\S]{0,200}\{DROPS_SWITCH_LABEL\}/);
    const a = sheet();
    const sw = await screen.findByRole("switch", { name: DROPS_SWITCH_LABEL });
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("On. It drops each evening, never below your lowest price.")).toBeTruthy();
    expect(screen.queryByText("Stop price drops")).toBeNull();
    fireEvent.click(sw);
    await waitFor(() => expect(calls).toContainEqual(["drops", "i1", false]));
    a.unmount();
    calls.length = 0;
    manage.drops_stopped = true;
    sheet();
    const off = await screen.findByRole("switch", { name: DROPS_SWITCH_LABEL });
    await waitFor(() => expect((off as HTMLButtonElement).disabled).toBe(false));
    expect(off).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Off. It stays at $38.")).toBeTruthy();
    fireEvent.click(off);
    await waitFor(() => expect(calls).toContainEqual(["drops", "i1", true]));
  });

  // Owner 2026-10-28 (money review #3): listed with drops off (drop_pct 0) reads as off, and cannot be "turned back on" here.
  // @mutate src/components/declutter/DeclutterManageListing.tsx |   const stopped = (manage?.drops_stopped ?? false) \|\| listedOff \|\| atFloor; |   const stopped = (manage?.drops_stopped ?? false) \|\| atFloor;
  it("a listing put up without price drops shows them off and the switch is not offered", async () => {
    dropPct.value = 0;
    sheet();
    expect(await screen.findByText("Off: you listed it without price drops")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Lower the price over time" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect((sw as HTMLButtonElement).disabled).toBe(true);
  });

  it("pause calls pause; a paused listing offers Relist instead", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Pause listing"));
    await waitFor(() => expect(calls).toContainEqual(["pause", "i1"]));
    calls.length = 0;
    sheet({ status: "paused" });
    expect(screen.queryAllByText("Pause listing").length).toBeGreaterThan(0); // the first sheet is still mounted
    fireEvent.click(screen.getAllByText("Relist")[0]);
    await waitFor(() => expect(calls).toContainEqual(["relist", "i1"]));
  });

  it("delete and sold-elsewhere ask first, then take it down", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Delete listing"));
    expect(calls).toEqual([]);
    // Sellinglist-1: Relist is in History, so never "can't be undone"; the photos are said to go.
    expect(screen.getByText("Its photos are removed and open offers close. Nothing is charged. You can relist it from History, but you'll need new photos.")).toBeTruthy();
    expect(screen.queryByText(/can't be undone/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete listing" }));
    await waitFor(() => expect(calls).toContainEqual(["withdraw", "i1"]));
  });

  // A2-5 (audit 2 SE2-1): "Mark sold elsewhere" and "Delete" both called declutter_withdraw_item, so a sale was
  // recorded as a deletion. Mark sold now calls declutter_mark_sold_elsewhere (kept as history); Delete stays a withdraw.
  // @mutate src/components/declutter/DeclutterManageListing.tsx | (view === "sold" ? markSoldElsewhere(item.id) : withdrawItem(item.id)) | withdrawItem(item.id)
  it("Mark sold elsewhere records a sale elsewhere, never a withdraw (A2-5)", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Mark sold elsewhere"));
    expect(screen.getByText(/keep it in your selling history/)).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Mark sold" }));
    await waitFor(() => expect(calls).toEqual([["sold_elsewhere", "i1"]]));
  });

  it("a lowest price above the price is refused before any call", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Change price or lowest price"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("Lowest you'll take"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(calls).toContainEqual(["price", "i1", 2500, 2000]));
  });

  // NIGHT-SELL-Sellinglist-6: under the lowest was only said on Save, and the seller had to find the other box.
  // @mutate src/components/declutter/DeclutterManageListing.tsx |       {(touched \|\| underFloor) && problem && ( |       {touched && problem && (
  // @mutate src/components/declutter/DeclutterManageListing.tsx | onClick={() => setFloor(price)}> | onClick={() => setFloor(floor)}>
  // @mutate src/components/declutter/DeclutterManageListing.tsx |         ? `${formatPrice(priceCents)} is under your lowest price, ${formatPrice(floorC)}.` |         ? "Your lowest price must be at least $1 and no more than your price."
  it("a price typed under the lowest is said at once, with a one-tap Also set lowest", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Change price or lowest price"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "20" } });
    expect(screen.getByRole("alert").textContent).toBe("$20 is under your lowest price, $30.");
    fireEvent.click(screen.getByRole("button", { name: "Also set lowest to $20" }));
    expect((screen.getByLabelText("Lowest you'll take") as HTMLInputElement).value).toBe("20");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Also set lowest/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(calls).toContainEqual(["price", "i1", 2000, 2000]));
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("Never above the listed price (authz/money review, 2026-10-20)", () => {
  it("a price above the one it was listed at is refused before any call (no fake 'was' price)", async () => {
    sheet();
    fireEvent.click(await screen.findByText("Change price or lowest price"));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/raise it back up to \$40/);
    expect(calls).toEqual([]);
  });
});

describe("Paused card (board 158)", () => {
  it("Relist puts it back; Relist at a new price saves the price THEN relists", async () => {
    wrap(<SellerListingPanel item={item({ status: "paused" }) as never} coverUrl={null} />);
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Relist" }));
    await waitFor(() => expect(calls).toContainEqual(["relist", "i1"]));
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Relist at a new price" }));
    const price = await screen.findByLabelText("Price");
    await waitFor(() => expect((screen.getByLabelText("Lowest you'll take") as HTMLInputElement).value).toBe("30"));
    fireEvent.change(price, { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Relist at this price" }));
    await waitFor(() => expect(calls).toEqual([["price", "i1", 3500, 3000], ["relist", "i1"]]));
  });

  // B106 (item page shots 11-01): a giver's free item said "Change the price, stop the drops" (it has neither).
  it("a free item's card names only what a free item can do", () => {
    wrap(<SellerListingPanel item={item({ price_cents: 0, current_price_cents: 0 }) as never} coverUrl={null} />);
    expect(screen.getByText("Your free item is up")).toBeTruthy();
    expect(document.querySelector("[data-seller-panel-line]")?.textContent).toBe("Pause it or take it down.");
    expect(document.body.textContent).not.toMatch(/price|drops|for sale/i);
    expect(document.body.textContent).toMatch(/The link shows its photo and town, and that it's free\./);
  });

  it("a live listing gets one Manage listing button", () => {
    wrap(<SellerListingPanel item={item() as never} coverUrl={null} />);
    expect(screen.getByRole("button", { name: "Manage listing" })).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
  });
});
