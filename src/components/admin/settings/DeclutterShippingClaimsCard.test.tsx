/**
 * Declutter shipping, the admin's hand steps (owner 11-03: the rest of a carrier claim is sent to the seller BY AN
 * ADMIN BY HAND, never automatically). Before this no screen called the claim RPCs, so a recorded claim's money
 * owed to the seller sat in shipping_claim_payouts with nothing showing it.
 *   - The list reads declutter_admin_ship_claims_due and says "Send $X to <seller> by hand", the seller's name from
 *     profiles; "Mark sent" needs the transfer id or check number and calls declutter_admin_mark_ship_claim_sent.
 *   - "Record a carrier claim" sends the order, claim number, amount in cents and note to
 *     declutter_admin_record_ship_claim, and says what the claim paid off and what is left to send.
 *   - "Request a return label" calls declutter_admin_request_return_label with the order and why.
 *   - A refusal reads in words (adminRpcErrorCopy), a list that can't load says so, and the card is absent while
 *     declutter_shipping is off for this admin.
 *
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx | Send {formatPrice(c.seller_due_cents)} to {due.data.names[c.seller_id] ?? ADMIN_DELETED_ACCOUNT_LABEL} by hand | Send {formatPrice(c.seller_due_cents)} by hand
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx | { p_claim_id: claimId, p_sent_ref: sent } | { p_claim_id: claimId, p_sent_ref: "" }
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx |     if (!sent) { |     if (false) {
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx | p_amount_cents: cents, | p_amount_cents: Number(amount),
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx |     const rest = due > 0 ? ` Send ${formatPrice(due)} to the seller by hand (listed above).` : " Nothing is left to send."; |     const rest = "";
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx | { p_order_id: id, p_note: note.trim() } | { p_order_id: id, p_note: "" }
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx |   if (!on) return null; |
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx |     rows = (unwrap(res) ?? []) as ClaimDue[]; |     rows = (res.data ?? []) as ClaimDue[];
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     <DeclutterShippingClaimsCard /> |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = {
  on: true,
  due: [] as unknown[],
  dueError: null as null | { code: string; message: string },
  answers: {} as Record<string, { data: unknown; error: unknown }>,
  rpc: [] as [string, unknown][],
};
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      state.rpc.push([fn, args]);
      if (fn === "declutter_admin_ship_claims_due") return { data: state.dueError ? null : state.due, error: state.dueError };
      return state.answers[fn] ?? { data: null, error: { message: `unexpected ${fn}` } };
    },
    from: () => ({ select: () => ({ in: async () => ({ data: [{ user_id: "s1", full_name: "Dana Seller" }], error: null }) }) }),
  },
}));
const toast = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => toast(...a), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { DeclutterShippingClaimsCard } from "./DeclutterShippingClaimsCard";

const ORDER = "aaaaaaaa-0000-4000-8000-0000000000aa";
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeclutterShippingClaimsCard />
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.on = true;
  state.due = [];
  state.dueError = null;
  state.answers = {};
  state.rpc = [];
  toast.mockReset();
  toastError.mockReset();
});

describe("DeclutterShippingClaimsCard", () => {
  it("lists a claim to send by hand with the seller's name and marks it sent with a reference", async () => {
    state.due = [{ claim_id: "c1", order_id: ORDER, seller_id: "s1", claim_ref: "CLM-77", seller_due_cents: 1850, created_at: "2026-11-03T12:00:00Z" }];
    state.answers.declutter_admin_mark_ship_claim_sent = { data: { result: "sent", claim_id: "c1", seller_due_cents: 1850 }, error: null };
    renderIt();
    expect(await screen.findByText("Send $18.50 to Dana Seller by hand")).toBeTruthy();
    expect(screen.getByText(/Claim CLM-77/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    expect(toastError).toHaveBeenCalledWith("Say how you sent it: the transfer id or check number.");
    expect(state.rpc.some(([fn]) => fn === "declutter_admin_mark_ship_claim_sent")).toBe(false);

    fireEvent.change(screen.getByLabelText("Transfer id or check number"), { target: { value: "  tr_123  " } });
    state.due = [];
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    await waitFor(() => expect(state.rpc).toContainEqual(["declutter_admin_mark_ship_claim_sent", { p_claim_id: "c1", p_sent_ref: "tr_123" }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Marked sent. The seller was told."));
    expect(await screen.findByText(/Nothing to send/)).toBeTruthy();
  });

  it("a refused Mark sent reads in words", async () => {
    state.due = [{ claim_id: "c1", order_id: ORDER, seller_id: "s1", claim_ref: "CLM-77", seller_due_cents: 1850, created_at: "2026-11-03T12:00:00Z" }];
    state.answers.declutter_admin_mark_ship_claim_sent = { data: null, error: { code: "55000", message: "claim_already_sent" } };
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Mark sent" }));
    fireEvent.change(screen.getByLabelText("Transfer id or check number"), { target: { value: "check 1044" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This claim was already marked sent with another reference."));
  });

  it("records a carrier claim in cents and says what is left to send by hand", async () => {
    state.answers.declutter_admin_record_ship_claim = { data: { result: "recorded", claim_id: "c2", debt_paid_cents: 640, seller_due_cents: 1860 }, error: null };
    renderIt();
    await screen.findByText(/Nothing to send/);
    fireEvent.change(screen.getByLabelText("Order id"), { target: { value: ORDER } });
    fireEvent.change(screen.getByLabelText("Claim number"), { target: { value: "CLM-88" } });
    fireEvent.change(screen.getByLabelText("Amount the claim paid"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    expect(toastError).toHaveBeenCalledWith("Say what the claim was for.");
    fireEvent.change(screen.getByLabelText("What the claim was for"), { target: { value: "Lamp broken in the mail" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    await waitFor(() => expect(state.rpc).toContainEqual(["declutter_admin_record_ship_claim",
      { p_order_id: ORDER, p_claim_ref: "CLM-88", p_amount_cents: 2500, p_note: "Lamp broken in the mail" }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      "Claim recorded. $6.40 paid what the seller owed on this order. Send $18.60 to the seller by hand (listed above)."));
  });

  it("refuses a bad order id before calling, and a server refusal reads in words", async () => {
    state.answers.declutter_admin_record_ship_claim = { data: null, error: { code: "55000", message: "order_not_refunded" } };
    renderIt();
    await screen.findByText(/Nothing to send/);
    fireEvent.change(screen.getByLabelText("Order id"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    expect(toastError).toHaveBeenCalledWith("Paste the order id (the long id from the order).");
    fireEvent.change(screen.getByLabelText("Order id"), { target: { value: ORDER } });
    fireEvent.change(screen.getByLabelText("Claim number"), { target: { value: "CLM-9" } });
    fireEvent.change(screen.getByLabelText("Amount the claim paid"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("What the claim was for"), { target: { value: "Lost" } });
    fireEvent.click(screen.getByRole("button", { name: "Record claim" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Record a claim after the order is refunded as lost or broken in the mail."));
  });

  it("requests a return label with the order and why", async () => {
    state.answers.declutter_admin_request_return_label = { data: { result: "requested", return_id: "r1", state: "requested" }, error: null };
    renderIt();
    await screen.findByText(/Nothing to send/);
    fireEvent.change(screen.getByLabelText("Order id for the return"), { target: { value: ORDER } });
    fireEvent.change(screen.getByLabelText("Why the item should come back"), { target: { value: "Not as described" } });
    fireEvent.click(screen.getByRole("button", { name: "Request a return label" }));
    await waitFor(() => expect(state.rpc).toContainEqual(["declutter_admin_request_return_label", { p_order_id: ORDER, p_note: "Not as described" }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Return label asked for. The buyer is told when it's ready to print."));
  });

  it("a return label refusal reads in words", async () => {
    state.answers.declutter_admin_request_return_label = { data: null, error: { code: "55000", message: "return_label_test_only" } };
    renderIt();
    await screen.findByText(/Nothing to send/);
    fireEvent.change(screen.getByLabelText("Order id for the return"), { target: { value: ORDER } });
    fireEvent.change(screen.getByLabelText("Why the item should come back"), { target: { value: "Broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Request a return label" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Return labels are test-only until shipping goes live. Arrange this return by hand."));
  });

  it("a list that cannot be read says so, never 'nothing to send'", async () => {
    state.dueError = { code: "42501", message: "admin_only" };
    renderIt();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Nothing to send/)).toBeNull();
  });

  it("is absent while declutter_shipping is off for this admin", () => {
    state.on = false;
    const { container } = renderIt();
    expect(container.textContent).toBe("");
    expect(state.rpc).toEqual([]);
  });

  it("the admin settings mount it with the Declutter cards", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "FeatureSwitchesCard.tsx"), "utf8"));
    expect(src).toMatch(/<MeetupSpotsCard \/>\s*<DeclutterShippingClaimsCard \/>\s*<DonationPartnersCard \/>/);
  });
});
