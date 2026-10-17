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
 *     the list after a refusal such as item_changed.
 *  4. ShopItemEditor: an empty "days" box is refused, never saved as 0
 *     (should-fix 2); home food cannot publish while the yearly status is
 *     unknown (should-fix 5); the admin's note stays in view on a re-saved
 *     draft (nit 7); an AI suggestion of another kind clears the ticks (nit 9).
 *  5. ShopDailyCap: an emptied box removes a saved limit only as the named
 *     "Remove limit" action, sending NULL (should-fix 3).
 *
 * @mutate src/components/shops/ShopItemsSection.tsx |       ) : items.isError && !items.data ? ( |       ) : items.isError ? (
 * @mutate src/components/shops/ShopItemsSection.tsx |           <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}> |           <Button type="button" variant="outline" size="sm" onClick={() => undefined} disabled={items.isFetching}>
 * @mutate src/components/shops/ShopItemsSection.tsx |             <p className="text-sm">This item isn't available any more.</p> |             <p className="text-sm">Loading…</p>
 * @mutate src/components/shops/ShopItemsSection.tsx |         ) : items.isError ? (\n          // A reload that failed | ) : false ? (\n          // A reload that failed
 * @mutate src/components/shops/ShopItemsSection.tsx |           {items.isError ? (\n            // The list on screen | {false ? (\n            // The list on screen
 * @mutate src/components/shops/ShopItemsList.tsx |           <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}> |           <Button type="button" variant="outline" size="sm" onClick={() => undefined} disabled={items.isFetching}>
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |     mutationFn: (approve: boolean) => reviewShopItem(row.item_id, row.submitted_at, approve, approve ? null : note.trim()), |     mutationFn: (approve: boolean) => reviewShopItem(row.item_id, null, approve, approve ? null : note.trim()),
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |       // item_changed / item_not_pending: show the version waiting now.\n      void qc.invalidateQueries | void 0;\n      void qc.getQueryData
 * @mutate src/components/admin/settings/ShopItemsReviewCard.tsx |           <Button variant="outline" size="sm" onClick={() => void pending.refetch()} disabled={pending.isFetching}> |           <Button variant="outline" size="sm" onClick={() => undefined} disabled={pending.isFetching}>
 * @mutate src/components/shops/ShopItemEditor.tsx |   if (!/^\d+$/.test(t)) throw new Error(code); |   if (!/^\d*$/.test(t)) throw new Error(code);
 * @mutate src/components/shops/ShopItemEditor.tsx |   const cottageUnknown = d.kind === "home_food" && !cottage.data; |   const cottageUnknown = false;
 * @mutate src/components/shops/ShopItemEditor.tsx |     enabled: !!id && (status === "rejected" \|\| status === "draft"), |     enabled: !!id && status === "rejected",
 * @mutate src/components/shops/ShopItemEditor.tsx |       if (s.kind !== d.kind \|\| s.subtype !== d.subtype) setTicked([]); |       if (false) setTicked([]);
 * @mutate src/components/shops/ShopDailyCap.tsx |   const clearing = shown.trim() === "" && cap.data != null; |   const clearing = false;
 * @mutate src/components/shops/ShopDailyCap.tsx |       return setDailyOrderCap(shown.trim() === "" ? null : Number(shown)); |       return setDailyOrderCap(Number(shown));
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CottageStatus, PendingShopItem, ShopItem } from "@/lib/shops/items";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
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
}));
vi.mock("@/lib/shops/items", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/items")>()),
  ...api,
  itemPhotoUrl: (p: string) => `https://cdn/${p}`,
}));

import ShopItemsSection from "./ShopItemsSection";
import ShopItemsList from "./ShopItemsList";
import ShopItemEditor from "./ShopItemEditor";
import ShopDailyCap from "./ShopDailyCap";
import { ShopItemsReviewCard } from "../admin/settings/ShopItemsReviewCard";

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: "it1", kind: "made", subtype: "candles", status: "live", title: "Fig candle", description: "Soy wax.",
  price_cents: 1800, lead_time_days: 2, stock_count: null, home_kitchen: false, photos: [], ...over,
});
const cottage: CottageStatus = { year: 2026, cap_cents: 3000000, sales_cents: 0, warn: false, reached: false, confirmed: true } as CottageStatus;

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
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
});

describe("ShopItemsReviewCard (admin)", () => {
  const row: PendingShopItem = {
    item_id: "it1", shop_id: "s1", shop_name: "Bayou Bakes", owner_id: "u2", kind: "made", subtype: "candles",
    title: "Fig candle", description: "Soy wax.", price_cents: 1800, submitted_at: "2026-10-17 10:00:00.123456+00",
    ai_checked_at: null, ai_flag_reason: null, text_flag_reason: null, approved_items: 0, photo_paths: [],
  };

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
  it("an empty 'days' box is refused, never saved as 0 (same day)", async () => {
    renderWith(<ShopItemEditor ownerId="u1" item={item({ status: "draft" })} onCreated={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Days you need to make it"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Set how many days you need, from 0 (same day) to 60."));
    expect(api.updateShopItem).not.toHaveBeenCalled();
    expect(api.createShopItem).not.toHaveBeenCalled();
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
