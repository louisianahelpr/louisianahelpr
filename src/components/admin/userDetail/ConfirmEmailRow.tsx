import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Profile, isVerifiedEmail } from "../adminUserHelpers";

/** "Oct 27, 2026, 11:05 AM": the date AND time, not "3 days ago". */
export const confirmEmailSentAt = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Owner 2026-10-27 (Q2420): an unconfirmed member's detail says when the last
 * confirm email went out and how many have, and offers a resend, right under
 * the name on every tab (it used to sit in the Emails tab only, as a relative
 * "3 days ago").
 *
 * The button calls admin-resend-verification, which sends through the SAME
 * GoTrue signup resend as the member's own "Resend" on the Check-your-email
 * screen (same per-address rate limit, same /signup-pending landing) and
 * writes an admin_audit_log row (manual_resend_verification).
 * Guard: src/test/adminMemberDetail.test.tsx.
 */
export function ConfirmEmailRow({ viewProfile, resending, resendVerificationEmail }: {
  viewProfile: Profile;
  resending: string | null;
  resendVerificationEmail: (profile: Profile) => void;
}) {
  if (isVerifiedEmail(viewProfile)) return null;
  const sent = viewProfile.verification_email_count || 0;
  const at = viewProfile.last_verification_email_at;
  return (
    <div data-confirm-email-row="" className="flex flex-col gap-2 rounded-2xl border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ds-12 text-foreground flex items-center gap-1.5">
        <MailIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span>Last confirm email: {at ? confirmEmailSentAt(at) : "none on record"} ({sent} sent)</span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => resendVerificationEmail(viewProfile)}
        disabled={resending === viewProfile.id}
      >
        {resending === viewProfile.id ? "Sending…" : "Resend confirm email"}
      </Button>
    </div>
  );
}
