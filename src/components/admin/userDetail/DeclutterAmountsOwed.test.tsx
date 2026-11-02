/**
 * Q1928 gap 1: the admin sees what a member owes from Declutter refunds and clears one, with a reason, through
 * declutter_admin_waive_fee_debt (the server checks admin, writes the audit row and tells the member). A list that
 * cannot be read never reads as "owes nothing".
 *
 * @mutate src/components/admin/userDetail/DeclutterAmountsOwed.tsx | { p_debt_id: id, p_note: why } | { p_debt_id: id, p_note: "" }
 * @mutate src/components/admin/userDetail/DeclutterAmountsOwed.tsx | if (!why) { | if (false) {
 * @mutate src/components/admin/userDetail/DeclutterAmountsOwed.tsx | throw error; | return [];
 * @mutate src/components/admin/userDetail/DeclutterAmountsOwed.tsx | {!r.waived_at && r.remaining_cents > 0 && clearing !== r.id ? ( | {clearing !== r.id ? (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeclutterAmountsOwed, type OwedRow } from "./DeclutterAmountsOwed";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const USER = "aaaaaaaa-0000-4000-8000-0000000000aa";
const row = (over: Partial<OwedRow>): OwedRow => ({
  id: "d1", amount_cents: 163, remaining_cents: 163, created_at: "2026-11-01T12:00:00Z", reason: "seller_out",
  items: "Oak chair", fee_estimated: false, waived_at: null, waived_cents: null, waive_note: null, ...over,
});
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeclutterAmountsOwed userId={USER} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  rpcMock.mockReset();
  toastError.mockReset();
});

describe("DeclutterAmountsOwed", () => {
  it("lists what is owed and clears one with the admin's reason", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "declutter_admin_fee_debts"
        ? { data: [row({}), row({ id: "d2", remaining_cents: 0, waived_at: "2026-11-02T01:00:00Z", waived_cents: 90, waive_note: "Flag overturned" }), row({ id: "d3", remaining_cents: 0 })], error: null }
        : { data: { result: "waived", waived_cents: 163 }, error: null });
    renderIt();
    expect(await screen.findByText("$1.63 of $1.63")).toBeTruthy();
    expect(screen.getByText("Cleared $0.90")).toBeTruthy();
    expect(screen.getByText("Paid back")).toBeTruthy();
    expect(screen.getByText("Why: Flag overturned")).toBeTruthy();
    // Only the open amount offers a clear.
    expect(screen.getAllByRole("button", { name: "Clear what's left" })).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("declutter_admin_fee_debts", { p_user: USER });

    fireEvent.click(screen.getByRole("button", { name: "Clear what's left" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear \$1\.63/ }));
    expect(toastError).toHaveBeenCalledWith("Say why you're clearing it.");
    expect(rpcMock).not.toHaveBeenCalledWith("declutter_admin_waive_fee_debt", expect.anything());

    fireEvent.change(screen.getByLabelText("Why you're clearing it"), { target: { value: "Ban overturned on appeal" } });
    fireEvent.click(screen.getByRole("button", { name: /Clear \$1\.63/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("declutter_admin_waive_fee_debt", { p_debt_id: "d1", p_note: "Ban overturned on appeal" }));
  });

  it("a list that cannot be read says so (never reads as owing nothing)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "admin_only" } });
    renderIt();
    expect(await screen.findByText(/Couldn't load what this member owes/)).toBeTruthy();
  });

  it("before the function is deployed (PGRST202) it shows nothing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    const { container } = renderIt();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
