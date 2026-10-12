import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BanDialog } from "./BanDialog";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// BanDialog touches multiple supabase tables (user_violations, user_bans,
// profiles) plus auth.getUser. Mock the whole client surface to keep
// the test focused on the action-type branching logic.
const fromMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const getUserMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUserMock() },
    from: (...args: unknown[]) => fromMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const createNotificationMock = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

const logAdminActionMock = vi.fn();
vi.mock("@/lib/adminAudit", () => ({
  logAdminAction: (...args: unknown[]) => logAdminActionMock(...args),
}));

/*
 * THE GATE, MADE OBSERVABLE.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest: importing it proves nothing,
 * and the confirmation in front of ending someone's ability to earn on this
 * platform could be deleted with every case in this file green.
 *
 * Mocked with a handle instead. `beforeEach` defaults it to `true` so the six
 * cases above are untouched — a mock pinned to `true` is the opposite of
 * coverage, it deletes the gate from the test's world — and the refusal case at
 * the bottom drives it `false` and asserts not one row was written.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

// Q1414: the dialog's pre-check of ban_settlement_queue.
let reviewResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const reviewChain = () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => Promise.resolve(reviewResult);
  return chain;
};

const sampleProfile = {
  id: "profile-id-1",
  user_id: "user-id-1",
  full_name: "Marie Beaumont",
} as unknown as Profile;

describe("BanDialog", () => {
  beforeEach(() => {
    fromMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    eqMock.mockReset();
    selectMock.mockReset();
    getUserMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    createNotificationMock.mockReset();
    logAdminActionMock.mockReset();
    requireBiometricMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    // Default PASS, so every existing case behaves exactly as it did.
    requireBiometricMock.mockResolvedValue(true);

    // Default: chained .from().insert/update/eq[.select] returns OK.
    // The profiles writes end in `.select("user_id")` so unwrapMutation can see
    // the affected-row count — a ban that matched zero rows used to look
    // identical to a ban that landed.
    selectMock.mockResolvedValue({ data: [{ user_id: "user-id-1" }], error: null });
    eqMock.mockReturnValue({ select: selectMock, then: (r: (v: unknown) => unknown) => r({ error: null }) });
    insertMock.mockResolvedValue({ error: null });
    updateMock.mockReturnValue({ eq: eqMock });
    fromMock.mockImplementation((table: string) =>
      table === "ban_settlement_queue" ? reviewChain() : { insert: insertMock, update: updateMock },
    );
    reviewResult = { data: [], error: null };
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-id" } } });
  });

  // Q1414: an open ban settlement review refuses the status write, but only at
  // the last step, after the user_bans row and the strike were already in.
  // The dialog now asks first and writes NOTHING.
  // @mutate src/components/admin/BanDialog.tsx |     if ((openReviews ?? []).length > 0) { |     if (false) {
  // @mutate src/components/admin/BanDialog.tsx |     if (reviewErr) { |     if (false) {
  it.each([
    ["Temp Ban", /Ban for 7 days/],
    ["Perm Ban", /Permanently Ban/],
    [null, /Issue Warning/],
  ] as const)("an account under an open ban review: %s writes nothing and says why (Q1414)", async (tier, cta) => {
    reviewResult = { data: [{ id: "review-1" }], error: null };
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    if (tier) fireEvent.click(screen.getByText(new RegExp(tier)));
    fireEvent.click(screen.getByRole("button", { name: cta }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/ban settlement review/i)));
    expect(insertMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("an unreadable review state fails closed: nothing written (Q1414)", async () => {
    reviewResult = { data: null, error: { message: "boom" } };
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Permanently Ban/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't check/i)));
    expect(insertMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(<BanDialog profile={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("starts on the warning action by default", () => {
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} />);
    // Confirm button copy reflects warning mode initially
    expect(screen.getByRole("button", { name: /Issue Warning/ })).toBeInTheDocument();
  });

  it("submit is enabled by default — reason picker defaults to a valid category", () => {
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /Issue Warning/ });
    // The reason picker defaults to "tos", which produces a usable label
    // for the audit row even without a freeform note.
    expect(btn).not.toBeDisabled();
  });

  // Q1494: the standing, the ban row and the strike are ONE server call
  // (apply_account_action -> admin_apply_account_action, one transaction); the
  // dialog writes no table itself, so a review opened mid-way can no longer
  // leave a ban row and a strike behind a refused status write.
  // @mutate src/components/admin/BanDialog.tsx |         await applyAdminAccountAction({\n          userId: profile.user_id,\n          action: "warning", |         await supabase.from("user_violations").insert({ user_id: profile.user_id, violation_type: "admin_warning", action_taken: "warning", reported_by: user.id });\n        await applyAdminAccountAction({\n          userId: profile.user_id,\n          action: "warning",
  it.each([
    [null, /Issue Warning/, "warning"],
    ["Temp Ban", /Ban for 7 days/, "temporary"],
    ["Perm Ban", /Permanently Ban/, "permanent"],
  ] as const)("%s is one apply_account_action call and no direct table write (Q1494)", async (tier, cta, kind) => {
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    if (tier) fireEvent.click(screen.getByText(new RegExp(tier)));
    fireEvent.click(screen.getByRole("button", { name: cta }));

    // Wait on the LAST step of the submit chain, not the first (a waitFor on
    // an early step went red under load while being correct in isolation).
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("admin-user-actions");
    expect(invokeMock.mock.calls[0][1].body).toMatchObject({ action: "apply_account_action", userId: sampleProfile.user_id, kind });
    // Only the review pre-check reads a table; nothing is inserted or updated.
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(["ban_settlement_queue"]);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(logAdminActionMock).toHaveBeenCalled();
  });

  it("a temp ban sends one end date, in the future, for the ban row and the profile alike", async () => {
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText(/Temp Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Ban for 7 days/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = invokeMock.mock.calls[0][1].body;
    expect(body).toMatchObject({ action: "apply_account_action", userId: sampleProfile.user_id, kind: "temporary" });
    const ms = Date.parse(body.suspendedUntil);
    expect(ms).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(ms).toBeLessThan(Date.now() + 8 * 86_400_000);
  });

  it("the server refusing an open review (opened after the pre-check) is reported, not closed on", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "non-2xx",
        context: new Response(JSON.stringify({ error: "This account is under a ban settlement review. Confirm or lift it in the Fraud console first. Nothing was changed.", code: "ban_review_open" }), { status: 409 }),
      },
    });
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Permanently Ban/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/ban settlement review/i)));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("a ban the server matched no profile for is reported, not closed on", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ error: "User not found", rejected: true }), { status: 404 }) },
    });
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Permanently Ban/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/permanent ban wasn't applied/i)));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("refuses a self-targeted action — no write, explicit toast", async () => {
    // The server refuses a self-issued user_bans row
    // (trg_reject_self_issued_ban), but the WARNING tier writes no ban row at
    // all — only profiles.ban_status — so without this guard an admin could
    // put their own account one strike from a ban with nothing to stop it.
    getUserMock.mockResolvedValue({ data: { user: { id: sampleProfile.user_id } } });
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole("button", { name: /Issue Warning/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/your own account/i)));
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("switches CTA copy when temp-ban tier is selected", () => {
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} />);
    const tempBtn = screen.getByText(/Temp Ban/);
    fireEvent.click(tempBtn);
    expect(screen.getByRole("button", { name: /Ban for 7 days/ })).toBeInTheDocument();
  });

  it("shows the permanent-ban warning callout when perm tier is selected", () => {
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    expect(screen.getByText(/lose access permanently/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Permanently Ban/ })).toBeInTheDocument();
  });

  it("a refused Face ID prompt bans nobody — no ban row, no profile write, dialog stays open", async () => {
    // The permanent tier, because it is the one with no self-serve undo.
    requireBiometricMock.mockResolvedValue(false);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<BanDialog profile={sampleProfile} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Permanently Ban/ }));

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain the microtasks the submit could still have queued — asserting
    // "not called" the instant the gate resolves would pass with the guard
    // deleted, because the writes are a tick further along.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN. Not one table was touched: the gate sits
    // ahead of even `auth.getUser()`, so a refusal costs a round trip too.
    expect(getUserMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(logAdminActionMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the dialog is still up, on the tier that was picked.
    expect(screen.getByRole("button", { name: /Permanently Ban/ })).toBeInTheDocument();
  });

  it("the reason the prompt names matches the severity the admin picked", async () => {
    // A generic "Confirm this action" on the OS sheet is how someone learns to
    // approve every prompt. The permanent tier says so by name.
    render(<BanDialog profile={sampleProfile} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByText(/Perm Ban/));
    fireEvent.click(screen.getByRole("button", { name: /Permanently Ban/ }));
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/permanent ban/i);
  });
});

// The self-action guard is the one line here that is pure authorization: the
// WARNING tier writes no user_bans row, so `trg_reject_self_issued_ban` never
// sees it and nothing on the server stops an admin putting their own account
// one strike from a ban. Neutering the condition must turn the
// "refuses a self-targeted action" case red.
// @mutate src/components/admin/BanDialog.tsx | if (profile.user_id === user.id) { | if (false) {
//
// The biometric gate is the OTHER thing here that is pure authorization, and
// until 2026-09-21 nothing in this file could see it: the real module returns
// true on web, so `if (!ok) return;` was deletable with 6/6 green. Driving it
// to a refusal and asserting no table was touched is what makes the line below
// provable.
// @mutate src/components/admin/BanDialog.tsx | if (!ok) return;\n    setBanning(true); | setBanning(true);
