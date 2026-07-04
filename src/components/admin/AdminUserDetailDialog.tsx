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
  profileReviews: { rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[];
  profileReviewsLeft: { rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[];
  profileViolations: any[];
  profileJobs: any[];
  idDocSignedUrl: string | null;
  emailTracking: { event_type: string; email_type: string; created_at: string }[];
  emailSendStats: { template_name: string; count: number; last_sent: string }[];
  /** Per-user last-login map — tells whether an approved user is active yet. */
  lastLoginSummary: Record<string, string>;
  /** Profile id currently mid-resend, or null — drives the email spinners. */
  resending: string | null;
  /** Reloads the parent's profile list after an inline status change. */
  loadProfiles: () => void;
  /** Account lifecycle + support actions, all owned by the parent. */
  approveUser: (profile: Profile) => void;
  resendApprovalEmail: (profile: Profile) => void;
  resendDenialEmail: (profile: Profile) => void;
  resendVerificationEmail: (profile: Profile) => void;
  unbanUser: (profile: Profile) => void;
  viewHistoryFor: (profile: Profile) => void;
  /** Sub-dialog openers — set the target profile for each per-action dialog. */
  setEditEmailProfile: (profile: Profile | null) => void;
  setDenyProfile: (profile: Profile | null) => void;
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
  idDocSignedUrl,
  emailTracking,
  emailSendStats,
  lastLoginSummary,
  resending,
  loadProfiles,
  approveUser,
  resendApprovalEmail,
  resendDenialEmail,
  resendVerificationEmail,
  unbanUser,
  viewHistoryFor,
  setEditEmailProfile,
  setDenyProfile,
  setBanProfile,
  setDeleteProfile,
  setManualVerifyProfile,
  setWarningProfile,
  setResetPwProfile,
}: AdminUserDetailDialogProps) {
  const viewBanStatus = viewProfile?.ban_status || "active";

  return (
    <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl h-[90vh] overflow-hidden p-3 sm:p-5 flex flex-col gap-0">
        <DialogHero
          className="pb-2 mb-2 border-b border-border flex-shrink-0"
          eyebrow="Admin"
          title="User Profile"
        />
        {viewProfile && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0 break-words gap-3">
            <DetailHeader
              viewProfile={viewProfile}
              setViewProfile={setViewProfile}
              resending={resending}
              loadProfiles={loadProfiles}
              resendDenialEmail={resendDenialEmail}
              setEditEmailProfile={setEditEmailProfile}
            />

            <Tabs defaultValue="actions" className="w-full flex flex-col flex-1 min-h-0">
              <TabsList className="grid grid-cols-6 w-full flex-shrink-0">
                <TabsTrigger value="actions" className="text-ds-10 sm:text-ds-13 px-1">Actions</TabsTrigger>
                <TabsTrigger value="overview" className="text-ds-10 sm:text-ds-13 px-1">Overview</TabsTrigger>
                <TabsTrigger value="jobs" className="text-ds-10 sm:text-ds-13 px-1">Jobs</TabsTrigger>
                <TabsTrigger value="reviews" className="text-ds-10 sm:text-ds-13 px-1">Reviews</TabsTrigger>
                <TabsTrigger value="documents" className="text-ds-10 sm:text-ds-13 px-1">Docs</TabsTrigger>
                <TabsTrigger value="emails" className="text-ds-10 sm:text-ds-13 px-1">Emails</TabsTrigger>
              </TabsList>

              <OverviewTab viewProfile={viewProfile} profileViolations={profileViolations} />
              <JobsTab viewProfile={viewProfile} profileJobs={profileJobs} />
              <ReviewsTab profileReviews={profileReviews} profileReviewsLeft={profileReviewsLeft} />
              <DocumentsTab viewProfile={viewProfile} idDocSignedUrl={idDocSignedUrl} />
              <EmailsTab
                viewProfile={viewProfile}
                viewBanStatus={viewBanStatus}
                emailTracking={emailTracking}
                emailSendStats={emailSendStats}
                lastLoginSummary={lastLoginSummary}
                resending={resending}
                resendApprovalEmail={resendApprovalEmail}
                resendDenialEmail={resendDenialEmail}
                resendVerificationEmail={resendVerificationEmail}
              />
              <ActionsTab
                viewProfile={viewProfile}
                viewBanStatus={viewBanStatus}
                emailTracking={emailTracking}
                lastLoginSummary={lastLoginSummary}
                approveUser={approveUser}
                unbanUser={unbanUser}
                viewHistoryFor={viewHistoryFor}
                setDenyProfile={setDenyProfile}
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
