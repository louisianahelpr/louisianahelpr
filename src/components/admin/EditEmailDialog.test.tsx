import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
