/**
 * Area 07 (Shops) design audit 11-18, pass 2 (~/.lh-shots/design-audit-areas/07-shops/FINDINGS.md):
 *   M5: every dashboard setting is a radio card that saves on tap and says "Saved. New orders use it." under itself;
 *       no "Pickup only / I deliver" or "Don't offer / Offer it" pill pair; "Save delivery" shows only while typed
 *       values differ from the saved ones; a "Shop settings" link at the top jumps to the one settings section.
 *   M8: the dashboard has a Products section (rows, count, "Add an item" to the item screen, "Edit products").
 *   M4: one group-head style with the count ("Done · 7"); the dashboard's chip row fades at its edge.
 *   M13: from lg the dashboard is two columns (orders | products + settings).
 *   H1: the dashboard, its settings and Products speak Spanish.
 *
 * @mutate src/components/shops/ShopDeliveryPicker.tsx |     if (!on && offer.data?.delivers && !save.isPending) { |     if (false) {
 * @mutate src/components/shops/ShopDeliveryPicker.tsx |           {unsaved ? ( |           {true ? (
 * @mutate src/components/shops/ShopHandoverModePicker.tsx |       <ShopSettingSaved show={save.isSuccess} /> |
 * @mutate src/components/shops/ShopDashboardProducts.tsx |   const rows = (items.data ?? []).filter((i) => i.status !== "withdrawn"); |   const rows = items.data ?? [];
 * @mutate src/components/shops/ShopDashboardView.tsx |         <ShopDashboardProducts shopId={myId.data} /> |
 * @mutate src/components/shops/ShopDashboardView.tsx |             // Area 07 M4: a chip cut at a phone's edge reads as "more to scroll" (the Jobs/Declutter fade).\n            fade |
 * @mutate src/components/shops/ShopDashboardView.tsx | lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] | lg:block
 * @mutate src/components/shops/shopSettingsUi.tsx |       {count === undefined ? label : t("shb.dash.head", { label, n: count })} |       {label}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
const delivery = vi.hoisted(() => ({ fetchDeliveryOffer: vi.fn(), setDeliveryOffer: vi.fn(), setHelprDelivery: vi.fn() }));
const items = vi.hoisted(() => ({ fetchShopItems: vi.fn() }));
const handover = vi.hoisted(() => ({ fetchHandoverMode: vi.fn(async () => "in_person"), setHandoverMode: vi.fn(async () => undefined) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/shops/delivery", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/delivery")>()), ...delivery }));
vi.mock("@/lib/shops/items", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/items")>()), ...items }));
vi.mock("@/lib/shops/handover", async (orig) => ({ ...(await orig<typeof import("@/lib/shops/handover")>()), ...handover }));

import ShopDeliveryPicker from "./ShopDeliveryPicker";
import HandoverModePicker from "./ShopHandoverModePicker";
import ShopDashboardProducts from "./ShopDashboardProducts";
import { ShopSectionHead } from "./shopSettingsUi";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
const code = (f: string) => blankComments(readFileSync(resolve(__dirname, f), "utf8"));
const item = (id: string, status: string, title: string, price_cents = 1200) => ({ id, status, title, price_cents, subtype: "baked", kind: "made", photos: [] });

afterEach(() => {
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("M5: one radio-card look and one save for the shop settings", () => {
  it("delivery is two radio groups and Pickup only saves on tap with the stored price and miles", async () => {
    delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: true, fee_cents: 500, radius_miles: 12, helpr_delivery: false });
    delivery.setDeliveryOffer.mockResolvedValue(undefined);
    wrap(<ShopDeliveryPicker shopId="s1" />);
    const groups = await screen.findAllByRole("radiogroup");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Do you deliver?", "Helpr delivery"]);
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    // Nothing typed differs from what is saved: no Save button.
    expect(screen.queryByTestId("shop-delivery-save")).toBeNull();
    fireEvent.click(within(groups[0]).getByRole("radio", { name: /Pickup only/ }));
    await waitFor(() => expect(delivery.setDeliveryOffer).toHaveBeenCalledWith({ delivers: false, fee_cents: 500, radius_miles: 12 }));
    expect(await screen.findByText("Saved. New orders use it.")).toBeTruthy();
  });

  it("typed delivery values keep one Save button until they are saved", async () => {
    delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: true, fee_cents: 500, radius_miles: 12, helpr_delivery: false });
    wrap(<ShopDeliveryPicker shopId="s1" />);
    const price = await screen.findByLabelText("Delivery price ($)");
    fireEvent.change(price, { target: { value: "7" } });
    fireEvent.click(screen.getByTestId("shop-delivery-save"));
    await waitFor(() => expect(delivery.setDeliveryOffer).toHaveBeenCalledWith({ delivers: true, fee_cents: 700, radius_miles: 12 }));
  });

  it("the handover choice says Saved inline, not in a toast", async () => {
    wrap(<HandoverModePicker shopId="s1" />);
    const radios = await screen.findAllByRole("radio");
    const other = radios.find((r) => r.getAttribute("aria-checked") !== "true")!;
    fireEvent.click(other);
    expect(await screen.findByText("Saved. New orders use it.")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("no shop setting draws a pill pair, and the dashboard links to its one settings section from the top", () => {
    const files = ["ShopDeliveryPicker.tsx", "ShopHandoverModePicker.tsx", "ShopCustomOrdersPicker.tsx", "ShopCancelPolicyPicker.tsx"];
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      expect(code(f), f).not.toMatch(/aria-pressed/);
      expect(code(f), f).toMatch(/<ShopSettingSaved show=/);
      expect(code(f), f).not.toMatch(/toast\.success/);
    }
    const dash = code("ShopDashboardView.tsx");
    expect(dash.indexOf('data-testid="shop-settings-jump"')).toBeGreaterThan(-1);
    expect(dash.indexOf('data-testid="shop-settings-jump"')).toBeLessThan(dash.indexOf("<StatusBoxes"));
    expect(dash).toMatch(/document\.getElementById\("shop-settings"\)/);
    expect(dash).toMatch(/id="shop-settings"/);
    for (const picker of ["<HandoverModePicker", "<CancelPolicyPicker", "<CustomOrdersPicker", "{footer}"]) {
      expect(dash.indexOf(picker), picker).toBeGreaterThan(dash.indexOf('id="shop-settings"'));
    }
  });
});

describe("M8: Products on the dashboard", () => {
  it("lists the shop's items (taken-down ones left out) with a count, Add an item and Edit products", async () => {
    items.fetchShopItems.mockResolvedValue([item("a", "live", "Pralines"), item("b", "draft", "Fudge", 850), item("c", "withdrawn", "Old pie")]);
    wrap(<ShopDashboardProducts shopId="s1" />);
    expect(await screen.findByRole("heading", { name: "Products · 2" })).toBeTruthy();
    const rows = screen.getAllByText((_, el) => el?.hasAttribute("data-shop-product-row") ?? false);
    expect(rows.map((r) => r.textContent)).toEqual(["PralinesListed · $12", "FudgeDraft · $8.50"]);
    expect(screen.getByTestId("shop-dashboard-add-item").getAttribute("href")).toBe("/shops/mine#add-item");
    expect(screen.getByTestId("shop-dashboard-edit-products").getAttribute("href")).toBe("/shops/mine");
  });

  it("an empty shop is told what the first item needs, with Add an item", async () => {
    items.fetchShopItems.mockResolvedValue([]);
    wrap(<ShopDashboardProducts shopId="s1" />);
    expect(await screen.findByText(/No products yet/)).toBeTruthy();
    expect(screen.getByTestId("shop-dashboard-add-item")).toBeTruthy();
    expect(screen.queryByTestId("shop-dashboard-edit-products")).toBeNull();
  });

  it("the dashboard mounts it", () => {
    expect(code("ShopDashboardView.tsx")).toMatch(/<ShopDashboardProducts shopId=\{myId\.data\} \/>/);
  });
});

describe("M4 + M13: one head style, a fading chip row, two columns from lg", () => {
  it("a head reads 'Done · 7'", () => {
    render(<ShopSectionHead id="h" label="Done" count={7} />);
    expect(screen.getByRole("heading").textContent).toBe("Done · 7");
  });

  it("the dashboard's groups use the shared head, its chips fade, and lg splits it in two", () => {
    const dash = code("ShopDashboardView.tsx");
    expect((dash.match(/<ShopSectionHead /g) ?? []).length).toBeGreaterThan(3);
    expect(dash).not.toMatch(/<h2 /);
    expect(dash).toMatch(/onToggle=\{toggleStatus\}\s*fade\s*\/>/);
    expect(dash).toMatch(/lg:grid lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,24rem\)\]/);
    expect(code("ShopsHomeView.tsx")).not.toMatch(/uppercase[^\n]*shb\.settings/);
  });
});

describe("H1: the dashboard in Spanish", () => {
  it("Products and the delivery setting read the dictionary", async () => {
    setLang("es");
    await ensureLangLoaded();
    items.fetchShopItems.mockResolvedValue([item("a", "live", "Pralines")]);
    delivery.fetchDeliveryOffer.mockResolvedValue({ delivers: false, fee_cents: 0, radius_miles: 10, helpr_delivery: false });
    wrap(<><ShopDashboardProducts shopId="s1" /><ShopDeliveryPicker shopId="s1" /></>);
    expect(await screen.findByRole("heading", { name: "Productos · 1" })).toBeTruthy();
    expect(screen.getByText("Publicado · $12")).toBeTruthy();
    expect(await screen.findByRole("radio", { name: /Solo recogida/ })).toBeTruthy();
    expect(screen.queryByText("Pickup only")).toBeNull();
  });
});
