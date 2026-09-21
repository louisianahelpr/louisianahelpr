import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EditEmailDialog } from "./EditEmailDialog";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

/*
 * THE GATE, MADE OBSERVABLE.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. Importing it and calling it
 * proves nothing: the whole Face ID confirmation in front of repointing a
 * user's LOGIN EMAIL could be deleted and every test here stayed green (it was,
 * in fact, the second such hole found on 2026-09-21).
 *
 * So it is mocked with a handle the tests can drive. `beforeEach` defaults it
 * to `true` — a mock that only ever returns true is the OPPOSITE of coverage,
 * it removes the gate from the test's world — and the refusal case below drives
 * it `false` and asserts the edge function was never reached.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const sampleProfile = {
  id: "profile-id-1",
  user_id: "user-id-1",
  full_name: "Lexi Lombas",
  email: "lexi@example.com",
} as unknown as Profile;

describe("EditEmailDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    requireBiometricMock.mockReset();
    // Default PASS, so every case above this one is unchanged by the gate.
    requireBiometricMock.mockResolvedValue(true);
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <EditEmailDialog profile={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows current email and dialog title", () => {
    render(<EditEmailDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByText(/Change Email for Lexi Lombas/)).toBeInTheDocument();
    expect(screen.getByText(/lexi@example\.com/)).toBeInTheDocument();
  });

  it("disables Update button when emails don't match", () => {
    render(<EditEmailDialog profile={sampleProfile} onClose={vi.fn()} />);
    // Query the exact accessible names, not /email/i: that pattern also
    // matches the dialog's own heading and body text, and fireEvent then tries
    // to set a value on a <p>.
    const inputs = [
      screen.getByLabelText("New email"),
      screen.getByLabelText("Confirm new email"),
    ];
    fireEvent.change(inputs[0], { target: { value: "new@example.com" } });
    fireEvent.change(inputs[1], { target: { value: "different@example.com" } });
    expect(screen.getByText(/Emails don't match/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Update Email/ });
    expect(btn).toBeDisabled();
  });

  it("toasts error and skips invoke on invalid email format", async () => {
    render(<EditEmailDialog profile={sampleProfile} onClose={vi.fn()} />);
    // Query the exact accessible names, not /email/i: that pattern also
    // matches the dialog's own heading and body text, and fireEvent then tries
    // to set a value on a <p>.
    const inputs = [
      screen.getByLabelText("New email"),
      screen.getByLabelText("Confirm new email"),
    ];
    fireEvent.change(inputs[0], { target: { value: "notanemail" } });
    fireEvent.change(inputs[1], { target: { value: "notanemail" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Email/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("valid email"));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls admin-update-email with the new email and fires onSuccess", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <EditEmailDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    // Query the exact accessible names, not /email/i: that pattern also
    // matches the dialog's own heading and body text, and fireEvent then tries
    // to set a value on a <p>.
    const inputs = [
      screen.getByLabelText("New email"),
      screen.getByLabelText("Confirm new email"),
    ];
    fireEvent.change(inputs[0], { target: { value: "new@example.com" } });
    fireEvent.change(inputs[1], { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Email/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("admin-update-email", {
      body: { userId: "user-id-1", newEmail: "new@example.com" },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    // The gate was ASKED on the happy path too — a gate that is never reached
    // is as absent as one that is never obeyed.
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused Face ID prompt changes nothing — no invoke, no close, dialog still open", async () => {
    // Repointing a login email hands password reset to the new address from
    // that moment on. If the confirmation can be refused and the change still
    // lands, the gate is decoration.
    requireBiometricMock.mockResolvedValue(false);
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <EditEmailDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    const newEmail = screen.getByLabelText("New email");
    const confirmEmail = screen.getByLabelText("Confirm new email");
    fireEvent.change(newEmail, { target: { value: "attacker@example.com" } });
    fireEvent.change(confirmEmail, { target: { value: "attacker@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Update Email/ }));

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain every microtask the submit could still have queued. Asserting
    // "not called" the instant the gate resolves would pass even with the
    // guard deleted, because the invoke is one tick further along.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the dialog is still standing, with what was typed still in it, so
    // the admin can see the change did not go through.
    expect(screen.getByRole("button", { name: /Update Email/ })).toBeInTheDocument();
    expect(newEmail).toHaveValue("attacker@example.com");
  });
});

// The format check is what stands between a typo and admin-update-email being
// invoked with an address nobody owns.
// @mutate src/components/admin/EditEmailDialog.tsx | if (!emailRegex.test(email1)) { | if (false) {
//
// BLIND SPOT CLOSED 2026-09-21. `requireBiometric` is now mocked with a handle
// and driven to a refusal, and the refusal case asserts the edge function was
// never invoked — not merely that "a toast appeared". Deleting the component's
// `if (!ok) return;` must therefore turn this file red, which is what the
// registration below proves.
// @mutate src/components/admin/EditEmailDialog.tsx | if (!ok) return;\n\n    setUpdating(true); | setUpdating(true);
