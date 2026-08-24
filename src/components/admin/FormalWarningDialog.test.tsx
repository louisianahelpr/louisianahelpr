import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FormalWarningDialog } from "./FormalWarningDialog";
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
} as unknown as Profile;

describe("FormalWarningDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <FormalWarningDialog profile={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the strike-policy explainer with the user's name", () => {
    render(<FormalWarningDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByText(/Repeat Offender Policy/)).toBeInTheDocument();
    expect(screen.getByText(/Marie B\./)).toBeInTheDocument();
  });

  it("disables Issue button when note is empty", () => {
    render(<FormalWarningDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Issue Strike/ })).toBeDisabled();
  });

  it("CTA copy switches to 'Issue (No Escalation)' when bypass is checked", () => {
    render(<FormalWarningDialog profile={sampleProfile} onClose={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(
      screen.getByRole("button", { name: /Issue \(No Escalation\)/ }),
    ).toBeInTheDocument();
  });

  it("submits with category='conduct' (default), note, bypassStrike=false", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <FormalWarningDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    const noteField = screen.getByPlaceholderText(/left gate open/i);
    fireEvent.change(noteField, {
      target: { value: "Customer complaint about rude tone." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Issue Strike/ }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
      body: {
        action: "formal_warning",
        userId: "user-id-1",
        note: "Customer complaint about rude tone.",
        reasonCategory: "conduct",
        bypassStrike: false,
      },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("includes bypassStrike=true when checkbox is checked at submit", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    render(<FormalWarningDialog profile={sampleProfile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText(/left gate open/i), {
      target: { value: "Spoke to them; one-time mistake." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Issue \(No Escalation\)/ }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith(
      "admin-user-actions",
      expect.objectContaining({
        body: expect.objectContaining({ bypassStrike: true }),
      }),
    );
  });

  it("shows error toast and does not call onSuccess when invoke errors", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "User not found" },
    });
    const onSuccess = vi.fn();
    render(
      <FormalWarningDialog
        profile={sampleProfile}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/left gate open/i), {
      target: { value: "Test note" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Issue Strike/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
