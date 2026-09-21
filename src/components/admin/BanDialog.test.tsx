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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUserMock() },
    from: (...args: unknown[]) => fromMock(...args),
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
    fromMock.mockReturnValue({
      insert: insertMock,
      update: updateMock,
    });
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-id" } } });
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

  it("submits warning with default category → user_violations insert + ban_status='final_warning'", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <BanDialog profile={sampleProfile} onClose={onClose} onSuccess={onSuccess} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Issue Warning/ }));

    // Wait on the LAST step of the submit chain, not the first. Waiting for
    // the insert and then asserting onSuccess synchronously assumes the whole
    // promise chain flushes inside waitFor's first poll — true on an idle
    // machine, and the reason this test went red under load while being
    // perfectly correct in isolation.
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    // First insert: user_violations row
    expect(insertMock).toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("user_violations");
    // Then update: profiles.ban_status='final_warning'
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(logAdminActionMock).toHaveBeenCalled();
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
