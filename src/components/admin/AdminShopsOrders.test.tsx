/**
 * Admin > Shops Orders (Shops M4, migration 20261019071055), rendered through
 * the admin page's own view switch entry:
 *
 *  1. The view is a real admin view (Admin.tsx case "shops", the rail's
 *     Revenue group) and renders shops_admin_queue's four sections, test rows
 *     tagged.
 *  2. Pay the shop -> shops_admin_pay_shop with the note (a note is required).
 *  3. Refund -> shop-checkout admin_refund with the chosen reason and the note
 *     (a reason and a note are required).
 *  4. Strikes: give (shops_admin_give_strike, side) and remove
 *     (shops_admin_remove_strike) with a note.
 *  5. Payout hold: the existing admin_set_payout_hold on the shop's owner;
 *     release through admin_release_payout_hold.
 *  6. Record a refund made in Stripe (/code-review of shops-m3-v1 #1, v2 rule B):
 *     shop-checkout admin_record_hand_refund with the order, the re_ id, the
 *     cents and a note (the edge checks it in Stripe); a held-for-review payout
 *     says why (#6).
 *  7. PGRST202 (#8): the queue says "not on the server yet" instead of an
 *     error or an empty queue; an action says so in its toast.
 *
 * @mutate src/components/admin/AdminShopsOrders.tsx |     mutationFn: () => adminRecordHandRefund(orderId.trim(), refundId.trim(), cents ?? 0, note.trim()), |     mutationFn: () => adminRecordHandRefund(orderId.trim(), refundId.trim(), 0, note.trim()),
 * @mutate src/components/admin/AdminShopsOrders.tsx |   if (error && isMissingRpcNamed(error, "shops_admin_queue")) return { problems: [], refunds: [], payouts: [], strikes: [], notDeployed: true }; |
 * @mutate src/components/admin/AdminShopsOrders.tsx |   throw Object.assign(new Error(error.message), error, { userMessage: (notDeployed ? NOT_DEPLOYED : userMessage) ?? undefined }); |   throw Object.assign(new Error(error.message), error, { userMessage: userMessage ?? undefined });
 * @mutate src/components/admin/AdminShopsOrders.tsx |   const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")); |   const cents = Number(m[1]) * 100 + Number(m[2] ?? "0");
 *
 * @mutate src/components/admin/AdminShopsOrders.tsx |     const { error } = await supabase.rpc("shops_admin_pay_shop", { p_order_id: a.orderId, p_note: note }); |     const { error } = await supabase.rpc("shops_admin_pay_shop", { p_order_id: a.orderId, p_note: "" });
 * @mutate src/components/admin/AdminShopsOrders.tsx |     await adminRefundOrder(a.orderId, reason, note); |     await adminRefundOrder(a.orderId, "problem_our_mistake", note);
 * @mutate src/components/admin/AdminShopsOrders.tsx |         primaryDisabled={act.isPending \|\| !note.trim() \|\| note.length > 500 \|\| (needsReason && !reason)} |         primaryDisabled={act.isPending}
 * @mutate src/components/admin/AdminShopsOrders.tsx |     const { error } = await supabase.rpc("shops_admin_give_strike", { p_order_id: a.orderId, p_side: a.side, p_note: note }); |     const { error } = await supabase.rpc("shops_admin_give_strike", { p_order_id: a.orderId, p_side: "shop", p_note: note });
 * @mutate src/components/admin/AdminShopsOrders.tsx |                 {s.is_seed && <TestTag />} | {null}
 * @mutate src/pages/admin/Admin.tsx |       case "shops": return <AdminShopsOrders />; |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn(async () => ({ data: { refunded: true }, error: null })));
const from = vi.hoisted(() => vi.fn(() => ({ select: async () => ({ data: [], error: null }) })));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke }, from } }));
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
import { adminNavGroups } from "./adminNavGroups";

const QUEUE = {
  problems: [{ order_id: "o1", seller_id: "s1", shop_name: "Bayou Bakes", ready_date: "2026-10-23", total_cents: 2370, card_fee_cents: 99,
    handover_mode: "in_person", problem_at: "2026-10-23T15:00:00Z", problem_note: "Nobody was there", ready_at: null, is_seed: true }],
  refunds: [{ refund_id: "r1", order_id: "o9", reason: "shop_cancelled", refund_cents: 2370, status: "failed", attempts: 2,
    last_error: "card_declined", created_at: "2026-10-23T15:00:00Z", is_seed: false }],
  payouts: [
    { payout_id: "p1", order_id: "o2", seller_id: "s2", shop_name: "Teche Crafts", amount_cents: 2000, status: "pending", attempts: 0,
      last_error: null, on_hold: false, hold_reason: null, is_seed: false },
    { payout_id: "p2", order_id: "o3", seller_id: "s3", shop_name: "Held Shop", amount_cents: 1500, status: "pending", attempts: 0,
      last_error: null, on_hold: true, hold_reason: "Fraud check", is_seed: false },
    { payout_id: "p3", order_id: "o4", seller_id: null, shop_name: "Review Shop", amount_cents: 900, status: "held_for_review", attempts: 0,
      last_error: null, review_reason: "refunded_by_hand: re_abc", on_hold: false, hold_reason: null, is_seed: false },
  ],
  strikes: [{ strike_id: "k1", user_id: "u9abcdef0", offender_side: "shop", reason: "shop_cancelled", order_id: "o9",
    given_at: "2026-10-20T00:00:00Z", expires_at: "2027-10-20T00:00:00Z", active_count: 1, is_seed: true }],
};

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminShopsOrders /></QueryClientProvider>);
}
const rpcCall = (name: string) => rpc.mock.calls.find((c) => c[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string, args?: { p_helper_id?: string }) => {
    if (name === "shops_admin_queue") return { data: QUEUE, error: null };
    if (name === "admin_set_payout_hold") return { data: { helper_id: args?.p_helper_id }, error: null };
    return { data: { result: "ok" }, error: null };
  });
});

describe("Admin > Shops Orders (M4)", () => {
  it("is a real admin view in the rail and the view switch", () => {
    const admin = readFileSync(join(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8");
    expect(admin).toMatch(/case "shops": return <AdminShopsOrders \/>;/);
    expect(adminNavGroups.find((g) => g.title === "Revenue")?.items.map((i) => i.id)).toContain("shops");
  });

  it("renders the four sections, test rows tagged", async () => {
    renderView();
    expect(await screen.findByText(/"Nobody was there"/)).toBeTruthy();
    expect(screen.getAllByTestId("admin-shops-problem")).toHaveLength(1);
    expect(screen.getAllByTestId("admin-shops-refund")[0].textContent).toMatch(/\$23\.70 · shop_cancelled · failed \(2 tries\)/);
    expect(screen.getAllByTestId("admin-shops-payout")).toHaveLength(3);
    expect(screen.getByText(/Held for review: refunded_by_hand: re_abc/)).toBeTruthy();
    expect(screen.getByText(/ON HOLD: Fraud check/)).toBeTruthy();
    expect(screen.getAllByTestId("admin-shops-strike")[0].textContent).toMatch(/shop u9abcdef · shop_cancelled · 1 of 3/);
    expect(screen.getAllByText("Test").length).toBeGreaterThanOrEqual(2);
  });

  it("Pay the shop needs a note and sends it", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Pay the shop" }));
    const dialog = screen.getByRole("dialog", { name: "Pay the shop?" });
    const confirm = within(dialog).getByRole("button", { name: "confirm Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "Photo shows it was picked up" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(rpcCall("shops_admin_pay_shop")).toBeTruthy());
    expect(rpcCall("shops_admin_pay_shop")![1]).toEqual({ p_order_id: "o1", p_note: "Photo shows it was picked up" });
  });

  it("Refund needs a reason and a note, then calls shop-checkout admin_refund", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Refund…" }));
    const dialog = screen.getByRole("dialog", { name: "Refund this order?" });
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "Shop admitted it" } });
    const confirm = within(dialog).getByRole("button", { name: "confirm Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // no reason yet
    fireEvent.click(within(dialog).getByLabelText(/The shop's fault/));
    fireEvent.click(confirm);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = (invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }])[1].body;
    expect(body).toMatchObject({ action: "admin_refund", order_id: "o1", reason: "problem_shop_fault", note: "Shop admitted it" });
  });

  it("gives a strike to the side chosen, and removes one with a note", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Strike the buyer" }));
    let dialog = screen.getByRole("dialog", { name: "Give a Shops strike?" });
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "Lied about pickup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Confirm" }));
    await waitFor(() => expect(rpcCall("shops_admin_give_strike")).toBeTruthy());
    expect(rpcCall("shops_admin_give_strike")![1]).toEqual({ p_order_id: "o1", p_side: "buyer", p_note: "Lied about pickup" });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    dialog = screen.getByRole("dialog", { name: "Remove this strike?" });
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "Appeal upheld" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Confirm" }));
    await waitFor(() => expect(rpcCall("shops_admin_remove_strike")).toBeTruthy());
    expect(rpcCall("shops_admin_remove_strike")![1]).toEqual({ p_strike_id: "k1", p_note: "Appeal upheld" });
  });

  it("holds a shop's payouts through the existing hold RPC, and releases one", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Hold payouts" }));
    const dialog = screen.getByRole("dialog", { name: "Hold this shop's payouts?" });
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "Chargeback risk" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Confirm" }));
    await waitFor(() => expect(rpcCall("admin_set_payout_hold")).toBeTruthy());
    expect(rpcCall("admin_set_payout_hold")![1]).toEqual({ p_helper_id: "s2", p_reason: "Chargeback risk" });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));
    await waitFor(() => expect(rpcCall("admin_release_payout_hold")).toBeTruthy());
    expect(rpcCall("admin_release_payout_hold")![1]).toEqual({ p_helper_id: "s3" });
  });

  it("records a refund made in Stripe through shop-checkout: order, re_ id, cents and note", async () => {
    invoke.mockResolvedValue({ data: { recorded: true, result: "closed_refunded" }, error: null } as never);
    renderView();
    const form = await screen.findByTestId("admin-shops-hand-refund");
    const save = within(form).getByRole("button", { name: "Record the refund" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Order id"), { target: { value: "0000000c-0000-4000-8000-0000000000aa" } });
    fireEvent.change(within(form).getByLabelText("Stripe refund id (re_…)"), { target: { value: "re_3Abc" } });
    fireEvent.change(within(form).getByLabelText("Amount refunded ($)"), { target: { value: "20.5" } });
    expect(save.disabled).toBe(true); // a note is required
    fireEvent.change(within(form).getByLabelText("Note (required)"), { target: { value: "Refunded in the Dashboard by phone" } });
    fireEvent.click(save);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect((invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }])[1].body).toEqual({
      action: "admin_record_hand_refund", order_id: "0000000c-0000-4000-8000-0000000000aa", refund_id: "re_3Abc", amount_cents: 2050,
      note: "Refunded in the Dashboard by phone", native: false,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/shop is not paid/)));
    expect(rpcCall("shops_admin_record_hand_refund")).toBeUndefined();
  });

  it("the queue not on the server yet (PGRST202) says so, never an error or an empty queue", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.shops_admin_queue" } }));
    renderView();
    expect(await screen.findByTestId("admin-shops-not-deployed")).toBeTruthy();
    expect(screen.queryByText(/We couldn't load the Shops queue/)).toBeNull();
  });

  it("an action not on the server yet (PGRST202) says so in its toast", async () => {
    rpc.mockImplementation(async (name: string) => (name === "shops_admin_queue"
      ? { data: QUEUE, error: null }
      : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Pay the shop" }));
    const dialog = screen.getByRole("dialog", { name: "Pay the shop?" });
    fireEvent.change(within(dialog).getByLabelText("Note (required)"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "confirm Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/isn't on the server yet/)));
  });
});
