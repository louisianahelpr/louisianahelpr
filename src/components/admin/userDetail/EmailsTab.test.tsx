/**
 * Q2354 (owner 2026-10-23): "add a button or something for admin to see when
 * the last reminder to verify their email went out? or give us a button to push
 * to send another follow up email". The Emails tab reads the real send record
 * (email_send_log, template 'signup': the one at sign-up, the member's own
 * resend and an admin's), not the admin-only profile counter that showed
 * "0 / 3" for a member who had three; the button says when the next can go.
 *
 * @mutate src/components/admin/userDetail/EmailsTab.tsx |           disabled={resending === viewProfile.id \|\| waitMin > 0} |           disabled={resending === viewProfile.id}
 * @mutate src/components/admin/userDetail/EmailsTab.tsx |             <span>Emails sent: {signupStat?.count ?? 0}</span> |             <span>Emails sent: {viewProfile.verification_email_count || 0}</span>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import { EmailsTab } from "./EmailsTab";
import type { Profile } from "../adminUserHelpers";

const unverified = { id: "p1", user_id: "u1", email: "lucy@example.com", email_verified: false, verification_email_count: 0, last_verification_email_at: null } as unknown as Profile;

function show(stats: Array<{ template_name: string; count: number; last_sent: string }>) {
  return render(
    <Tabs value="emails">
      <EmailsTab viewProfile={unverified} emailTracking={[]} emailSendStats={stats} resending={null} resendVerificationEmail={vi.fn()} />
    </Tabs>,
  );
}

describe("admin Emails tab: when the last verify-your-email message went (Q2354)", () => {
  it("shows the real count and time from the send record, not the admin-only counter", () => {
    show([{ template_name: "signup", count: 3, last_sent: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);
    expect(document.querySelector("[data-verify-history]")?.textContent).toMatch(/Emails sent: 3/);
    expect(document.querySelector("[data-verify-history]")?.textContent).toMatch(/Last sent: 3 days ago/);
    expect(document.querySelector("[data-verify-history]")?.textContent).not.toMatch(/\/ 3/);
    const btn = screen.getByRole("button", { name: /send another verification email/i });
    expect(btn).toBeEnabled();
  });

  it("within an hour of the last one, the button says when the next can go and is disabled", () => {
    show([{ template_name: "signup", count: 1, last_sent: new Date(Date.now() - 20 * 60_000).toISOString() }]);
    const btn = screen.getByRole("button", { name: /next reminder can go in 40 min/i });
    expect(btn).toBeDisabled();
  });

  it("with nothing on record, it offers the first one", () => {
    show([]);
    expect(screen.getByRole("button", { name: /^send verification email$/i })).toBeEnabled();
    expect(document.querySelector("[data-verify-history]")?.textContent).toMatch(/Emails sent: 0/);
  });
});
