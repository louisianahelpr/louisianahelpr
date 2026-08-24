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
