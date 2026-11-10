/**
 * Admin > Shops: the paperwork card (docs/NOT-LAUNCHED.md Q1952, migration 20261110195956), rendered inside the
 * Shops view (AdminShopsOrders):
 *
 *  1. It lists the permits and Secretary of State numbers shops_admin_paperwork returns, the number shown; test rows
 *     never show (owner 2026-10-27).
 *  2. Approve -> shops_admin_review_permit(approve true); Turn down needs a reason and sends it.
 *  3. Registered / Not found -> shops_admin_check_registration with the shop and the answer.
 *  4. View document opens a signed user-documents link for the permit's own path.
 *  5. PGRST202: "not on the server yet", never an empty list.
 *
 * @mutate src/components/admin/ShopsPaperworkCard.tsx |     return { permits: withoutTestRows(p.permits), registrations: withoutTestRows(p.registrations) }; |     return { permits: p.permits, registrations: p.registrations };
 * @mutate src/components/admin/ShopsPaperworkCard.tsx |         primaryDisabled={decide.isPending \|\| note.trim().length < 3 \|\| note.length > 500} |         primaryDisabled={decide.isPending}
 * @mutate src/components/admin/ShopsPaperworkCard.tsx |                         onClick={() => registration.mutate({ shopId: r.shop_id, found: false })}>Not found</Button> |                         onClick={() => registration.mutate({ shopId: r.shop_id, found: true })}>Not found</Button>
 * @mutate src/components/admin/AdminShopsOrders.tsx |       <ShopsPaperworkCard />\n |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.hoisted(() => vi.fn());
const createSignedUrl = vi.hoisted(() => vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null })));
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrl })));
const from = vi.hoisted(() => vi.fn(() => ({ select: async () => ({ data: [], error: null }) })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from, functions: { invoke: vi.fn() }, storage: { from: storageFrom } } }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "admin1" }, profile: {}, isLoading: false }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/ui/BrandConfirmDialog", () => ({
  BrandConfirmDialog: ({ open, title, primaryLabel, primaryDisabled, onPrimary, children }: {
    open: boolean; title: string; primaryLabel: string; primaryDisabled?: boolean;
    onPrimary: (e: { preventDefault: () => void }) => void; children?: ReactNode;
  }) => (open ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" disabled={primaryDisabled} onClick={() => onPrimary({ preventDefault: () => undefined })}>{`confirm ${primaryLabel}`}</button>
    </div>
  ) : null),
}));

import AdminShopsOrders from "./AdminShopsOrders";

const PAPERWORK = {
  permits: [
    { permit_id: "pm1", shop_id: "s1", shop_name: "Bayou Bakes", owner_id: "u1", kind: "food_permit",
      document_path: "u1/shop-permits/food_permit-1762800000000.pdf", expires_on: "2027-05-29", sent_at: "2026-11-10T15:00:00Z", is_seed: false },
    { permit_id: "pm-seed", shop_id: "s9", shop_name: "Seed Bounce", owner_id: "u9", kind: "inflatable_registration",
      document_path: "u9/shop-permits/inflatable_registration-1762800000001.jpg", expires_on: "2027-01-01", sent_at: "2026-11-10T15:00:00Z", is_seed: true },
  ],
  registrations: [
    { shop_id: "s2", shop_name: "Teche Crafts", owner_id: "u2", sos_number: "LA-123456", area_label: "Breaux Bridge", updated_at: "2026-11-09T00:00:00Z", is_seed: false },
    { shop_id: "s8", shop_name: "Seed Crafts", owner_id: "u8", sos_number: "LA-999", area_label: "Test", updated_at: "2026-11-09T00:00:00Z", is_seed: true },
  ],
};

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminShopsOrders /></QueryClientProvider>);
}
const rpcCall = (name: string) => rpc.mock.calls.find((c) => c[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => {
    if (name === "shops_admin_queue") return { data: { problems: [], refunds: [], payouts: [], strikes: [] }, error: null };
    if (name === "shops_admin_paperwork") return { data: PAPERWORK, error: null };
    if (name === "shops_admin_review_permit") return { data: "verified", error: null };
    if (name === "shops_admin_check_registration") return { data: true, error: null };
    return { data: null, error: null };
  });
});

describe("Admin > Shops: paperwork (Q1952)", () => {
  it("lists permits and SoS numbers, never a test row", async () => {
    renderView();
    const permit = await screen.findByTestId("admin-shops-permit");
    expect(permit.textContent).toMatch(/Bayou Bakes · Food permit · expires May 29, 2027/);
    expect(screen.getAllByTestId("admin-shops-permit")).toHaveLength(1);
    const reg = screen.getAllByTestId("admin-shops-registration");
    expect(reg).toHaveLength(1);
    expect(reg[0].textContent).toMatch(/Teche Crafts · Breaux Bridge · number LA-123456/);
    expect(screen.queryByText(/Seed Bounce|Seed Crafts|LA-999/)).toBeNull();
  });

  it("Approve sends approve=true; Turn down needs a reason", async () => {
    renderView();
    const permit = await screen.findByTestId("admin-shops-permit");
    fireEvent.click(within(permit).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(rpcCall("shops_admin_review_permit")).toBeTruthy());
    expect(rpcCall("shops_admin_review_permit")![1]).toEqual({ p_permit_id: "pm1", p_approve: true, p_note: "" });

    rpc.mockClear();
    fireEvent.click(within(permit).getByRole("button", { name: "Turn down" }));
    const dialog = screen.getByRole("dialog", { name: "Turn down this permit?" });
    const confirm = within(dialog).getByRole("button", { name: "confirm Turn down" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason (the shop sees it)"), { target: { value: "The copy is blurry." } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(rpcCall("shops_admin_review_permit")).toBeTruthy());
    expect(rpcCall("shops_admin_review_permit")![1]).toEqual({ p_permit_id: "pm1", p_approve: false, p_note: "The copy is blurry." });
  });

  it("Registered / Not found send the answer for that shop", async () => {
    renderView();
    const reg = await screen.findByTestId("admin-shops-registration");
    fireEvent.click(within(reg).getByRole("button", { name: "Not found" }));
    await waitFor(() => expect(rpcCall("shops_admin_check_registration")).toBeTruthy());
    expect(rpcCall("shops_admin_check_registration")![1]).toEqual({ p_shop_id: "s2", p_verified: false });
    rpc.mockClear();
    fireEvent.click(within(reg).getByRole("button", { name: "Registered" }));
    await waitFor(() => expect(rpcCall("shops_admin_check_registration")).toBeTruthy());
    expect(rpcCall("shops_admin_check_registration")![1]).toEqual({ p_shop_id: "s2", p_verified: true });
  });

  it("View document opens a signed link to the permit's own path", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderView();
    const permit = await screen.findByTestId("admin-shops-permit");
    fireEvent.click(within(permit).getByRole("button", { name: "View document" }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(storageFrom).toHaveBeenCalledWith("user-documents");
    expect(open.mock.calls[0][0]).toBe("https://signed.example/u1/shop-permits/food_permit-1762800000000.pdf");
    open.mockRestore();
  });

  it("a paperwork RPC not deployed yet says so", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "shops_admin_queue") return { data: { problems: [], refunds: [], payouts: [], strikes: [] }, error: null };
      if (name === "shops_admin_paperwork") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.shops_admin_paperwork", hint: null } };
      return { data: null, error: null };
    });
    renderView();
    expect(await screen.findByText(/This isn't on the server yet/)).toBeTruthy();
    expect(screen.queryByText("No permits waiting.")).toBeNull();
  });
});
