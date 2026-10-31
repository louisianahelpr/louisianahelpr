/**
 * GUARD (owner 2026-10-27, Q2420 + Q2421): Admin > Users > a member's detail.
 *
 * Q2420: an unconfirmed member shows "Last confirm email: <date, time> (N sent)"
 * (profiles.last_verification_email_at / verification_email_count) under the
 * name, on every tab, with a "Resend confirm email" button. The button calls
 * admin-resend-verification, which sends through the SAME GoTrue signup resend
 * as the member's own Resend (SignupPending: same per-address rate limit, same
 * /signup-pending landing), answers that rate limit in the member's words
 * (429), and writes an admin_audit_log row.
 *
 * Q2421: the detail shows the member's FULL name (first and last). Admin only:
 * member-facing surfaces keep formatName's "First L." (unchanged here).
 *
 * @mutate src/components/admin/AdminUserDetailDialog.tsx |             <ConfirmEmailRow viewProfile={viewProfile} resending={resending} resendVerificationEmail={resendVerificationEmail} />\n |
 * @mutate src/components/admin/userDetail/ConfirmEmailRow.tsx | ({sent} sent) | (sent)
 * @mutate src/components/admin/userDetail/DetailHeader.tsx | {adminFullName(viewProfile.full_name, "—")}</h3> | {formatName(viewProfile.full_name, "—")}</h3>
 * @mutate supabase/functions/admin-resend-verification/index.ts | options: { emailRedirectTo: new URL(CONFIRM_LINK_PATH, getAppUrl()).toString() }, |
 * @mutate supabase/functions/admin-resend-verification/index.ts | action: 'manual_resend_verification', | action: undefined,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminUserDetailDialog } from "@/components/admin/AdminUserDetailDialog";
import { confirmEmailSentAt } from "@/components/admin/userDetail/ConfirmEmailRow";
import { formatName } from "@/lib/utils";
import { blankComments } from "./helpers/blankNonCode";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), auth: { getUser: () => getUserMock() } },
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/components/admin/AdminUserNotes", () => ({ default: () => null }));
vi.mock("@/components/admin/UserVerificationHistory", () => ({ default: () => null }));

const SENT_AT = "2026-10-25T15:42:00Z";
const member = (over: Partial<Profile> = {}) => ({
  id: "profile-1", user_id: "user-1", full_name: "Taylor  Ann Mouton ", email: "taylor@example.com",
  ban_status: "active", email_verified: false, verification_email_count: 2, last_verification_email_at: SENT_AT,
  created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-25T00:00:00Z", application_count: 1, avatar_url: null, idv_status: null,
  ...over,
}) as unknown as Profile;

const props = (viewProfile: Profile) => ({
  viewProfile, setViewProfile: vi.fn(), profileReviews: [], profileReviewsLeft: [], profileViolations: [], profileJobs: [],
  emailTracking: [], emailSendStats: [], lastLoginSummary: {}, resending: null, resendVerificationEmail: vi.fn(),
  unbanUser: vi.fn(), viewHistoryFor: vi.fn(), setEditEmailProfile: vi.fn(), setBanProfile: vi.fn(), setDeleteProfile: vi.fn(),
  setManualVerifyProfile: vi.fn(), setWarningProfile: vi.fn(), setResetPwProfile: vi.fn(),
});

beforeEach(() => {
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: "acting-admin" } } });
});

describe("Admin member detail: confirm email row (Q2420) and full name (Q2421)", () => {
  it("an unconfirmed member shows when the last confirm email went, how many, and a resend", () => {
    const p = props(member());
    render(<AdminUserDetailDialog {...p} />);
    const row = document.querySelector("[data-confirm-email-row]");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(`Last confirm email: ${confirmEmailSentAt(SENT_AT)} (2 sent)`);
    // Date AND time, never a relative "2 days ago".
    expect(confirmEmailSentAt(SENT_AT)).toMatch(/^Oct 2[45], 2026, \d{1,2}:\d{2} [AP]M$/);
    fireEvent.click(screen.getByRole("button", { name: "Resend confirm email" }));
    expect(p.resendVerificationEmail).toHaveBeenCalledWith(p.viewProfile);
    // One resend control in the dialog, not one per tab.
    expect(screen.getAllByRole("button", { name: /resend/i })).toHaveLength(1);
  });

  it("a member never sent one says so, and a confirmed member has no row", () => {
    render(<AdminUserDetailDialog {...props(member({ verification_email_count: 0, last_verification_email_at: null }))} />);
    expect(document.querySelector("[data-confirm-email-row]")!.textContent).toContain("Last confirm email: none on record (0 sent)");
  });

  it("a confirmed member has no confirm-email row", () => {
    render(<AdminUserDetailDialog {...props(member({ email_verified: true }))} />);
    expect(document.querySelector("[data-confirm-email-row]")).toBeNull();
  });

  it("the detail heading is the member's full name, not the member-facing short form", () => {
    render(<AdminUserDetailDialog {...props(member())} />);
    expect(screen.getByRole("heading", { name: "Taylor Ann Mouton" })).toBeTruthy();
    expect(formatName("Taylor Ann Mouton")).toBe("Taylor M."); // members keep the short form
    expect(screen.queryByText("Taylor M.")).toBeNull();
  });

  it("the resend uses the member's own path, says its rate limit, and is audited", () => {
    const fn = blankComments(readFileSync(join(process.cwd(), "supabase/functions/admin-resend-verification/index.ts"), "utf8"));
    expect(fn).toMatch(/admin\.auth\.resend\(\{\s*type: 'signup',\s*email: \(profile as any\)\.email,\s*options: \{ emailRedirectTo: new URL\(CONFIRM_LINK_PATH, getAppUrl\(\)\)\.toString\(\) \},/);
    expect(fn).toMatch(/status: 429/);
    expect(fn).toMatch(/from\('admin_audit_log'\)\.insert\(\{[\s\S]*?action: 'manual_resend_verification'/);
    expect(fn).toMatch(/rpc\('has_role'/);
    // The member's own Resend lands on the same page.
    const pending = blankComments(readFileSync(join(process.cwd(), "src/pages/auth/SignupPending.tsx"), "utf8"));
    expect(pending).toMatch(/auth\.resend\(\{\s*type: "signup",[\s\S]*?emailRedirectTo: getSignupConfirmRedirect\(\)/);
    expect(readFileSync(join(process.cwd(), "src/lib/authRedirects.ts"), "utf8")).toMatch(/getSignupConfirmRedirect = \(\): string => `\$\{getPublicOrigin\(\)\}\/signup-pending`/);
    expect(readFileSync(join(process.cwd(), "supabase/functions/_shared/confirmLink.ts"), "utf8")).toMatch(/CONFIRM_LINK_PATH = "\/signup-pending"/);
  });
});
