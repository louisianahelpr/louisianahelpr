import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const sampleProfile = {
  id: "profile-id-1",
  user_id: "user-id-1",
  full_name: "Lexi Lombas",
  email: "lexi@example.com",
} as unknown as Profile;

describe("DeleteUserDialog", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
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
    const deleteBtn = screen.getByRole("button", { name: /Delete Permanently/ });
    deleteBtn.click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("admin-delete-user", {
      body: { userId: "user-id-1" },
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("toasts an error when the edge function fails", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("nope") });
    const onClose = vi.fn();
    render(
      <DeleteUserDialog profile={sampleProfile} onClose={onClose} />,
    );
    screen.getByRole("button", { name: /Delete Permanently/ }).click();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("nope"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
