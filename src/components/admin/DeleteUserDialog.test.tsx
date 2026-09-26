import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DeleteUserDialog } from "./DeleteUserDialog";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Mock the supabase client + sonner toasts so the dialog can render
// in isolation. The dialog only calls supabase.functions.invoke and
// toast.{success,error} — both intercepted here.
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

// The Face ID / Touch ID gate on the single most irreversible action in the
// admin console. It is a no-op that returns true on web, so WITHOUT this mock
// the confirmation could be deleted outright and every test here would stay
// green — the gate would be untested on the one surface it exists for.
const requireBiometricMock = vi.fn();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) => requireBiometricMock(...args),
}));

const sampleProfile = {
  id: "profile-id-1",
  user_id: "user-id-1",
  full_name: "Lexi Lombas",
  email: "lexi@example.com",
} as unknown as Profile;

function typeConfirm() {
  fireEvent.change(screen.getByLabelText(/to confirm deleting this account/i), { target: { value: "DELETE" } });
}

describe("DeleteUserDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    requireBiometricMock.mockReset();
    requireBiometricMock.mockResolvedValue(true);
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <DeleteUserDialog profile={null} onClose={vi.fn()} />,
    );
    // Dialog itself should not be in the DOM — Radix renders it
    // via portal only when open. The query for the title text yields
    // null because the dialog never mounted.
    expect(screen.queryByText(/Delete Account/)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders the user's name when profile is provided", () => {
    render(
      <DeleteUserDialog profile={sampleProfile} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Delete Account/)).toBeInTheDocument();
    // formatName outputs "First L." for two-part names.
    expect(screen.getByText(/Lexi L\./)).toBeInTheDocument();
    expect(
      screen.getByText(/permanent and cannot be undone/i),
    ).toBeInTheDocument();
  });

  it("calls supabase.functions.invoke('admin-delete-user') on confirm", async () => {
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <DeleteUserDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    typeConfirm();
    const deleteBtn = screen.getByRole("button", { name: /Delete Permanently/ });
    deleteBtn.click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("admin-delete-user", {
      body: { userId: "user-id-1" },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("deletes nothing when the device confirmation is refused", async () => {
    // Refusing Face ID / the passcode must abandon the delete entirely: no
    // edge-function call, no onSuccess, and the dialog stays open so the
    // admin can see it did not happen.
    requireBiometricMock.mockResolvedValue(false);
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <DeleteUserDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    typeConfirm();
    screen.getByRole("button", { name: /Delete Permanently/ }).click();
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays disabled and deletes nothing until DELETE is typed (Q234)", async () => {
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    render(<DeleteUserDialog profile={sampleProfile} onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /Delete Permanently/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm deleting this account/i), { target: { value: "delete" } });
    expect(btn).toBeDisabled();
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(requireBiometricMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    typeConfirm();
    expect(btn).toBeEnabled();
  });

  it("toasts an error when the edge function fails", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("That user could not be changed right now.") });
    const onClose = vi.fn();
    render(
      <DeleteUserDialog profile={sampleProfile} onClose={onClose} />,
    );
    typeConfirm();
    screen.getByRole("button", { name: /Delete Permanently/ }).click();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("That user could not be changed right now."));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// The irreversible-action confirmation. Deleting the early return lets a
// refused Face ID / passcode fall straight through into admin-delete-user.
// @mutate src/components/admin/DeleteUserDialog.tsx | if (!ok) return; |
