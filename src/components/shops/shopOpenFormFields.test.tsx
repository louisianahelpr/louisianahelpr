/**
 * Shops audit 11-10 (~/.lh-shots/shops-audit-1110/FINDINGS.md), the open-a-shop form:
 *  F2  a problem shows in red under its own field (role=alert, aria-invalid), the page goes to the first one, stale
 *      toasts are cleared, and nothing is saved; a server refusal lands under its field too, never as a toast.
 *  F6  a new shop starts open Monday to Friday 9 to 5, and its parish is picked from the town typed (the full list is
 *      behind "Add other parishes"); the optional business number waits behind "Have a Louisiana business number?".
 *  F7  the common categories are one tap; "More" opens the full list.
 *  F8  the town placeholder reads "e.g. Broussard".
 *
 * @mutate src/components/shops/ShopEditView.tsx |     if (first) {\n      focusField(first);\n      return;\n    } |     if (first) {\n      focusField(first);\n    }
 * @mutate src/components/shops/ShopEditView.tsx |     toast.dismiss(); // F2: no stale toast from an earlier try stays on screen |     // toast.dismiss() removed
 * @mutate src/components/shops/ShopEditView.tsx |       if (field) {\n        setErrors({ [field]: msg }); |       if (false) {\n        setErrors({ [field]: msg });
 * @mutate src/components/shops/shopEditForm.tsx |   Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: i >= 1 && i <= 5, opens: "09:00", closes: "17:00" }])); |   Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: false, opens: "09:00", closes: "17:00" }]));
 * @mutate src/components/shops/ShopEditView.tsx |     const fromTown = parishForCity(form.areaLabel)?.name ?? null; |     const fromTown = null;
 * @mutate src/components/shops/ShopEditView.tsx |   const [showSos, setShowSos] = useState(false); |   const [showSos, setShowSos] = useState(true);
 * @mutate src/components/shops/ShopCategoryQuickPick.tsx | onClick={() => { setMore(false); onChange(c.slug); }} | onClick={() => { setMore(false); }}
 * @mutate src/components/shops/ShopEditView.tsx | placeholder="e.g. Broussard" | placeholder="Broussard"
 *  S023 (Shops audit 11-12) at 375 each open day's "to" time wrapped under the checkbox and the clock icons were
 *      clipped by fixed w-32 fields. The day sits on its own line; its two times share ONE row and its width.
 * @mutate src/components/shops/ShopEditView.tsx |                   className="min-w-0 flex-1 sm:w-36 sm:flex-none"\n                  value={h.closes} |                   className="w-32 min-w-0"\n                  value={h.closes}
 * @mutate src/components/shops/ShopEditView.tsx |           <div key={day} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2" data-testid="shop-hours-day"> |           <div key={day} className="flex flex-wrap items-center gap-2" data-testid="shop-hours-day">
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
const account = { user: { id: "u1" }, profile: { parish: null }, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => ({ latitude: 30.15, longitude: -91.96 }) }));
const api = vi.hoisted(() => ({ saveMyShop: vi.fn(async () => "s1"), setShopHours: vi.fn(async () => undefined) }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/api")>()),
  ...api,
  fetchMyShopId: async () => null,
  fetchShopCategories: async () => [
    { slug: "bakery", label: "Bakery and cakes", group_slug: "food_to_order", group_label: "Food to order" },
    { slug: "crafts_gifts", label: "Crafts and gifts", group_slug: "made_locally", group_label: "Made locally" },
    { slug: "cleaning", label: "Cleaning", group_slug: "home_services", group_label: "Home services" },
    { slug: "tattoo", label: "Tattoo", group_slug: "beauty", group_label: "Beauty" },
  ],
}));

import ShopEditPage from "@/pages/shops/ShopEditPage";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops/mine"]}>
        <Routes>
          <Route path="/shops/mine" element={<ShopEditPage />} />
          <Route path="/shops/:id" element={<p>Shop page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("open-a-shop form (audit 11-10 F2, F6, F7, F8)", () => {
  it("F2: an empty submit marks each field under itself, goes to the first, clears toasts, saves nothing", async () => {
    renderForm();
    const button = await screen.findByRole("button", { name: "Open my shop" });
    const name = screen.getByLabelText("Shop or business name");
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(toast.dismiss).toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.length).toBeGreaterThanOrEqual(3); // name, category, town
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby") as string)?.textContent).toMatch(/name/i);
    expect(screen.getByLabelText("Town or neighborhood").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    await new Promise((r) => setTimeout(r, 30)); // the save is async (it geocodes first): give it time to be wrong
    expect(api.saveMyShop).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Typing in the field clears its own message.
    fireEvent.change(name, { target: { value: "Bayou Bakes" } });
    expect(name.getAttribute("aria-invalid")).toBeNull();
  });

  it("F2: a server refusal lands under its field, never in a toast", async () => {
    api.saveMyShop.mockRejectedValueOnce(Object.assign(new Error("area_looks_like_address"), { code: "22023" }));
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    fireEvent.change(screen.getByLabelText("Shop or business name"), { target: { value: "Bayou Bakes" } });
    fireEvent.click(screen.getByRole("radio", { name: "Bakery and cakes" }));
    fireEvent.change(screen.getByLabelText("Town or neighborhood"), { target: { value: "123 Main St" } });
    fireEvent.submit(screen.getByRole("button", { name: "Open my shop" }).closest("form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByLabelText("Town or neighborhood").getAttribute("aria-invalid")).toBe("true"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("F6: Monday to Friday 9 to 5 is set, and the parish follows the town", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      expect(screen.getByRole("checkbox", { name: day }).getAttribute("aria-checked") ?? screen.getByRole("checkbox", { name: day }).getAttribute("data-state")).toMatch(/true|checked/);
      expect((screen.getByLabelText(`${day} opens`) as HTMLInputElement).value).toBe("09:00");
    }
    expect(screen.getByRole("checkbox", { name: "Sunday" }).getAttribute("data-state")).toBe("unchecked");
    expect(screen.queryByRole("checkbox", { name: "Lafayette" })).toBeNull(); // the long list waits behind the button
    fireEvent.change(screen.getByLabelText("Town or neighborhood"), { target: { value: "Broussard" } });
    expect(await screen.findByRole("button", { name: "Remove Lafayette" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add other parishes" }));
    expect(screen.getByRole("checkbox", { name: "Lafayette" }).getAttribute("data-state")).toBe("checked");
  });

  it("F6: the optional business number waits behind one tap", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    expect(screen.queryByLabelText(/Secretary of State number/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Have a Louisiana business number?" }));
    expect(screen.getByLabelText(/Secretary of State number/)).toBeTruthy();
  });

  it("F7: common categories are one tap; More opens the full list", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    const bakery = screen.getByRole("radio", { name: "Bakery and cakes" });
    fireEvent.click(bakery);
    expect(bakery.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Tattoo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: /Choose another category/ })).toBeTruthy();
  });

  it("F8: the town placeholder says it is an example", async () => {
    renderForm();
    await screen.findByRole("button", { name: "Open my shop" });
    expect(screen.getByLabelText("Town or neighborhood").getAttribute("placeholder")).toBe("e.g. Broussard");
  });
  it("S023: each open day is its name, then one row of two times that share the width (no fixed-width fields)", async () => {
    renderForm();
    const days = await screen.findAllByTestId("shop-hours-day");
    expect(days).toHaveLength(7);
    const open = days.filter((d) => d.querySelector('[data-testid="shop-hours-times"]'));
    expect(open).toHaveLength(5);
    for (const d of open) {
      // Phone: stacked (name line, then the times row), never one wrapping row.
      expect(d.className.split(/\s+/)).toContain("flex-col");
      expect(d.className.split(/\s+/)).not.toContain("flex-wrap");
      const times = d.querySelector('[data-testid="shop-hours-times"]') as HTMLElement;
      const inputs = [...times.querySelectorAll('input[type="time"]')] as HTMLElement[];
      expect(inputs).toHaveLength(2);
      expect(times.textContent).toContain("to");
      expect(times.querySelector('[role="checkbox"]')).toBeNull();
      for (const el of inputs) {
        const cls = el.className.split(/\s+/);
        expect(cls).toContain("flex-1");
        expect(cls).not.toContain("w-32");
      }
    }
  });
  // S2-042 (Shops audit 2): one tap copies the first open day's hours to the other open days (closed days stay closed).
  it("S2-042: Copy Monday's hours to all open days", async () => {
    renderForm();
    const copy = (await screen.findByRole("button", { name: "Copy Monday's hours to all open days" })) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Monday opens"), { target: { value: "07:00" } });
    fireEvent.change(screen.getByLabelText("Monday closes"), { target: { value: "15:30" } });
    expect(copy.disabled).toBe(false);
    fireEvent.click(copy);
    for (const d of ["Tuesday", "Wednesday", "Thursday", "Friday"]) {
      expect((screen.getByLabelText(`${d} opens`) as HTMLInputElement).value).toBe("07:00");
      expect((screen.getByLabelText(`${d} closes`) as HTMLInputElement).value).toBe("15:30");
    }
    expect(screen.queryByLabelText("Saturday opens")).toBeNull();
    expect(copy.disabled).toBe(true);
  });
});
