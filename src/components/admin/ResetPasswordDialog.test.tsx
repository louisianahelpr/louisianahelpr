import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
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

describe("ResetPasswordDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <ResetPasswordDialog profile={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the user's email in the body copy", () => {
    render(<ResetPasswordDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByText(/lexi@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/expires in 1 hour/i)).toBeInTheDocument();
  });

  it("falls back to 'this user' when email is missing", () => {
    render(
      <ResetPasswordDialog
        profile={{ ...sampleProfile, email: null } as unknown as Profile}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/this user/i)).toBeInTheDocument();
  });

  it("calls admin-user-actions with action='reset_password' on confirm", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ResetPasswordDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    screen.getByRole("button", { name: /Send Reset Link/ }).click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
      body: {
        action: "reset_password",
        userId: "user-id-1",
        note: "",
        reasonCategory: "",
        bypassStrike: false,
      },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
});

/*
 * HOLLOW UNTIL 2026-09-21. Everything above this line passes with
 * `if (error) throw error;` DELETED from the dialog: the only invoke these
 * tests set up resolves `{ error: null }`, so the failure branch was never
 * reached — an admin whose reset email never went out would have watched the
 * dialog close on "success". Same shape as the ReuploadIdDialog / adminAudit
 * hollow guards in the burn-down.
 *
 * And the retry. `inFlight` is a ref, so only the `finally` hands the button
 * back. Delete that one line and a single failed send locks the admin out of
 * resending for the life of the dialog: the button re-enables (that is
 * `setBusy(false)`, a different line) and then silently does nothing — the
 * PostedJobActions latch defect exactly.
 */
describe("ResetPasswordDialog — the send failed", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("surfaces the failure and does NOT close the dialog", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("The mail service is down right now.") });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<ResetPasswordDialog profile={sampleProfile} onClose={onClose} onSuccess={onSuccess} />);
    screen.getByRole("button", { name: /Send Reset Link/ }).click();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The mail service is down right now."));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("RELEASES the in-flight latch, so the admin can send again", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error("The mail service is down right now.") });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<ResetPasswordDialog profile={sampleProfile} onClose={onClose} onSuccess={onSuccess} />);
    const button = screen.getByRole("button", { name: /Send Reset Link/ });
    button.click();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(button).not.toBeDisabled());

    // Second attempt, provider back up. This is the assertion an engage-only
    // version of this file can never make.
    invokeMock.mockResolvedValue({ data: {}, error: null });
    button.click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});

// @mutate src/components/admin/ResetPasswordDialog.tsx |       if (error) throw error; |       void error;
// @mutate src/components/admin/ResetPasswordDialog.tsx | } finally {\n      inFlight.current = false;\n      setBusy(false);\n    } | } finally {\n      setBusy(false);\n    }
