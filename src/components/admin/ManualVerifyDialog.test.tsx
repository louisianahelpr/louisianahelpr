import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ManualVerifyDialog } from "./ManualVerifyDialog";
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
  full_name: "Marie Beaumont",
  email: "marie@example.com",
} as unknown as Profile;

describe("ManualVerifyDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <ManualVerifyDialog profile={null} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/Manually Verify/)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders the user's name in the title", () => {
    render(<ManualVerifyDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByText(/Manually Verify Marie B\./)).toBeInTheDocument();
    expect(screen.getByText(/logged in the admin audit log/i)).toBeInTheDocument();
  });

  it("calls admin-user-actions with action='manual_verify' on confirm", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ManualVerifyDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    screen.getByRole("button", { name: /Manually Verify/ }).click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
      body: {
        action: "manual_verify",
        userId: "user-id-1",
        note: "",
        reasonCategory: "",
        bypassStrike: false,
      },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("toasts an error when the edge function fails", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("nope") });
    const onClose = vi.fn();
    render(<ManualVerifyDialog profile={sampleProfile} onClose={onClose} />);
    screen.getByRole("button", { name: /Manually Verify/ }).click();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
