import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminUserDetailDialog } from "./AdminUserDetailDialog";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The dialog only touches supabase from one inline "Move to Pending"
// handler; a render-focused test never exercises it, so a thin stub is
// enough to satisfy the import.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
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

  it("wires the edit-email pencil to setEditEmailProfile", () => {
    const props = makeProps(pendingProfile);
    render(<AdminUserDetailDialog {...props} />);
    fireEvent.click(screen.getByTitle("Edit email"));
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
