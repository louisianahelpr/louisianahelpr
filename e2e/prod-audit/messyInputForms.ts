/**
 * FORMS the prod messy-input sweep reaches by URL (messy-input.spec.ts), and
 * the GAPS: inventory files (docs/audit/form-inventory.md) that hold no typed
 * text, with the reason each is not swept. The explore half of the spec
 * credits everything it reaches from real seeded records; the coverage test
 * fails on any inventory file with neither a credit nor a reason here.
 */
import type { Page } from "@playwright/test";
import type { Account } from "./harness";

export interface FormSpec {
  name: string;
  url: string;
  /** null = signed out */
  as: Account | null;
  /** Get from the URL to the form itself (e.g. press "Start Fresh"). */
  prepare?: (page: Page) => Promise<void>;
  /** Inventory files this form exercises. */
  covers: string[];
}

const pressIfPresent = async (page: Page, name: RegExp) => {
  const b = page.getByRole("button", { name }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
};

export const FORMS: FormSpec[] = [
  { name: "login", url: "/login", as: null, covers: ["src/pages/Login.tsx"] },
  { name: "forgot-password", url: "/forgot-password", as: null, covers: ["src/pages/ForgotPassword.tsx"] },
  { name: "signup-step1", url: "/signup", as: null, covers: ["src/pages/signup/SignupStep1.tsx"] },
  {
    name: "signup-step2", url: "/signup", as: null,
    prepare: async (page) => {
      // Step 2 is gated on a well-formed step 1; nothing is sent until the final step.
      await page.locator("#email").fill("messy.prodaudit@example.com");
      await page.locator("#password").fill("Sturdy-passw0rd-123");
      await page.getByRole("button", { name: /continue|next/i }).first().click();
      await page.locator("#firstName").waitFor({ timeout: 10_000 }).catch(() => {});
    },
    covers: ["src/pages/signup/SignupStep2.tsx"],
  },
  { name: "support", url: "/support", as: null, covers: ["src/pages/Support.tsx", "src/lib/supportTopics.ts"] },
  { name: "legal-search", url: "/legal", as: null, covers: ["src/pages/Legal.tsx"] },
  { name: "reset-password", url: "/reset-password", as: null, covers: ["src/pages/ResetPassword.tsx"] },
  {
    name: "post-job", url: "/post-job", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /start fresh/i); },
    covers: ["src/components/postjob/detailsSection/TitleField.tsx", "src/components/postjob/detailsSection/DescriptionField.tsx"],
  },
  { name: "dashboard-search", url: "/dashboard", as: "helper", covers: ["src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx"] },
  { name: "messages-list", url: "/messages", as: "helper", covers: ["src/components/messages/ConversationList.tsx"] },
  { name: "my-posts-search", url: "/my-posts", as: "poster", covers: ["src/pages/activity/ActivityHeader.tsx"] },
  { name: "complete-profile", url: "/complete-profile", as: "incomplete", covers: ["src/pages/CompleteProfile.tsx", "src/components/postjob/CityAutocomplete.tsx"] },
  { name: "profile-edit", url: "/profile?tab=profile", as: "helper", covers: ["src/components/profile/ProfileEditForm.tsx", "src/components/profile/profileEditForm/PhotoNameSection.tsx"] },
  { name: "profile-support", url: "/profile?tab=support", as: "helper", covers: ["src/components/profile/SupportInline.tsx"] },
  { name: "gift-card", url: "/profile?tab=gift_card", as: "poster", covers: ["src/pages/GiftCard.tsx"] },
  { name: "auto-tip", url: "/profile?tab=auto_tip", as: "poster", covers: ["src/pages/AutoTip.tsx"] },
  { name: "saved-helpers", url: "/profile?tab=saved_helpers", as: "poster", covers: ["src/components/profile/SavedHelpersTab.tsx"] },
  {
    name: "pets", url: "/profile?tab=pets", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a |another )?pet/i); },
    covers: ["src/pages/petProfiles/PetForm.tsx"],
  },
  {
    name: "str-settings", url: "/profile?tab=str_settings", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /add (a )?calendar/i); },
    covers: ["src/pages/strSettings/AddCalendarForm.tsx"],
  },
  { name: "admin-settings", url: "/admin?view=settings", as: "admin", covers: ["src/components/admin/AdminSettings.tsx"] },
  { name: "admin-people", url: "/admin?view=people", as: "admin", covers: ["src/components/admin/AdminUsers.tsx"] },
  { name: "admin-referrals", url: "/admin?view=referrals", as: "admin", covers: ["src/components/admin/AdminReferrals.tsx"] },
  { name: "admin-subscriptions", url: "/admin?view=subscriptions", as: "admin", covers: ["src/components/admin/AdminSubscriptions.tsx"] },
  { name: "admin-notiflogs", url: "/admin?view=notiflogs", as: "admin", covers: ["src/components/admin/AdminNotificationLogs.tsx"] },
];

/** Inventory files with no typed text (or scanner false positives), each with its reason. */
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
  "src/components/DatePickerField.tsx": "calendar/wheel picker — no typed date (DOB bound asserted in the targeted tests)",
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
  "src/components/NotificationPreferences.tsx": "switches only",
  "src/components/profile/TwoFactorCard.tsx": "6-digit code field appears only after a real authenticator enrolment; not swept on the shared accounts (would enrol 2FA on them)",
  "src/components/W9CollectionDialog.tsx": "opens only when a helper crosses the $600 tax threshold in the current year; no seed state (real money)",
  "src/components/feedback/NpsPrompt.tsx": "appears on a 30-day cadence after a completed job; not reachable on demand",
  "src/components/ResponseDeadlineDialog.tsx": "select only (response window)",
  "src/components/CompletionPrompts.tsx": "yes/no prompts, no typed text",
  "src/components/activity/CompletionChoiceSheet.tsx": "choice sheet, no typed text",
  // Admin queues that only real events fill (prod-seed.mjs 'Not produced, by design').
  "src/components/admin/AdminExceptionQueue.tsx": "verification_exceptions queue — no seed row (prod-seed: admin work queue, no honest seed value)",
  "src/components/admin/AdminPayoutBatches.tsx": "payout batches — real Stripe transfers only; no seed batch",
};
