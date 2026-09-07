import {
  CheckCircle2, XCircle, Clock, ShieldAlert, ShieldCheck, KeyRound,
  MessageSquareWarning, History, Trash2, Eye, UserMinus,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import AdminUserNotes from "../AdminUserNotes";
import UserVerificationHistory from "../UserVerificationHistory";
import { UserAuditLog } from "./UserAuditLog";
import type { Profile } from "../adminUserHelpers";
import { useImpersonation } from "@/hooks/useImpersonation";
import { cn, formatName } from "@/lib/utils";
import { logAdminAction } from "@/lib/adminAudit";
import { toneTextClasses } from "@/components/admin/tones";
import { RestrictApplicationsDialog } from "../RestrictApplicationsDialog";

type EmailEvent = { event_type: string; email_type: string; created_at: string };

interface ActionsTabProps {
  viewProfile: Profile;
  viewBanStatus: string;
  emailTracking: EmailEvent[];
  lastLoginSummary: Record<string, string>;
  approveUser: (profile: Profile) => void;
  unbanUser: (profile: Profile) => void;
  viewHistoryFor: (profile: Profile) => void;
  setDenyProfile: (profile: Profile | null) => void;
  setBanProfile: (profile: Profile | null) => void;
  setDeleteProfile: (profile: Profile | null) => void;
  setManualVerifyProfile: (profile: Profile | null) => void;
  setWarningProfile: (profile: Profile | null) => void;
  setResetPwProfile: (profile: Profile | null) => void;
}

export function ActionsTab({
  viewProfile,
  viewBanStatus,
  emailTracking,
  lastLoginSummary,
  approveUser,
  unbanUser,
  viewHistoryFor,
  setDenyProfile,
  setBanProfile,
  setDeleteProfile,
  setManualVerifyProfile,
  setWarningProfile,
  setResetPwProfile,
}: ActionsTabProps) {
  const navigate = useNavigate();
  const { start: startImpersonation } = useImpersonation();
  const [restrictProfile, setRestrictProfile] = useState<Profile | null>(null);
  const showApprovedActivityChip = viewProfile.approval_status === "approved"
    && !["permanently_banned", "temp_banned"].includes(viewBanStatus);

  const beginImpersonation = async () => {
    const displayName = formatName(viewProfile.full_name, "User");
    startImpersonation(viewProfile.user_id, displayName);
    // Audit the impersonation start — required for compliance even
    // though no mutation is performed.
    await logAdminAction("impersonate_user_start", "user", viewProfile.user_id, {
      mode: "read_only",
    });
    navigate("/dashboard");
  };

  return (
    <TabsContent value="actions" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Primary lifecycle actions */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Account Actions</h4>
        <div className="flex gap-2 flex-wrap">
          {viewProfile.approval_status === "pending" && (
            <>
              <Button variant="outline" className="flex-1 min-w-[140px] text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setDenyProfile(viewProfile)}>
                <XCircle className="w-4 h-4 mr-1" /> Deny
              </Button>
              <Button className="flex-1 min-w-[140px]" onClick={() => approveUser(viewProfile)}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
              </Button>
            </>
          )}
          {showApprovedActivityChip && (() => {
            const opens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
            const clicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
            const hasLoggedIn = !!lastLoginSummary[viewProfile.user_id];
            // The OR that `identity_is_verified(idv_status,
            // stripe_identity_verified)` computes in the database — reading only
            // `idv_status` here would call a Stripe-verified account "Awaiting
            // first login" while the hiring gate treats it as verified.
            const idvVerified = viewProfile.idv_status === 'verified'
              || viewProfile.stripe_identity_verified === true;
            const hasStripe = !!viewProfile.stripe_account_id;
            const hasOpenedEmail = opens.length > 0 || clicks.length > 0;
            const isActive = hasLoggedIn || idvVerified || hasStripe || hasOpenedEmail;
            const activeLabel = idvVerified
              ? "ID verified"
              : hasLoggedIn
              ? "Active — has logged in"
              : hasStripe
              ? "Stripe payout connected"
              : "Has opened approval email";
            return isActive ? (
              <div className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-ds-11 text-primary font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {activeLabel}
              </div>
            ) : (
              <div className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-muted/50 border border-border text-ds-11 text-muted-foreground font-medium">
                <Clock className="w-3.5 h-3.5" />
                Awaiting first login
              </div>
            );
          })()}
        </div>
      </div>

      {/* Trust & Verification + Support actions. Rendered directly below
          Account Actions (and above the note composer / verification
          history) so the primary admin controls are visible on first
          paint instead of requiring a scroll past notes and history. */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Admin Tools</h4>
        {/* TWO columns, not three. `Button` is `whitespace-nowrap`, so a label
            that does not fit its cell cannot wrap — it is clipped, silently and
            at every breakpoint. At three columns inside this ~680px dialog that
            was already happening to "Formal Warning", "Reset Password" and
            "Impersonate (RO)", which rendered as "Formal Warnin", "Reset
            Passwor" and "Impersonate (R". Screenshots, not measurements, are
            what surfaced it — every one of those buttons reports its full text
            in the DOM, so a textContent assertion passes on a clipped control.
            Two columns fit the longest label ("Restrict Applications") with
            room to spare. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setManualVerifyProfile(viewProfile)}>
            <ShieldCheck className="w-4 h-4 mr-1.5 text-primary" /> Manually Verify
          </Button>
          <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setWarningProfile(viewProfile)}>
            <MessageSquareWarning className="w-4 h-4 mr-1.5 text-accent" /> Formal Warning
          </Button>
          <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setResetPwProfile(viewProfile)}>
            <KeyRound className="w-4 h-4 mr-1.5 text-primary" /> Reset Password
          </Button>
          <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => viewHistoryFor(viewProfile)}>
            <History className="w-4 h-4 mr-1.5" /> View History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 justify-start"
            onClick={beginImpersonation}
            /* The old title said "read-only, all mutations blocked". It is not.
               useImpersonation's own header states the flag "is NOT a security
               boundary", and `assertWritable()` — the opt-in guard that refuses
               a write while impersonating — is called at exactly SIX call sites
               in the whole app (send message ×3, apply to job, post job). Every
               other mutation surface — cancel or complete a job, leave a review,
               edit the profile, change payout details, delete the account — is
               unguarded and executes for real, authenticated as the ADMIN, while
               the tooltip promised a sandbox. Telling an operator the truth is
               the fix that belongs in this file; hardening the guard belongs in
               useImpersonation.ts. */
            title="Open the customer-facing app as this user. NOT a sandbox — only messaging, applying and posting are blocked while impersonating; any other action you take here is real and is attributed to you."
          >
            <Eye className={cn("w-4 h-4 mr-1.5", toneTextClasses.warning)} /> Impersonate (RO)
          </Button>
          {/* Applications restriction — the operating half of
              `helper_shadowbans`, whose table, RLS, is_helper_shadowbanned()
              and block_shadowbanned_applications() trigger have all been live
              with zero rows because nothing could ever create one. State is
              local rather than threaded up through AdminUsers.tsx: this writes
              no column the user list renders, so it needs no refetch, and
              keeping it here avoids a third file in the prop chain. */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 justify-start"
            onClick={() => setRestrictProfile(viewProfile)}
          >
            <UserMinus className={cn("w-4 h-4 mr-1.5", toneTextClasses.warning)} /> Restrict Applications
          </Button>
          {!["permanently_banned", "temp_banned"].includes(viewBanStatus) ? (
            <Button variant="outline" size="sm" className="h-9 justify-center text-destructive border-destructive/30 hover:bg-destructive/10 col-span-1" onClick={() => setBanProfile(viewProfile)}>
              <ShieldAlert className="w-4 h-4 mr-1.5" /> Suspend / Ban
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => unbanUser(viewProfile)}>
              <CheckCircle2 className="w-4 h-4 mr-1.5 text-primary" /> Lift Ban
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 justify-center text-destructive border-destructive/30 hover:bg-destructive/10 col-span-1" onClick={() => setDeleteProfile(viewProfile)}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Delete Account
          </Button>
        </div>
      </div>

      {/* Internal Admin Notes */}
      <AdminUserNotes userId={viewProfile.user_id} />

      {/* Verification audit trail (helper_verifications table) —
          shows every change to approval_status, idv_status,
          legacy_manual_review, etc., with actor + timestamp. */}
      <UserVerificationHistory userId={viewProfile.user_id} />

      {/* Audit log — who-did-what-when for this user. Merges
          admin_audit_log, user_violations, and admin-toned
          notifications into a single chronological feed. */}
      <UserAuditLog userId={viewProfile.user_id} />

      <RestrictApplicationsDialog
        profile={restrictProfile}
        onClose={() => setRestrictProfile(null)}
      />
    </TabsContent>
  );
}
