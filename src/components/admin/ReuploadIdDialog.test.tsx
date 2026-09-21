import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReuploadIdDialog } from "./ReuploadIdDialog";
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

describe("ReuploadIdDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(
      <ReuploadIdDialog profile={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the user's name and the IDV-status note", () => {
    render(<ReuploadIdDialog profile={sampleProfile} onClose={vi.fn()} />);
    expect(screen.getByText(/Marie B\./)).toBeInTheDocument();
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
  });

  it("calls admin-user-actions with action='request_id_reupload' and the note", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ReuploadIdDialog
        profile={sampleProfile}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    const noteField = screen.getByPlaceholderText(/Photo was too blurry/);
    fireEvent.change(noteField, { target: { value: "Please retake in good lighting." } });
    fireEvent.click(screen.getByRole("button", { name: /Send Re-Upload Request/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
      body: {
        action: "request_id_reupload",
        userId: "user-id-1",
        note: "Please retake in good lighting.",
        reasonCategory: "",
        bypassStrike: false,
      },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  // THE BRANCH NOTHING TOUCHED. Every case above answered `{ data: {}, error:
  // null }`, so `if (error) throw error` — the only thing standing between a
  // failed admin action and a dialog that closes as though it worked — was
  // never executed. Deleting that line left all four green.
  it("a failed edge call is surfaced, and does NOT report success or close", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("admin-user-actions: 403 forbidden") });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<ReuploadIdDialog profile={sampleProfile} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole("button", { name: /Send Re-Upload Request/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/403 forbidden/);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("works with empty note (note is optional)", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    render(<ReuploadIdDialog profile={sampleProfile} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Send Re-Upload Request/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
      body: {
        action: "request_id_reupload",
        userId: "user-id-1",
        note: "",
        reasonCategory: "",
        bypassStrike: false,
      },
    });
  });
});

// The one line that decides WHOSE identity verification is reset and who gets
// the email. `profiles.id` is a different key space from `profiles.user_id`
// (see safeProfiles.ts) and admin-user-actions takes an auth id.
// @mutate src/components/admin/ReuploadIdDialog.tsx | userId: profile.user_id, | userId: profile.id,
// A failed admin action must never read as a success.
// @mutate src/components/admin/ReuploadIdDialog.tsx | if (error) throw error; | if (false) throw error;
