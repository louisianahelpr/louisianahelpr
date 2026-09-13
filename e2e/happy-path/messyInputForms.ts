/** FORMS swept by URL (messy-input.spec.ts) and GAPS with reasons. Shared with messy-input-dialogs.spec.ts's coverage check. */
import type { Page } from "@playwright/test";
import { mockTable, type MockRule } from "./fixtures";

export type Auth = "anon" | "customer" | "admin";
export interface FormSpec {
  name: string;
  url: string;
  auth: Auth;
  rules?: MockRule[];
  /** Get from the URL to the form itself (e.g. press "Start Fresh"). */
  prepare?: (page: Page) => Promise<void>;
  /** Inventory files (docs/audit/form-inventory.md) this form exercises. */
  covers: string[];
}

const admin = [mockTable("user_roles", [{ role: "admin" }])];
const pressIfPresent = async (page: Page, name: RegExp) => {
  const b = page.getByRole("button", { name }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
};

export const FORMS: FormSpec[] = [
  { name: "login", url: "/login", auth: "anon", covers: ["src/pages/Login.tsx"] },
  { name: "forgot-password", url: "/forgot-password", auth: "anon", covers: ["src/pages/ForgotPassword.tsx"] },
  { name: "signup-step1", url: "/signup", auth: "anon", covers: ["src/pages/signup/SignupStep1.tsx"] },
  { name: "support", url: "/support", auth: "anon", covers: ["src/pages/Support.tsx", "src/lib/supportTopics.ts"] },
  { name: "legal-search", url: "/legal", auth: "anon", covers: ["src/pages/Legal.tsx"] },
  {
    name: "post-job", url: "/post-job", auth: "customer",
    prepare: async (page) => { await page.getByRole("button", { name: /start fresh/i }).click(); },
    covers: [
      "src/components/postjob/detailsSection/TitleField.tsx",
      "src/components/postjob/detailsSection/DescriptionField.tsx",
    ],
  },
  { name: "dashboard-search", url: "/dashboard", auth: "customer", covers: ["src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx"] },
  { name: "messages-list", url: "/messages", auth: "customer", covers: ["src/components/messages/ConversationList.tsx"] },
  { name: "my-posts-search", url: "/my-posts", auth: "customer", covers: ["src/pages/activity/ActivityHeader.tsx"] },
  { name: "complete-profile", url: "/complete-profile", auth: "customer", covers: ["src/pages/CompleteProfile.tsx", "src/components/postjob/CityAutocomplete.tsx"] },
  { name: "profile-edit", url: "/profile?tab=profile", auth: "customer", covers: ["src/components/profile/ProfileEditForm.tsx", "src/components/profile/profileEditForm/PhotoNameSection.tsx"] },
  { name: "profile-support", url: "/profile?tab=support", auth: "customer", covers: ["src/components/profile/SupportInline.tsx"] },
  { name: "gift-card", url: "/profile?tab=gift_card", auth: "customer", covers: ["src/pages/GiftCard.tsx"] },
  { name: "auto-tip", url: "/profile?tab=auto_tip", auth: "customer", covers: ["src/pages/AutoTip.tsx"] },
  { name: "saved-helpers", url: "/profile?tab=saved_helpers", auth: "customer", covers: ["src/components/profile/SavedHelpersTab.tsx"] },
  {
    name: "pets", url: "/profile?tab=pets", auth: "customer",
    prepare: async (page) => { await pressIfPresent(page, /add (a )?pet/i); },
    covers: ["src/pages/petProfiles/PetForm.tsx"],
  },
  {
    name: "str-settings", url: "/profile?tab=str_settings", auth: "customer",
    prepare: async (page) => { await pressIfPresent(page, /add (a )?calendar/i); },
    covers: ["src/pages/strSettings/AddCalendarForm.tsx"],
  },
  { name: "admin-settings", url: "/admin?view=settings", auth: "admin", rules: admin, covers: ["src/components/admin/AdminSettings.tsx"] },
  { name: "admin-people", url: "/admin?view=people", auth: "admin", rules: admin, covers: ["src/components/admin/AdminUsers.tsx"] },
  { name: "admin-referrals", url: "/admin?view=referrals", auth: "admin", rules: admin, covers: ["src/components/admin/AdminReferrals.tsx"] },
  { name: "admin-subscriptions", url: "/admin?view=subscriptions", auth: "admin", rules: admin, covers: ["src/components/admin/AdminSubscriptions.tsx"] },
  { name: "admin-notiflogs", url: "/admin?view=notiflogs", auth: "admin", rules: admin, covers: ["src/components/admin/AdminNotificationLogs.tsx"] },
];

export const GAPS: Record<string, string> = {
  // Scanner false positives: the regex matched a string/comment, not a rendered control.
  "src/lib/sentry.ts": "false positive — '<input' in a PII-scrubbing comment/regex, no control",
  "src/lib/nativeCamera.ts": "false positive — creates a hidden file <input> for the camera fallback; file inputs take no typed text",
  "src/lib/offerResponseWindow.ts": "false positive — option list for a Select, rendered by DirectOfferBanner",
  "src/components/admin/marketing/marketingTypes.ts": "false positive — type/constant module",
  "src/components/notificationPreferences/constants.tsx": "false positive — constants module",
  "src/components/activity/JobCardMetaRow.tsx": "false positive — displays a date, no control",
  "src/components/dashboard/JobCard.tsx": "false positive — displays a date, no control",
  // Non-text controls: no typed value to be messy. Checked by press-every-control (npm run audit:press).
  "src/components/dashboard/FilterSheet.tsx": "switch only — no typed input",
  "src/components/admin/AdminNotifications.tsx": "switches only",
  "src/components/admin/adminPayoutBatches/BatchRow.tsx": "checkbox only",
  "src/components/admin/AdminFraudDashboard.tsx": "select only",
  "src/components/admin/userDetail/JobsTab.tsx": "select only",
  "src/components/HelperAvailability.tsx": "switches only",
  "src/components/profile/AvailabilityTab.tsx": "switch only",
  "src/components/profile/earningsTab/PayoutHistory.tsx": "select only",
  "src/components/postjob/detailsSection/PhotoProofToggle.tsx": "switch only",
  "src/components/TimePickerSelect.tsx": "selects only — constrained options",
  "src/components/TimePickerWheel.tsx": "wheel picker — constrained options",
  "src/components/DatePickerField.tsx": "calendar picker — no typed date",
  "src/components/profile/ScheduleTab.tsx": "calendar only",
  "src/pages/HomeHistory.tsx": "date picker only",
  "src/pages/WorkRecord.tsx": "date picker only",
  "src/components/admin/adminJobs/JobDetailDialog.tsx": "calendar display only",
  "src/components/EarningsExport.tsx": "selects + date pickers, constrained",
  "src/pages/postjob/DirectOfferBanner.tsx": "select only",
  "src/components/admin/dashboard/DateRangeBar.tsx": "date range input, constrained by the browser",
  "src/components/TimeRangeField.tsx": "time input, constrained by the browser",
  "src/components/profile/AvatarCropDialog.tsx": "file input / zoom slider — no typed text",
  "src/components/PhotoProof.tsx": "file input only",
  "src/components/postjob/detailsSection/PhotoUpload.tsx": "file inputs only",
  "src/components/postjob/detailsSection/VideoScope.tsx": "file input only",
  "src/components/profile/profileEditForm/RecentWorkSection.tsx": "file input only",
};

/**
 * Open, unswept typed-input surfaces. Each needs a record in a specific state
 * (a job mid-dispute, an applicant, a pending ID review) plus a dialog opened
 * from it; the mocked seed does not put the UI in those states on a URL.
 * Tracked in docs/OPEN.md → Audit gaps → "messy-input: dialog-gated forms".
 */
export const DIALOG_GATED = [
  "src/components/profile/DeleteAccountDialog.tsx", "src/components/admin/AdminBanReview.tsx", "src/components/admin/AdminBroadcasts.tsx",
  "src/components/admin/AdminCredentialQueue.tsx", "src/components/admin/adminDisputes/DisputeCard.tsx", "src/components/admin/AdminExceptionQueue.tsx",
  "src/components/admin/AdminIDVReview.tsx", "src/components/admin/adminJobs/RefundJobDialog.tsx", "src/components/admin/adminJobs/RemoveJobDialog.tsx",
  "src/components/admin/adminJobs/StatusOverrideDialog.tsx", "src/components/admin/AdminMarketing.tsx", "src/components/admin/AdminPayoutBatches.tsx",
  "src/components/admin/AdminReports.tsx", "src/components/admin/AdminUserNotes.tsx", "src/components/admin/BanDialog.tsx",
  "src/components/admin/DenyUserDialog.tsx", "src/components/admin/EditEmailDialog.tsx", "src/components/admin/FormalWarningDialog.tsx",
  "src/components/admin/marketing/MarketingComposerDialog.tsx", "src/components/admin/marketing/MarketingSettingsCard.tsx",
  "src/components/admin/RestrictApplicationsDialog.tsx", "src/components/admin/ReuploadIdDialog.tsx", "src/components/admin/userDetail/UserAuditLog.tsx",
  "src/components/dashboard/applyConfirmDialog/ApplyBody.tsx", "src/components/SavedSearches.tsx", "src/components/ReportDialog.tsx",
  "src/components/messages/ChatView.tsx", "src/components/RichMessageInput.tsx", "src/components/activity/ActivityDialogs.tsx",
  "src/components/activity/appliedJobCard/ActiveJobSection.tsx", "src/components/activity/appliedJobCard/DisputedSection.tsx",
  "src/components/activity/appliedJobCard/PendingApplicationSection.tsx", "src/components/activity/AppliedJobsTab.tsx",
  "src/components/activity/CompletionChoiceSheet.tsx", "src/components/activity/EditJobDialog.tsx", "src/components/activity/postedJobs/ApplicantsPanel.tsx",
  "src/components/activity/postedJobs/DeclineApplicantSheet.tsx", "src/components/CancellationDialog.tsx", "src/components/CompletionPrompts.tsx",
  "src/components/DisputeDialog.tsx", "src/components/DisputeTimelineDialog.tsx", "src/components/feedback/NpsPrompt.tsx",
  "src/components/ResponseDeadlineDialog.tsx", "src/components/reviewPanel/ReviewForm.tsx", "src/components/W9CollectionDialog.tsx",
  "src/components/postjob/AddressAutocomplete.tsx", "src/components/postjob/AiJobBuilder.tsx", "src/components/postjob/BudgetSection.tsx",
  "src/components/postjob/CheckoutStep.tsx", "src/components/postjob/LogisticsSection.tsx", "src/components/NotificationPreferences.tsx",
  "src/components/profile/CredentialsTab.tsx", "src/components/profile/MonthlyGoalCard.tsx", "src/components/profile/savedHelpersTab/SavedHelperCard.tsx",
  "src/components/profile/SecurityTab.tsx", "src/components/profile/TwoFactorCard.tsx", "src/pages/payItForward/RecipientPicker.tsx",
  "src/pages/ResetPassword.tsx", "src/pages/signup/SignupStep2.tsx", "src/pages/userProfile/ReviewsSection.tsx", "src/components/BlockUserDialog.tsx",
];
for (const f of DIALOG_GATED) GAPS[f] ??= "dialog/state-gated — see docs/OPEN.md Audit gaps: messy-input dialog-gated forms";

