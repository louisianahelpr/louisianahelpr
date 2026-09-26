/**
 * The admin "User Profile" detail dialog — a 6-tab modal (Actions,
 * Overview, Jobs, Reviews, Docs, Emails) shown when a user is opened
 * from the admin Users screen.
 *
 * This shell wires the parent's props through to one component per tab
 * (see `userDetail/`). The Jobs-tab-local `jobsRole`/`jobsSort` filter
 * state lives in JobsTab. `viewBanStatus` is re-derived here and passed
 * to the two tabs that need it (Actions, Emails).
 */
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Profile } from "./adminUserHelpers";
import type { AdminProfileJob, AdminProfileViolation } from "./adminusers/useOpenProfile";
import { DetailHeader } from "./userDetail/DetailHeader";
import { OverviewTab } from "./userDetail/OverviewTab";
import { JobsTab } from "./userDetail/JobsTab";
import { ReviewsTab } from "./userDetail/ReviewsTab";
import { DocumentsTab } from "./userDetail/DocumentsTab";
import { EmailsTab } from "./userDetail/EmailsTab";
import { ActionsTab } from "./userDetail/ActionsTab";

interface AdminUserDetailDialogProps {
  /** Profile being viewed — the dialog is open iff this is non-null. */
  viewProfile: Profile | null;
  setViewProfile: (profile: Profile | null) => void;
  /** Supplemental detail the parent loads when a profile is opened. */
  profileReviews: { rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string; counts_toward_rating?: boolean }[];
  profileReviewsLeft: { rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[];
  profileViolations: AdminProfileViolation[];
  profileJobs: AdminProfileJob[];
  emailTracking: { event_type: string; email_type: string; created_at: string }[];
  emailSendStats: { template_name: string; count: number; last_sent: string }[];
  /** Per-user last-login map — tells whether an approved user is active yet. */
  lastLoginSummary: Record<string, string>;
  /** Profile id currently mid-resend, or null — drives the email spinners. */
  resending: string | null;
  /** Account lifecycle + support actions, all owned by the parent. */
  resendVerificationEmail: (profile: Profile) => void;
  unbanUser: (profile: Profile) => void;
  viewHistoryFor: (profile: Profile) => void;
  /** Sub-dialog openers — set the target profile for each per-action dialog. */
  setEditEmailProfile: (profile: Profile | null) => void;
  setBanProfile: (profile: Profile | null) => void;
  setDeleteProfile: (profile: Profile | null) => void;
  setManualVerifyProfile: (profile: Profile | null) => void;
  setWarningProfile: (profile: Profile | null) => void;
  setResetPwProfile: (profile: Profile | null) => void;
}

export function AdminUserDetailDialog({
  viewProfile,
  setViewProfile,
  profileReviews,
  profileReviewsLeft,
  profileViolations,
  profileJobs,
  emailTracking,
  emailSendStats,
  lastLoginSummary,
  resending,
  resendVerificationEmail,
  unbanUser,
  viewHistoryFor,
  setEditEmailProfile,
  setBanProfile,
  setDeleteProfile,
  setManualVerifyProfile,
  setWarningProfile,
  setResetPwProfile,
}: AdminUserDetailDialogProps) {
  const viewBanStatus = viewProfile?.ban_status || "active";

  return (
    <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
      {/* Only the STRUCTURAL parts of this override remain — the fixed height
          and the internal column that let a long admin record scroll inside
          the card. The three cosmetic ones are gone:
          `w-[calc(100vw-1rem)]` narrowed the phone inset to 8px a side while
          every other dialog sits at 16px, `max-w-2xl` made it the only dialog
          wider than the shared `max-w-lg` outside the two documented
          structural exceptions, and `p-3` shaved the phone padding from the
          shared 16px to 12px. */}
      <DialogContent className="h-[90vh] overflow-hidden flex flex-col gap-0">
        {/* LAYOUT goes on a wrapper, never on the Hero. The Hero owns the
            header's type and alignment and takes no className at all — that
            escape hatch is what let three dialogs centre a title the other
            ~147 left-aligned. */}
        <div className="pb-2 mb-2 border-b border-border flex-shrink-0">
          <DialogHero title="User Profile" />
        </div>
        {viewProfile && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0 break-words gap-3">
            <DetailHeader
              viewProfile={viewProfile}
              setEditEmailProfile={setEditEmailProfile}
            />

            <Tabs defaultValue="actions" className="w-full flex flex-col flex-1 min-h-0">
              {/* Scroll strip below `sm`, six equal cells from `sm` up. Six
                  fixed cells at 375 are 50px each, and "Overview" / "Reviews"
                  at text-ds-10 are wider than that — the selected pill sat
                  visibly narrower than its own label and the labels ran into
                  each other (eyeballed 2026-09-07). */}
              <TabsList className="flex w-full justify-start overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] sm:[mask-image:none] sm:grid sm:grid-cols-6 flex-shrink-0">
                <TabsTrigger value="actions" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Actions</TabsTrigger>
                <TabsTrigger value="overview" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Overview</TabsTrigger>
                <TabsTrigger value="jobs" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Jobs</TabsTrigger>
                <TabsTrigger value="reviews" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Reviews</TabsTrigger>
                <TabsTrigger value="documents" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Docs</TabsTrigger>
                <TabsTrigger value="emails" className="shrink-0 text-ds-11 sm:text-ds-13 px-2.5 sm:px-1">Emails</TabsTrigger>
              </TabsList>

              <OverviewTab viewProfile={viewProfile} profileViolations={profileViolations} />
              <JobsTab viewProfile={viewProfile} profileJobs={profileJobs} />
              <ReviewsTab profileReviews={profileReviews} profileReviewsLeft={profileReviewsLeft} />
              <DocumentsTab viewProfile={viewProfile} />
              <EmailsTab
                viewProfile={viewProfile}
                emailTracking={emailTracking}
                emailSendStats={emailSendStats}
                resending={resending}
                resendVerificationEmail={resendVerificationEmail}
              />
              <ActionsTab
                viewProfile={viewProfile}
                viewBanStatus={viewBanStatus}
                lastLoginSummary={lastLoginSummary}
                unbanUser={unbanUser}
                viewHistoryFor={viewHistoryFor}
                setBanProfile={setBanProfile}
                setDeleteProfile={setDeleteProfile}
                setManualVerifyProfile={setManualVerifyProfile}
                setWarningProfile={setWarningProfile}
                setResetPwProfile={setResetPwProfile}
              />
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
