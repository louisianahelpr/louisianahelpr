/**
 * The admin side of HELD FOR REVIEW (20261019070737): a payout or refund that will not pay itself
 * is listed with its payee, payout account, amount, Stripe group and the ids the payee's OTHER
 * rows already used; only an admin moves it on, synchronously: "Release to automatic" (ALWAYS with
 * the no-transfer-outside-the-app confirmation) or "Mark settled by hand" (Stripe id or
 * "other: ...", amount, note; terminal).
 *
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |          { p_kind: draft.row.kind, p_id: draft.row.id, p_ref: draft.ref, p_amount_cents: toCents(draft.amount) ?? 0, p_note: draft.note }); |          { p_kind: draft.row.kind, p_id: draft.row.id, p_ref: draft.ref, p_amount_cents: draft.row.amount_cents, p_note: draft.note });
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |    ? d.confirmed | ? true
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |            {(r.sibling_refs ?? []).length > 0 && ( |            {false && (
 * @mutate src/components/admin/AdminPayoutBatches.tsx |      <HeldForReview />\n |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { HeldForReview, type HeldRow } from "./HeldForReview";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ROW: HeldRow = { kind: "declutter", id: "0000000b-0000-4000-8000-0000000000cc", payee_id: "u1", payee_account: "acct_payee1",
  amount_cents: 3850, reason: "rejected: transfers inactive, rejected.fraud", held_at: "2026-10-19T07:00:00Z",
  stripe_group: "declutter_order_x", sibling_refs: [{ kind: "declutter", id: "p2", ref: "tr_sibling1", amount_cents: 2000 }] };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HeldForReview /></QueryClientProvider>);
}

beforeEach(() => {
  rpcMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review" ? { data: [ROW], error: null } : { data: { result: "ok" }, error: null }));
});

describe("Held for review (admin money page)", () => {
  it("lists each held row with its payee, payout account, amount, Stripe group, why, and the payee's already-used ids", async () => {
    mount();
    expect(await screen.findByText(/Declutter seller payout/)).toBeTruthy();
    expect(screen.getByText(/rejected\.fraud/)).toBeTruthy();
    expect(screen.getByText(/payout account acct_payee1/)).toBeTruthy();
    expect(screen.getByText("declutter_order_x")).toBeTruthy();
    expect(screen.getByTestId("held-siblings").textContent).toMatch(/tr_sibling1/);
    expect(screen.getAllByTestId("held-row")).toHaveLength(1);
  });

  it("Release ALWAYS needs the 'no transfer outside the app' confirmation and sends it", async () => {
    mount();
    fireEvent.click(await screen.findByText("Release to automatic"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "payee fixed their account" } });
    const go = screen.getByText("Release").closest("button") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/no transfer or refund for this row was made outside the app/));
    fireEvent.click(go);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_payout_release",
      { p_kind: "declutter", p_id: ROW.id, p_note: "payee fixed their account", p_confirm_no_transfer: true }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("Mark settled by hand sends the id, the amount in cents and the note, at once (no pending state)", async () => {
    mount();
    fireEvent.click(await screen.findByText("Mark settled by hand"));
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "other: paid by check #1042" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30.5" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "payee deleted their account; mailed a check" } });
    const go = screen.getByText("Mark settled").closest("button") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(go);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_payout_settle_by_hand",
      { p_kind: "declutter", p_id: ROW.id, p_ref: "other: paid by check #1042", p_amount_cents: 3050, p_note: "payee deleted their account; mailed a check" }));
    expect(toast.success).toHaveBeenCalledWith("Marked settled by hand.");
  });

  it("a refusal shows its words (never a raw code)", async () => {
    rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review"
      ? { data: [ROW], error: null } : { data: null, error: { message: "ref_already_used", code: "23505" } }));
    mount();
    fireEvent.click(await screen.findByText("Mark settled by hand"));
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "tr_sibling1" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(screen.getByText("Mark settled").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already recorded on another payout or refund/)));
  });

  it("is mounted on the admin money page (floor)", () => {
    expect(readFileSync("src/components/admin/AdminPayoutBatches.tsx", "utf8")).toMatch(/<HeldForReview \/>/);
  });
});
