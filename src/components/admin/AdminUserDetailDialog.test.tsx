import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminUserDetailDialog } from "./AdminUserDetailDialog";
import type { Database } from "@/integrations/supabase/types";

// ActionsTab calls useNavigate() (impersonation jump), so the dialog
// must render inside a Router.
const render = (ui: React.ReactElement) =>
  rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The dialog only touches supabase from one inline "Move to Pending"
// handler; a render-focused test never exercises it, so a thin stub is
// enough to satisfy the import.
// Hoisted so individual tests can change who the acting admin is — the
// self-ban guard in ActionsTab turns on when this id matches the profile
// on screen.
const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  // `auth.getUser` is read by ActionsTab to decide whether the profile on
  // screen is the acting admin's own (self-ban guard); beforeEach sets the
  // default answer.
  supabase: {
    from: vi.fn(),
    auth: { getUser: () => getUserMock() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// AdminUserNotes / UserVerificationHistory each fetch their own data on
// mount — stub them out so this test stays focused on the dialog shell.
vi.mock("./AdminUserNotes", () => ({
  default: () => <div data-testid="admin-user-notes" />,
}));
vi.mock("./UserVerificationHistory", () => ({
  default: () => <div data-testid="user-verification-history" />,
}));

const pendingProfile = {
  id: "profile-1",
  user_id: "user-1",
  full_name: "Marie Beaumont",
  email: "marie@example.com",
  approval_status: "pending",
  ban_status: "active",
  email_verified: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  application_count: 1,
  avatar_url: null,
  idv_status: null,
} as unknown as Profile;

// Every prop the parent threads in. Data props get empty/neutral values;
// the callbacks are fresh spies per test so each `it` asserts in isolation.
function makeProps(viewProfile: Profile | null) {
  return {
    viewProfile,
    setViewProfile: vi.fn(),
    profileReviews: [],
    profileReviewsLeft: [],
    profileViolations: [],
    profileJobs: [],
    idDocSignedUrl: null,
    emailTracking: [],
    emailSendStats: [],
    lastLoginSummary: {},
    resending: null,
    loadProfiles: vi.fn(),
    approveUser: vi.fn(),
    resendApprovalEmail: vi.fn(),
    resendDenialEmail: vi.fn(),
    resendVerificationEmail: vi.fn(),
    unbanUser: vi.fn(),
    viewHistoryFor: vi.fn(),
    setEditEmailProfile: vi.fn(),
    setDenyProfile: vi.fn(),
    setBanProfile: vi.fn(),
    setDeleteProfile: vi.fn(),
    setManualVerifyProfile: vi.fn(),
    setWarningProfile: vi.fn(),
    setResetPwProfile: vi.fn(),
  };
}

describe("AdminUserDetailDialog", () => {
  beforeEach(() => {
    // Default: the acting admin is someone OTHER than the profile on screen,
    // which is the enabled-control path every other test asserts against.
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "acting-admin" } } });
  });

  it("renders nothing when viewProfile is null", () => {
    render(<AdminUserDetailDialog {...makeProps(null)} />);
    expect(screen.queryByText("User Profile")).not.toBeInTheDocument();
  });

  it("renders the header and all six tabs for a profile", () => {
    render(<AdminUserDetailDialog {...makeProps(pendingProfile)} />);
    expect(screen.getByText("User Profile")).toBeInTheDocument();
    // formatName abbreviates "Marie Beaumont" to "Marie B." in the header.
    expect(screen.getByText("Marie B.")).toBeInTheDocument();
    for (const tab of ["Actions", "Overview", "Jobs", "Reviews", "Docs", "Emails"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    }
  });

  it("opens on the Actions tab", () => {
    render(<AdminUserDetailDialog {...makeProps(pendingProfile)} />);
    expect(screen.getByText("Account Actions")).toBeInTheDocument();
    expect(screen.getByText("Admin Tools")).toBeInTheDocument();
  });

  it("renders Admin Tools above the note composer and verification history", () => {
    // Admin Tools (Suspend/Ban, Delete, Manually Verify, etc.) must be
    // visible on first paint — previously it sat below the note composer
    // and verification history, off-screen until scrolled.
    render(<AdminUserDetailDialog {...makeProps(pendingProfile)} />);
    const positions = [
      screen.getByText("Account Actions"),
      screen.getByText("Admin Tools"),
      screen.getByTestId("admin-user-notes"),
      screen.getByTestId("user-verification-history"),
    ];
    for (let i = 0; i < positions.length - 1; i++) {
      const relation = positions[i].compareDocumentPosition(positions[i + 1]);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("wires the Approve / Deny actions to their props", () => {
    const props = makeProps(pendingProfile);
    render(<AdminUserDetailDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(props.approveUser).toHaveBeenCalledWith(pendingProfile);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(props.setDenyProfile).toHaveBeenCalledWith(pendingProfile);
  });

  it("wires every Admin Tools button to its opener prop", () => {
    const props = makeProps(pendingProfile);
    render(<AdminUserDetailDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Manually Verify/ }));
    fireEvent.click(screen.getByRole("button", { name: /Formal Warning/ }));
    fireEvent.click(screen.getByRole("button", { name: /Reset Password/ }));
    fireEvent.click(screen.getByRole("button", { name: /View History/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suspend \/ Ban/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete Account/ }));
    expect(props.setManualVerifyProfile).toHaveBeenCalledWith(pendingProfile);
    expect(props.setWarningProfile).toHaveBeenCalledWith(pendingProfile);
    expect(props.setResetPwProfile).toHaveBeenCalledWith(pendingProfile);
    expect(props.viewHistoryFor).toHaveBeenCalledWith(pendingProfile);
    expect(props.setBanProfile).toHaveBeenCalledWith(pendingProfile);
    expect(props.setDeleteProfile).toHaveBeenCalledWith(pendingProfile);
  });

  it("disables Suspend / Ban on the acting admin's OWN row", async () => {
    // A self-issued ban locks the admin out of this console with no
    // self-serve undo, and the database refuses the row outright
    // (trg_reject_self_issued_ban, ERRCODE 22023). Offering the control
    // anyway means the only feedback is a raw Postgres string.
    getUserMock.mockResolvedValue({ data: { user: { id: pendingProfile.user_id } } });
    const props = makeProps(pendingProfile);
    render(<AdminUserDetailDialog {...props} />);
    const banBtn = await screen.findByRole("button", { name: /Suspend \/ Ban/ });
    await waitFor(() => expect(banBtn).toBeDisabled());
    fireEvent.click(banBtn);
    expect(props.setBanProfile).not.toHaveBeenCalled();
    // Every other destructive control stays available — this guard is about
    // the ban path, not a blanket lockout of the admin's own row.
    expect(screen.getByRole("button", { name: /Delete Account/ })).toBeEnabled();
  });

  it("wires the edit-email pencil to setEditEmailProfile", () => {
    const props = makeProps(pendingProfile);
    render(<AdminUserDetailDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit email" }));
    expect(props.setEditEmailProfile).toHaveBeenCalledWith(pendingProfile);
  });

  it("renders the Overview tab content without crashing on date fields", () => {
    render(<AdminUserDetailDialog {...makeProps(pendingProfile)} />);
    // Radix Tabs activate on mousedown — fireEvent.click alone won't switch.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("Bio")).toBeInTheDocument();
    expect(screen.getByText("Contact & Account")).toBeInTheDocument();
  });

  it("shows the Move to Pending action for a denied profile", () => {
    const denied = { ...pendingProfile, approval_status: "denied" } as unknown as Profile;
    render(<AdminUserDetailDialog {...makeProps(denied)} />);
    expect(screen.getByRole("button", { name: /Move to Pending/ })).toBeInTheDocument();
  });
});
