/**
 * The Shops item screens: what the lh-silent-failure reviews asked the client
 * to do, pinned by rendering it (re-review of 603408318e).
 *
 *  1. ShopItemsSection: a failed first load says so with Try again; a failed
 *     BACKGROUND reload keeps an open editor mounted (it used to unmount it,
 *     losing the member's unsaved words); an item that left the list says so
 *     with a way back (should-fix 4).
 *  2. ShopItemsList and ShopItemsReviewCard: a failed load has Try again.
 *  3. ShopItemsReviewCard: the decision sends back the submitted_at the admin
 *     saw, as the server's own string (lh-authz-rls re-review N1), and reloads
 *     the list after a refusal such as item_changed; an item the 30-day hold
 *     sent shows the owner's last rejection and reason (lh-silent-failure
 *     review of 63a55df2c, finding 1).
 *  4. ShopItemEditor: an empty "days" box is refused, never saved as 0
 *     (should-fix 2); home food cannot publish while the yearly status is
 *     unknown (should-fix 5); the admin's note stays in view on a re-saved
 *     draft (nit 7); an AI suggestion of another kind clears the ticks (nit 9).
 *  5. ShopDailyCap: an emptied box removes a saved limit only as the named
 *     "Remove limit" action, sending NULL (should-fix 3).
 *
 * @mutate src/components/shops/ShopItemEditor.tsx | toast.success(next === "live" ? "Saved. It's still on your shop." : | toast.success(next === "nope" ? "Saved. It's still on your shop." :
 * @mutate src/components/shops/ShopItemsSection.tsx |       ) : items.isError && !items.data ? ( |       ) : items.isError ? (
 * @mutate src/components/shops/ShopItemsSection.tsx |           <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}> |           <Button type="button" variant="outline" size="sm" onClick={() => undefined} disabled={items.isFetching}>
 * @mutate src/components/shops/ShopItemsSection.tsx |             <p className="text-sm">This item isn't available any more.</p> |             <p className="text-sm">Loading…</p>
 * @mutate src/components/shops/ShopItemsSection.tsx |         ) : items.isError ? (\n          // A reload that failed | ) : false ? (\n          // A reload that failed
 * @mutate src/components/shops/ShopItemsSection.tsx |           {items.isError ? (\n            // The list on screen | {false ? (\n            // The list on screen
 * @mutate src/components/shops/ShopItemEditor.tsx |         {d.readyNow && !hasOptions && ( |         {d.readyNow && (
 * @mutate src/components/shops/ShopItemEditor.tsx |         {hasOptions ? ( |         {false ? (
 * @mutate src/components/shops/ShopItemsSection.tsx |             hasOptions={!!open && !!options.data?.has(open.id)} |             hasOptions={false}
 * @mutate src/components/shops/ShopItemsList.tsx |           <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}> |           <Button type="button" variant="outline" size="sm" onClick={() => undefined} disabled={items.isFetching}>
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |     mutationFn: (approve: boolean) => reviewShopItem(row.item_id, row.submitted_at, approve, approve ? null : note.trim()), |     mutationFn: (approve: boolean) => reviewShopItem(row.item_id, null, approve, approve ? null : note.trim()),
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |       // item_changed / item_not_pending: show the version waiting now.\n      void qc.invalidateQueries | void 0;\n      void qc.getQueryData
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |           <Button variant="outline" size="sm" onClick={() => void pending.refetch()} disabled={pending.isFetching}> |           <Button variant="outline" size="sm" onClick={() => undefined} disabled={pending.isFetching}>
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |   if (!row.owner_last_rejected_at) return null; |   return null;
 * @mutate src/components/shops/ShopItemEditor.tsx |   if (!/^\d+$/.test(t)) throw new Error(code); |   if (!/^\d*$/.test(t)) throw new Error(code);
 * @mutate src/components/shops/ShopItemEditor.tsx |   const cottageUnknown = d.kind === "home_food" && !cottage.data; |   const cottageUnknown = false;
 * @mutate src/components/shops/ShopItemEditor.tsx |   if (x.photos < 3) out.push( |   if (x.photos < 0) out.push(
 * @mutate src/components/shops/ShopItemEditor.tsx | After a rejection, new items are checked by an admin for 30 days. | New items may be checked.
 * @mutate src/components/shops/ShopItemEditor.tsx |   const price = x.price.replace(/[$,\s]/g, ""); |   const price = x.price.replace(/[$\s]/g, "");
 * @mutate src/components/shops/ShopItemEditor.tsx |       if (field) {\n        setFieldError({ field, msg: shopsErrorMessage(err) }); |       if (false) {\n        setFieldError({ field, msg: shopsErrorMessage(err) });
 * @mutate src/components/shops/ShopItemEditor.tsx |     enabled: !!id && (status === "rejected" \|\| status === "draft"), |     enabled: !!id && status === "rejected",
 * @mutate src/components/shops/ShopItemEditor.tsx |       if (s.kind !== d.kind \|\| s.subtype !== d.subtype) setTicked([]); |       if (false) setTicked([]);
 * @mutate src/components/shops/ShopDailyCap.tsx |   const clearing = shown.trim() === "" && cap.data != null; |   const clearing = false;
 * @mutate src/components/shops/ShopDailyCap.tsx |       return setDailyOrderCap(shown.trim() === "" ? null : Number(shown)); |       return setDailyOrderCap(Number(shown));
 * @mutate src/components/shops/ShopProfile.tsx |                 {item.home_kitchen && ( |                 {false && (
 * @mutate src/components/shops/ShopItemEditor.tsx |         {serviceTypeHint(d.kind, d.subtype) && ( |         {false && (
 * @mutate src/components/shops/ShopItemEditor.tsx |     mutationFn: (v: boolean) => setShopItemAtBuyer(id as string, v), |     mutationFn: (v: boolean) => setShopItemAtBuyer(id as string, !v),
 * @mutate src/components/shops/ShopItemEditor.tsx |       {id && item?.kind === "service" && item.subtype === "fabric_cleaning" && d.subtype === "fabric_cleaning" && ( |       {id && item?.kind === "service" && d.subtype === "fabric_cleaning" && (
 * @mutate src/components/shops/ShopProfile.tsx |       {anyHomeKitchen && ( |       {false && (
 * @mutate src/components/shops/ShopProfile.tsx |                     <span className="sr-only">{HOME_KITCHEN_NOTICE}</span>\n |
 */
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CottageStatus, PendingShopItem, ShopItem } from "@/lib/shops/items";
import { HOME_KITCHEN_CARD_LINE, HOME_KITCHEN_NOTICE } from "@/lib/shops/items";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../admin/AdminViewShell", () => ({
  AdminCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

const api = vi.hoisted(() => ({
  fetchShopItems: vi.fn(),
  fetchDailyOrderCap: vi.fn(),
  setDailyOrderCap: vi.fn(),
  fetchCottageStatus: vi.fn(),
  fetchMyItemReview: vi.fn(),
  fetchPendingShopItems: vi.fn(),
  reviewShopItem: vi.fn(),
  createShopItem: vi.fn(),
  updateShopItem: vi.fn(),
  withdrawShopItem: vi.fn(),
  requestShopItemAiDraft: vi.fn(),
  setShopItemAtBuyer: vi.fn(),
}));
vi.mock("@/lib/shops/items", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/items")>()),
  ...api,
  itemPhotoUrl: (p: string) => `https://cdn/${p}`,
}));

// Variants (20261106165310): which items have option lists. None unless a test says so.
const variantsApi = vi.hoisted(() => ({ fetchItemOptions: vi.fn() }));
vi.mock("@/lib/shops/variants", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/variants")>()), ...variantsApi }));

import ShopItemsSection from "./ShopItemsSection";
import ShopItemsList from "./ShopItemsList";
import ShopItemEditor, { publishBlockers } from "./ShopItemEditor";
import ShopDailyCap from "./ShopDailyCap";
import { ShopItemsReviewCard } from "../admin/settings/ShopItemsReviewCard";

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: "it1", kind: "made", subtype: "candles", status: "live", title: "Fig candle", description: "Soy wax.",
  price_cents: 1800, lead_time_days: 2, stock_count: null, home_kitchen: false, photos: [], ...over,
});
const cottage: CottageStatus = { year: 2026, cap_cents: 3000000, sales_cents: 0, warn: false, reached: false, confirmed: true } as CottageStatus;

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>) };
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  variantsApi.fetchItemOptions.mockReset();
  variantsApi.fetchItemOptions.mockResolvedValue(new Map());
  toast.success.mockReset();
  toast.error.mockReset();
  api.fetchDailyOrderCap.mockResolvedValue(null);
  api.fetchCottageStatus.mockResolvedValue(cottage);
  api.fetchMyItemReview.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("ShopItemsSection (/shops/mine items)", () => {
  it("a failed first load shows the error with Try again, which reloads", async () => {
    api.fetchShopItems.mockRejectedValueOnce(new Error("item_not_found")).mockResolvedValue([item()]);
    renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This item isn't available.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fig candle")).toBeTruthy();
    expect(api.fetchShopItems).toHaveBeenCalledTimes(2);
  });

  it("opening an item that has option lists hides How many are ready (stock is per option)", async () => {
    api.fetchShopItems.mockResolvedValue([item({ stock_count: 4 })]);
    variantsApi.fetchItemOptions.mockResolvedValue(new Map([["it1", { item_id: "it1", option_names: ["Size"], variants: [] }]]));
    renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByTestId("item-stock-per-option")).toBeTruthy();
    expect(screen.queryByLabelText("How many are ready")).toBeNull();
  });

  it("a failed background reload keeps the open editor and its unsaved words", async () => {
    api.fetchShopItems.mockResolvedValueOnce([item()]).mockRejectedValue(new Error("feature_disabled"));
    const { qc } = renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Fig candle, large" } });
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["shops", "items", "s1"] });
      // React Query tells the screen on its next tick: let it re-render.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(qc.getQueryState(["shops", "items", "s1"])?.status).toBe("error");
    expect(api.fetchShopItems).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Edit item" })).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Fig candle, large");
    expect(screen.queryByText("Shops isn't open for your account yet.")).toBeNull();
  });

  it("an open item that left the list says so, with a way back", async () => {
    api.fetchShopItems.mockResolvedValueOnce([item()]).mockResolvedValue([]);
    const { qc } = renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["shops", "items", "s1"] });
    });
    expect(await screen.findByText("This item isn't available any more.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to your items" }));
    expect(screen.getByRole("button", { name: "Add an item" })).toBeTruthy();
  });

  it("an open item missing from a list whose reload failed shows the load error, never 'isn't available'", async () => {
    // lh-silent-failure re-review finding 1: a saved item missing only because
    // the reload failed must not read as gone.
    api.fetchShopItems.mockResolvedValueOnce([item()]).mockResolvedValueOnce([]).mockRejectedValue(new Error("feature_disabled"));
    const { qc } = renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["shops", "items", "s1"] });
    });
    await screen.findByText("This item isn't available any more.");
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["shops", "items", "s1"] });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(qc.getQueryState(["shops", "items", "s1"])?.status).toBe("error");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Back to your items" })).toBeTruthy();
    expect(screen.queryByText("This item isn't available any more.")).toBeNull();
  });

  it("a failed reload under a loaded list says the list could not refresh, with Try again", async () => {
    // lh-silent-failure re-review finding 2.
    api.fetchShopItems.mockResolvedValueOnce([item()]).mockRejectedValueOnce(new Error("feature_disabled")).mockResolvedValue([item(), item({ id: "it2", title: "Pecan pie" })]);
    const { qc } = renderWith(<ShopItemsSection shopId="s1" ownerId="u1" />);
    await screen.findByText("Fig candle");
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["shops", "items", "s1"] });
      await new Promise((r) => setTimeout(r, 20));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't refresh your items.");
    expect(screen.getByText("Fig candle")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Pecan pie")).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh your items.")).toBeNull();
  });
});

describe("ShopItemsList (/shops/:id)", () => {
  it("a failed load shows Try again, which reloads", async () => {
    api.fetchShopItems.mockRejectedValueOnce(new Error("shop_not_found")).mockResolvedValue([item()]);
    renderWith(<ShopItemsList shopId="s1" />);
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fig candle")).toBeTruthy();
  });

  it("L7: every home-food card carries one compact notice line, and the full statement shows once above the grid", async () => {
    api.fetchShopItems.mockResolvedValue([
      item({ id: "a", title: "Pralines", kind: "home_food", subtype: "candy", home_kitchen: true }),
      item({ id: "b", title: "Fig jam", kind: "home_food", subtype: "jams_jellies", home_kitchen: true }),
      item({ id: "c", title: "Fig candle" }),
    ]);
    renderWith(<ShopItemsList shopId="s1" />);
    await screen.findByText("Pralines");
    const lines = screen.getAllByTestId("home-kitchen-notice");
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.textContent).toContain(HOME_KITCHEN_CARD_LINE);
      // Screen readers hear the whole statement on each card.
      expect(within(l).getByText(HOME_KITCHEN_NOTICE).className).toContain("sr-only");
      // One line: never a wrapped paragraph.
      expect(within(l).getByText(HOME_KITCHEN_CARD_LINE).className).toContain("truncate");
    }
    const statements = screen.getAllByTestId("home-kitchen-statement");
    expect(statements).toHaveLength(1);
    expect(statements[0].textContent).toContain("not licensed or inspected by the Louisiana Department of Health");
  });

  it("no home-food item, no statement", async () => {
    api.fetchShopItems.mockResolvedValue([item()]);
    renderWith(<ShopItemsList shopId="s1" />);
    await screen.findByText("Fig candle");
    expect(screen.queryByTestId("home-kitchen-statement")).toBeNull();
    expect(screen.queryByTestId("home-kitchen-notice")).toBeNull();
  });
});

describe("ShopItemsReviewCard (admin)", () => {
  const row: PendingShopItem = {
    item_id: "it1", shop_id: "s1", shop_name: "Bayou Bakes", owner_id: "u2", kind: "made", subtype: "candles",
    title: "Fig candle", description: "Soy wax.", price_cents: 1800, submitted_at: "2026-10-17 10:00:00.123456+00",
    ai_checked_at: null, ai_flag_reason: null, text_flag_reason: null, approved_items: 0, photo_paths: [],
    owner_last_rejected_at: null, owner_last_rejection_note: null,
  };

  it("an item held by the 30-day hold shows the owner's last rejection and its reason", async () => {
    api.fetchPendingShopItems.mockResolvedValue([
      { ...row, approved_items: 3, ai_checked_at: "2026-10-17 10:00:00+00",
        owner_last_rejected_at: "2026-10-17T12:00:00Z", owner_last_rejection_note: "Not a decoy we can list" },
    ]);
    renderWith(<ShopItemsReviewCard />);
    expect(await screen.findByText("This owner had an item rejected on Oct 17: Not a decoy we can list")).toBeTruthy();
  });

  it("no recent rejection, no rejection line", async () => {
    api.fetchPendingShopItems.mockResolvedValue([row]);
    renderWith(<ShopItemsReviewCard />);
    await screen.findByRole("button", { name: "Approve" });
    expect(screen.queryByText(/had an item rejected/)).toBeNull();
  });

  it("approving sends the submitted_at the admin saw, unchanged", async () => {
    api.fetchPendingShopItems.mockResolvedValue([row]);
    api.reviewShopItem.mockResolvedValue("live");
    renderWith(<ShopItemsReviewCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.reviewShopItem).toHaveBeenCalledTimes(1));
    expect(api.reviewShopItem).toHaveBeenCalledWith("it1", "2026-10-17 10:00:00.123456+00", true, null);
  });

  it("a refusal (item_changed) says so and reloads the list", async () => {
    api.fetchPendingShopItems.mockResolvedValue([row]);
    api.reviewShopItem.mockRejectedValue(new Error("item_changed"));
    renderWith(<ShopItemsReviewCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The owner changed this item after you opened it. Reload the list and review it again."));
    await waitFor(() => expect(api.fetchPendingShopItems).toHaveBeenCalledTimes(2));
  });

  it("a failed load shows Try again, which reloads", async () => {
    api.fetchPendingShopItems.mockRejectedValueOnce(new Error("not_admin")).mockResolvedValue([]);
    renderWith(<ShopItemsReviewCard />);
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing waiting.")).toBeTruthy();
  });
});

describe("ShopItemEditor", () => {
  // Lead 11-05 (after H8's money review): a repair listed under a general service type would go untaxed, so the
  // Type picker says where a repair belongs, under the general types only.
  // H8 (b): only a saved carpet or furniture cleaning item asks where the work is done, and saves the answer at once.
  it("a cleaning item asks where the work is done and saves it; other types never ask", async () => {
    api.setShopItemAtBuyer.mockResolvedValue(undefined);
    const { unmount } = renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live", kind: "service", subtype: "fabric_cleaning", at_buyer: false })} onCreated={() => {}} onDone={() => {}} />);
    const where = screen.getByLabelText("Where do you do this work?") as HTMLSelectElement;
    expect(where.value).toBe("shop");
    fireEvent.change(where, { target: { value: "buyer" } });
    await waitFor(() => expect(api.setShopItemAtBuyer).toHaveBeenCalledWith("it1", true));
    // Switching the unsaved type away hides it (the saved type decides once saved).
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "item_repair" } });
    expect(screen.queryByLabelText("Where do you do this work?")).toBeNull();
    unmount();
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live", kind: "service", subtype: "item_repair" })} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "fabric_cleaning" } });
    expect(screen.queryByLabelText("Where do you do this work?")).toBeNull();
  });

  it("a general service type shows the repair hint; a taxed type does not", () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft", kind: "service", subtype: "home_service" })} onCreated={() => {}} onDone={() => {}} />);
    expect(screen.getByText("Fixing an item someone brings you? Choose Repair of an item.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "item_repair" } });
    expect(screen.queryByText("Fixing an item someone brings you? Choose Repair of an item.")).toBeNull();
    fireEvent.change(screen.getByLabelText("What kind of item"), { target: { value: "made" } });
    expect(screen.queryByText("Fixing an item someone brings you? Choose Repair of an item.")).toBeNull();
  });

  // Shops audit 11-10 F11: what a draft still needs is listed beside Publish, and a refused title shows under its field.
  it("F11: a draft lists what stands between it and Publish, beside the button", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft", title: "", photos: [{ id: "p1", storage_path: "u1/a.jpg" }] as ShopItem["photos"] })} onCreated={() => {}} onDone={() => {}} />);
    const list = await screen.findByTestId("item-publish-blockers");
    expect(list.textContent).toContain("Add 2 more photos (3 to 12).");
    expect(list.textContent).toContain("Give it a title of 3 to 80 characters.");
    expect(list.textContent).toMatch(/Tick (the confirmation|the \d+ confirmations) above\./);
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Q1961 (owner 11-10 2:05 PM): the 30-day hold after a rejection is said beside Publish, in the owner's words.
  it("Q1961: the editor says new items are checked by an admin for 30 days after a rejection", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft" })} onCreated={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/After a rejection, new items are checked by an admin for 30 days\./)).toBeTruthy();
    expect(screen.getByText(/Edits to a live item keep it live, unless you change what kind of item it is or its type\./)).toBeTruthy();
  });

  it("F11: the price check reads a price the way the save does (\"$1,200\" is a price)", () => {
    const base = { photos: 3, title: "Pecan pie", unticked: 0, cottageNeedsTick: false, cottageUnknown: false };
    expect(publishBlockers({ ...base, price: "$1,200" })).toEqual([]);
    expect(publishBlockers({ ...base, price: "0" })).toEqual(["Enter a price."]);
    expect(publishBlockers({ ...base, price: "abc" })).toEqual(["Enter a price."]);
  });

  it("F11: a refused title shows in red under the title, not as a toast", async () => {
    api.updateShopItem.mockRejectedValueOnce(Object.assign(new Error("invalid_title"), { code: "22023" }));
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft" })} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const title = screen.getByLabelText("Title");
    await waitFor(() => expect(title.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById("item-title-error")?.getAttribute("role")).toBe("alert");
    expect(toast.error).not.toHaveBeenCalled();
  });

  // S041 (Shops audit 11-12): the refusal now shows under the days box (it was a toast only).
  // @mutate src/components/shops/ShopItemEditor.tsx |   invalid_title: "title", invalid_price: "price", invalid_lead_time: "lead", invalid_stock: "stock", |   invalid_title: "title", invalid_price: "price",
  it("an empty 'days' box is refused, never saved as 0 (same day), and says so under the box (S041)", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft" })} onCreated={() => {}} onDone={() => {}} />);
    const lead = screen.getByLabelText("Days you need to make it");
    fireEvent.change(lead, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(lead.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById("item-lead-error")?.textContent).toBe("Set how many days you need, from 0 (same day) to 60.");
    expect(document.getElementById("item-lead-error")?.getAttribute("role")).toBe("alert");
    expect(toast.error).not.toHaveBeenCalled();
    expect(api.updateShopItem).not.toHaveBeenCalled();
    expect(api.createShopItem).not.toHaveBeenCalled();
    // Typing in the box clears its line.
    fireEvent.change(lead, { target: { value: "2" } });
    expect(document.getElementById("item-lead-error")).toBeNull();
  });

  // @mutate src/components/shops/ShopItemEditor.tsx |       toast.success("Stock and ready time saved.");\n      refresh();\n    },\n    onError: errorUnderFieldOrToast, |       toast.success("Stock and ready time saved.");\n      refresh();\n    },\n    onError: (err) => toast.error(shopsErrorMessage(err)),
  it("S041: a refused stock count from 'Save stock and ready time' shows under the stock box, not as a toast", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live", stock_count: 3 })} onCreated={() => {}} onDone={() => {}} />);
    const stock = screen.getByLabelText("How many are ready");
    fireEvent.change(stock, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock and ready time" }));
    await waitFor(() => expect(stock.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById("item-stock-error")?.textContent).toMatch(/^Set how many you have ready, from 0 to 9,999/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // @mutate src/components/shops/ShopItemEditor.tsx |   if (x.photos > 12) out.push( |   if (false) out.push(
  // @mutate src/components/shops/ShopItemEditor.tsx |   if (x.digitalFiles === 0) out.push( |   if (false) out.push(
  it("S041: Publish says the server's price range, too many photos, and a download with no files, before it is pressed", () => {
    const base = { photos: 3, title: "Pecan pie", unticked: 0, cottageNeedsTick: false, cottageUnknown: false };
    expect(publishBlockers({ ...base, price: "0.50" })).toEqual(["Set a price from $1 to $5,000."]);
    expect(publishBlockers({ ...base, price: "5,000.01" })).toEqual(["Set a price from $1 to $5,000."]);
    expect(publishBlockers({ ...base, price: "1" })).toEqual([]);
    expect(publishBlockers({ ...base, price: "$5,000" })).toEqual([]);
    expect(publishBlockers({ ...base, price: "18", photos: 13 })).toEqual(["Remove 1 photo (3 to 12)."]);
    expect(publishBlockers({ ...base, price: "18", digitalFiles: 0 })).toEqual(["Add 1 to 5 files for buyers to download."]);
    expect(publishBlockers({ ...base, price: "18", digitalFiles: 2 })).toEqual([]);
    expect(publishBlockers({ ...base, price: "18", digitalFiles: null })).toEqual([]);
  });

  // Variants follow-up (11-06): an item with option lists keeps its stock per combination (the server's rollup
  // overrides the item's own stock), so the editor does not offer "How many are ready" for it.
  it("an item with options hides How many are ready and says stock is set per option", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live", stock_count: 4 })} hasOptions onCreated={() => {}} onDone={() => {}} />);
    expect(screen.getByTestId("item-stock-per-option").textContent).toBe("How many are ready is set for each option below.");
    expect(screen.queryByLabelText("How many are ready")).toBeNull();
    expect(screen.queryByLabelText("I have some ready now")).toBeNull();
    expect(screen.getByRole("button", { name: "Save ready time" })).toBeTruthy();
  });

  it("an item without options still offers How many are ready", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live", stock_count: 4 })} onCreated={() => {}} onDone={() => {}} />);
    expect(screen.getByLabelText("How many are ready")).toBeTruthy();
    expect(screen.queryByTestId("item-stock-per-option")).toBeNull();
  });

  // Shops H3 (owner 2026-11-05, answer 2): a live item's edit stays live, and
  // the screen says so instead of "Saved as a draft".
  it("saving a live item's edit says it's still on the shop", async () => {
    api.updateShopItem.mockResolvedValue("live");
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live" })} onCreated={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/Changes stay on your shop right away/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Price (dollars)"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved. It's still on your shop."));
    expect(api.updateShopItem).toHaveBeenCalledTimes(1);
  });

  it("a live edit our checks flag says it went for a review", async () => {
    api.updateShopItem.mockResolvedValue("pending_review");
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "live" })} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved. Our checks sent it for a quick review."));
  });

  it("home food cannot publish while this year's limit status is unknown", async () => {
    api.fetchCottageStatus.mockRejectedValue(new Error("feature_disabled"));
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft", kind: "home_food", subtype: "baked_goods", home_kitchen: true })} onCreated={() => {}} onDone={() => {}} />);
    expect(await screen.findByText("We couldn't load this year's home-kitchen limit.")).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox").filter((c) => c.id.startsWith("stmt-"))) fireEvent.click(box);
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the admin's note stays in view on a re-saved (draft) item", async () => {
    api.fetchMyItemReview.mockResolvedValue({ review_note: "Show the label in a photo.", attested: false, ai_checked: false, ai_flagged: false });
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft" })} onCreated={() => {}} onDone={() => {}} />);
    expect(await screen.findByText("Show the label in a photo.")).toBeTruthy();
  });

  it("an AI suggestion of another kind clears the ticked confirmations", async () => {
    api.requestShopItemAiDraft.mockResolvedValue({ kind: "farm", subtype: "produce", title: "Satsumas", description: "A bag.", flagged: false });
    renderWith(
      <ShopItemEditor
        ownerId="u1"
        item={item({ status: "draft", photos: [{ id: "p1", storage_path: "u1/shop-items/it1/a.jpg", position: 0 } as ShopItem["photos"][number]] })}
        onCreated={() => {}}
        onDone={() => {}}
      />,
    );
    const boxes = () => screen.getAllByRole("checkbox").filter((c) => c.id.startsWith("stmt-"));
    // 'not_banned' is asked of every kind, so a stale tick would carry over.
    const common = () => boxes().find((c) => c.id === "stmt-not_banned")!;
    fireEvent.click(common());
    expect(common().getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("button", { name: "Suggest details from my photos" }));
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Satsumas"));
    expect(common().getAttribute("data-state")).toBe("unchecked");
    expect(boxes().every((c) => c.getAttribute("data-state") === "unchecked")).toBe(true);
  });
});

describe("ShopDailyCap", () => {
  it("emptying a saved limit is the named 'Remove limit' action, which sends NULL", async () => {
    api.fetchDailyOrderCap.mockResolvedValue(12);
    api.setDailyOrderCap.mockResolvedValue(null);
    renderWith(<ShopDailyCap shopId="s1" />);
    const box = (await screen.findByDisplayValue("12")) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove limit" }));
    await waitFor(() => expect(api.setDailyOrderCap).toHaveBeenCalledWith(null));
    expect(toast.success).toHaveBeenCalledWith("The daily limit is removed.");
  });
});
