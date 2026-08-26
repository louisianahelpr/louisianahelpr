import { MailIcon, Eye, MousePointerClick } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { type Profile, isVerifiedEmail } from "../adminUserHelpers";
import { formatShortDate } from "@/lib/format";

type EmailEvent = { event_type: string; email_type: string; created_at: string };
type EmailStat = { template_name: string; count: number; last_sent: string };

interface EmailsTabProps {
  viewProfile: Profile;
  viewBanStatus: string;
  emailTracking: EmailEvent[];
  emailSendStats: EmailStat[];
  lastLoginSummary: Record<string, string>;
  resending: string | null;
  resendApprovalEmail: (profile: Profile) => void;
  resendDenialEmail: (profile: Profile) => void;
  resendVerificationEmail: (profile: Profile) => void;
}

export function EmailsTab({
  viewProfile,
  viewBanStatus,
  emailTracking,
  emailSendStats,
  lastLoginSummary,
  resending,
  resendApprovalEmail,
  resendDenialEmail,
  resendVerificationEmail,
}: EmailsTabProps) {
  const approvalOpens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
  const approvalClicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
  const verificationOpens = emailTracking.filter(t => t.email_type === 'email_verification' && t.event_type === 'open');
  const verificationClicks = emailTracking.filter(t => t.email_type === 'email_verification' && t.event_type === 'click');
  const denialOpens = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'open');
  const denialClicks = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'click');

  const hasLoggedIn = !!lastLoginSummary[viewProfile.user_id];
  const idvVerified = viewProfile.idv_status === 'verified';
  const hasStripe = !!viewProfile.stripe_account_id;
  const hasOpenedEmail = approvalOpens.length > 0 || approvalClicks.length > 0;
  const isActive = hasLoggedIn || idvVerified || hasStripe || hasOpenedEmail;
  const approvalSent = viewProfile.approval_email_count || 0;
  const approvalMaxReached = approvalSent >= 3;

  const showApprovalFollowup = viewProfile.approval_status === "approved"
    && !["permanently_banned", "temp_banned"].includes(viewBanStatus)
    && !isActive;

  return (
    <TabsContent value="emails" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Resend Verification Email */}
      {viewProfile.approval_status === "pending" && !isVerifiedEmail(viewProfile) && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => resendVerificationEmail(viewProfile)}
          disabled={resending === viewProfile.id}
        >
          <MailIcon className="w-4 h-4 mr-1" />
          {resending === viewProfile.id
            ? "Sending…"
            : `Resend Verification${(viewProfile.verification_email_count || 0) > 0 ? ` (${viewProfile.verification_email_count}/3)` : ""}`}
        </Button>
      )}
      {/* Resend Denial Email */}
      {viewProfile.approval_status === "denied" && (
        <Button variant="outline" className="w-full" onClick={() => resendDenialEmail(viewProfile)} disabled={resending === viewProfile.id}>
          <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Denial Email"}
        </Button>
      )}
      {/* Send approval follow-up (only when user hasn't shown activity yet) */}
      {showApprovalFollowup && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => resendApprovalEmail(viewProfile)}
          disabled={resending === viewProfile.id || approvalMaxReached}
          title={approvalMaxReached ? "Max 3 follow-up emails reached" : "Send a manual follow-up reminder (auto-reminders also run every 3 days)"}
        >
          <MailIcon className="w-4 h-4 mr-1" />
          {resending === viewProfile.id ? "Sending…" : `Send Approval Follow-Up (${approvalSent}/3)`}
        </Button>
      )}
      {/* Approval email tracking */}
      {viewProfile.approval_status === "approved" && (
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-3 space-y-2">
          <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
            <MailIcon className="w-3.5 h-3.5" /> Approval Email Status
          </p>
          <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
            <span>Emails sent: {viewProfile.approval_email_count || 0} / 3</span>
            {viewProfile.last_approval_email_at && (
              <span>Last sent: {formatShortDate(viewProfile.last_approval_email_at)}</span>
            )}
          </div>
          {(approvalOpens.length > 0 || approvalClicks.length > 0) ? (
            <div className="flex gap-4 pt-1">
              <span className="flex items-center gap-1 text-ds-11 text-primary">
                <Eye className="w-3 h-3" /> {approvalOpens.length} open{approvalOpens.length !== 1 ? 's' : ''}
                {approvalOpens[0] && <span className="text-muted-foreground ml-1">({formatShortDate(approvalOpens[0].created_at)})</span>}
              </span>
              <span className="flex items-center gap-1 text-ds-11 text-primary">
                <MousePointerClick className="w-3 h-3" /> {approvalClicks.length} click{approvalClicks.length !== 1 ? 's' : ''}
                {approvalClicks[0] && <span className="text-muted-foreground ml-1">({formatShortDate(approvalClicks[0].created_at)})</span>}
              </span>
            </div>
          ) : (
            <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
          )}
        </div>
      )}

      {/* Verification email tracking — for unverified pending users */}
      {viewProfile.approval_status === "pending" && !isVerifiedEmail(viewProfile) && (
        <div className="rounded-2xl bg-accent/5 border border-accent/20 p-3 space-y-2">
          <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
            <MailIcon className="w-3.5 h-3.5" /> Verification Email Status
          </p>
          <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
            <span>Emails sent: {viewProfile.verification_email_count || 0} / 3</span>
            {viewProfile.last_verification_email_at && (
              <span>Last sent: {formatDistanceToNow(new Date(viewProfile.last_verification_email_at), { addSuffix: true })}</span>
            )}
          </div>
          {(verificationOpens.length > 0 || verificationClicks.length > 0) ? (
            <div className="flex gap-4 pt-1">
              <span className="flex items-center gap-1 text-ds-11 text-accent">
                <Eye className="w-3 h-3" /> {verificationOpens.length} open{verificationOpens.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1 text-ds-11 text-accent">
                <MousePointerClick className="w-3 h-3" /> {verificationClicks.length} click{verificationClicks.length !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
          )}
        </div>
      )}

      {/* Denial email tracking */}
      {viewProfile.approval_status === "denied" && (
        <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-3 space-y-2">
          <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
            <MailIcon className="w-3.5 h-3.5" /> Denial Email Status
          </p>
          <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
            <span>Emails sent: {viewProfile.denial_email_count || 0} / 3</span>
            {viewProfile.last_denial_email_at && (
              <span>Last sent: {formatShortDate(viewProfile.last_denial_email_at)}</span>
            )}
          </div>
          {viewProfile.denial_reason && (
            <p className="text-ds-11 text-muted-foreground">Reason: {viewProfile.denial_reason}</p>
          )}
          {(denialOpens.length > 0 || denialClicks.length > 0) ? (
            <div className="flex gap-4 pt-1">
              <span className="flex items-center gap-1 text-ds-11 text-destructive">
                <Eye className="w-3 h-3" /> {denialOpens.length} open{denialOpens.length !== 1 ? 's' : ''}
                {denialOpens[0] && <span className="text-muted-foreground ml-1">({formatShortDate(denialOpens[0].created_at)})</span>}
              </span>
              <span className="flex items-center gap-1 text-ds-11 text-destructive">
                <MousePointerClick className="w-3 h-3" /> {denialClicks.length} click{denialClicks.length !== 1 ? 's' : ''}
                {denialClicks[0] && <span className="text-muted-foreground ml-1">({formatShortDate(denialClicks[0].created_at)})</span>}
              </span>
            </div>
          ) : (
            <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
          )}
        </div>
      )}

      {/* Email Send History */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <MailIcon className="w-4 h-4" /> Emails Sent
          {emailSendStats.length > 0 && (
            <Badge variant="sienna" className="ml-1 text-ds-10">
              {emailSendStats.reduce((sum, s) => sum + s.count, 0)} total
            </Badge>
          )}
        </h4>
        {emailSendStats.length === 0 ? (
          <p className="text-ds-11 text-muted-foreground italic">No emails on record</p>
        ) : (
          <div className="rounded-ds-md border border-border bg-secondary/30 divide-y divide-border overflow-hidden">
            {emailSendStats.map((s) => (
              <div key={s.template_name} className="flex items-center justify-between gap-3 p-3 text-ds-13">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate capitalize">
                    {s.template_name.replace(/[-_]/g, " ")}
                  </p>
                  <p className="text-ds-11 text-muted-foreground">
                    Last sent {formatDistanceToNow(new Date(s.last_sent), { addSuffix: true })}
                  </p>
                </div>
                <Badge variant="outline" className="font-semibold shrink-0">
                  ×{s.count}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
}
