import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    getUserMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    createNotificationMock.mockReset();
    logAdminActionMock.mockReset();

    // Default: chained .from().insert/update/eq returns OK
    eqMock.mockResolvedValue({ error: null });
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

    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    // First insert: user_violations row
    expect(fromMock).toHaveBeenCalledWith("user_violations");
    // Then update: profiles.ban_status='final_warning'
    expect(fromMock).toHaveBeenCalledWith("profiles");
    expect(logAdminActionMock).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
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
});
