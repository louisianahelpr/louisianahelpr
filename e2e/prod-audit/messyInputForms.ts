/**
 * FORMS the prod messy-input sweep reaches by URL (messy-input.spec.ts), and
 * the GAPS: inventory files (docs/audit/form-inventory.md) that hold no typed
 * text, with the reason each is not swept. The explore half of the spec
 * credits everything it reaches from real seeded records; the coverage test
 * fails on any inventory file with neither a credit nor a reason here.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { TEXTLIKE, type Account } from "./harness";

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

/**
 * RECOVER THE ADMIN GATE BEFORE JUDGING AN ADMIN SCREEN.
 *
 * `AdminRoute` does not render the admin view until it knows the role. When
 * the role lookup does not come back it renders a DESIGNED recovery state —
 * "We couldn't verify your access. … Tap Try again." (AdminRoute.tsx:71-98) —
 * a correct screen that happens to hold zero text-like fields. The sweep then
 * counted zero and reported "the form did not render", blaming the form for a
 * gate that never opened.
 *
 * Measured 2026-09-20 against prod: `profiles` (the read that lookup makes)
 * swung between 1s and a 25s timeout while the other lanes were driving prod,
 * and `/auth/v1/admin/generate_link` was returning 504 at the same time.
 * Holding that read locally reproduced the CI failure exactly — 0 fields on
 * `/admin?view=referrals`, with this screen on display — and pressing the
 * screen's own Try again took it back to 1.
 *
 * So press the recovery control, which is what an admin does, and only then
 * look for the form. It is a no-op on a healthy gate, and the field floor is
 * untouched: an admin view that renders no field once the gate is open still
 * fails, which is what made these eight visible in the first place.
 */
const recoverAdminGate = async (page: Page, budgetMs = 30_000) => {
  const denied = page.getByText(/couldn't verify your access/i).first();
  // `role="status"` is what both loading gates wear: AdminRoute's own
  // HelprSpinner while the role is still in flight, and RouteSuspenseFallback
  // while the lazy admin chunk loads. Returning while either is up would be
  // the same silent no-op in a different costume — the prepare would press
  // nothing and the sweep would count zero — so wait the gate out first.
  const loading = page.getByRole("status").first();
  const deadline = Date.now() + budgetMs;
  let retries = 0;
  while (Date.now() < deadline) {
    if (await denied.isVisible().catch(() => false)) {
      if (retries++ >= 3) return;
      await page.getByRole("button", { name: /^try(ing)? again/i }).first().click().catch(() => {});
      await page.waitForTimeout(2_000);
      continue;
    }
    if (!(await loading.isVisible().catch(() => false))) return;
    await page.waitForTimeout(500);
  }
};

/**
 * OPEN THE COLLAPSED SEARCH. Five surfaces (/legal, /dashboard, /messages,
 * /my-posts, /profile?tab=saved_helpers) start with no search field in the DOM
 * at all: a magnifier trigger holds its place, and pressing it mounts the
 * field (owner's ruling, 2026-09-16 — the magnifier moves inside the field and
 * the ✕ becomes its only control). A sweep that only counted the fields on
 * screen at load therefore found zero on every one of them and reported "the
 * form did not render" when nothing was broken.
 *
 * A field behind a disclosure is still a field, so the sweep opens the
 * disclosure rather than skipping the surface or lowering its floor to zero.
 * The trigger is read from the app's own marker — `[data-search-trigger]`,
 * the contract `src/test/searchDismissAndOverlay.test.tsx` pins on every one
 * of these five — not from a per-page selector guess, so a surface that grows
 * an expanding search inherits this for free and one that loses its trigger
 * fails the field floor loudly instead of silently sweeping nothing.
 */
const openSearch = async (page: Page) => {
  const trigger = page.locator("[data-search-trigger]").first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click();
  // The field mounts and animates open, so the sweep must not race it. Waited
  // for by TEXTLIKE — the sweep's OWN definition of a field — rather than a
  // per-page selector: /legal carries its own trigger and a plain text input,
  // while the ScreenHeaderRow surfaces put a type=search inside the slot, and
  // a wait that only knew one of those shapes would silently time out on the
  // other and hand the sweep a half-open field.
  await page.locator(TEXTLIKE).filter({ visible: true }).first().waitFor({ timeout: 5_000 }).catch(() => {});
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
      // TWO HARD GATES, not one field pair (SignupStep1.handleContinue): the
      // policies agreement (#policies) and the 18+ attestation (#age-confirm).
      // Continue deliberately stays ENABLED while either is unchecked — it
      // shakes the offending box instead of greying out, which is better for a
      // person and invisible to a driver that only presses it. Leaving them
      // unchecked is why step 2 never opened and every spec that starts here
      // failed with "#firstName not found" (measured 2026-09-20).
      for (const id of ["#policies", "#age-confirm"]) {
        const box = page.locator(id);
        await box.waitFor({ timeout: 10_000 });
        if ((await box.getAttribute("data-state")) !== "checked") await box.click();
        await expect(box, `${id} did not check — step 1 will not advance`).toHaveAttribute("data-state", "checked");
      }
      await page.getByRole("button", { name: /continue|next/i }).first().click();
      // Say WHICH gate held, instead of surfacing three steps later as a
      // missing #firstName.
      await expect(
        page.locator("#firstName"),
        "step 1 did not advance to step 2 — email/password accepted and both consent boxes checked, " +
          "so a new required control was added to SignupStep1",
      ).toBeVisible({ timeout: 15_000 });
    },
    covers: ["src/pages/signup/SignupStep2.tsx"],
  },
  { name: "support", url: "/support", as: null, covers: ["src/pages/Support.tsx", "src/lib/supportTopics.ts"] },
  { name: "legal-search", url: "/legal", as: null, prepare: openSearch, covers: ["src/pages/Legal.tsx"] },
  {
    // SIGNED IN, not signed out. /reset-password renders its two password
    // fields on three conditions (ResetPassword.tsx): a `#type=recovery` hash,
    // a PASSWORD_RECOVERY/SIGNED_IN auth event, or — the one a spec can reach
    // honestly — an existing session, because a signed-in user changing their
    // password is a real journey the screen serves. Signed out and with no
    // link it correctly shows "use the reset link from your email" and no
    // field, which is what the sweep was hitting.
    //
    // Why not mint a real recovery link: `generate_link` ignores a
    // `redirect_to` that is not on the project's allow-list (verified
    // 2026-09-20 — it returned the www.louisianahelpr.com action link for a
    // 127.0.0.1:4173 request), so the token cannot land on the local preview
    // this project serves. And a live recovery session here would be actively
    // dangerous: the write firewall lets `/auth/v1/user` through, so a stray
    // submit would change a SHARED test account's password out from under
    // every other lane. A plain session renders the identical form with no
    // such edge.
    name: "reset-password", url: "/reset-password", as: "poster", covers: ["src/pages/ResetPassword.tsx"],
  },
  {
    name: "post-job", url: "/post-job", as: "poster",
    prepare: async (page) => { await pressIfPresent(page, /start fresh/i); },
    covers: ["src/components/postjob/detailsSection/TitleField.tsx", "src/components/postjob/detailsSection/DescriptionField.tsx"],
  },
  { name: "dashboard-search", url: "/dashboard", as: "helper", prepare: openSearch, covers: ["src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx"] },
  { name: "messages-list", url: "/messages", as: "helper", prepare: openSearch, covers: ["src/components/messages/ConversationList.tsx"] },
  { name: "my-posts-search", url: "/my-posts", as: "poster", prepare: openSearch, covers: ["src/pages/activity/ActivityHeader.tsx"] },
  { name: "complete-profile", url: "/complete-profile", as: "incomplete", covers: ["src/pages/CompleteProfile.tsx", "src/components/postjob/CityAutocomplete.tsx"] },
  { name: "profile-edit", url: "/profile?tab=profile", as: "helper", covers: ["src/components/profile/ProfileEditForm.tsx", "src/components/profile/profileEditForm/PhotoNameSection.tsx"] },
  { name: "profile-support", url: "/profile?tab=support", as: "helper", covers: ["src/components/profile/SupportInline.tsx"] },
  { name: "gift-card", url: "/profile?tab=gift_card", as: "poster", covers: ["src/pages/GiftCard.tsx"] },
  {
    // Auto-tip opens on "Off", and the amount and cap fields only exist while
    // a mode is chosen (`mode !== "off"` in AutoTip.tsx) — correct product
    // behaviour: there is no amount to type when the feature is off. The mode
    // tiles are `role="radio"`, not buttons, so `pressIfPresent` cannot see
    // them. "Percent" is chosen over "Fixed" because it renders BOTH number
    // fields (the percent value and the dollar cap); "Fixed" renders only one.
    name: "auto-tip", url: "/profile?tab=auto_tip", as: "poster",
    prepare: async (page) => {
      await page.getByRole("radio", { name: /^percent$/i }).first().click().catch(() => {});
      await page.locator("#auto-tip-custom").waitFor({ timeout: 5_000 }).catch(() => {});
    },
    covers: ["src/pages/AutoTip.tsx"],
  },
  { name: "saved-helpers", url: "/profile?tab=saved_helpers", as: "poster", prepare: openSearch, covers: ["src/components/profile/SavedHelpersTab.tsx"] },
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
  // Every admin entry opens the gate first — see `recoverAdminGate`. The four
  // below reach their field on a healthy gate and would have reported "the
  // form did not render" on a hiccuped one, exactly as referrals did.
  { name: "admin-settings", url: "/admin?view=settings", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminSettings.tsx"] },
  { name: "admin-people", url: "/admin?view=people", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminUsers.tsx"] },
  {
    // The referrals search box is scoped to the three list tabs and hidden on
    // the "Overview" tab the view opens on (`tab !== "overview"` in
    // AdminReferrals.tsx) — Overview is a stat summary with nothing to search.
    // OPEN THE GATE, THEN WAIT FOR THE TAB, THEN PRESS IT. `pressIfPresent`
    // presses whatever is on screen at that instant and silently does nothing
    // when it is not, so neither a hiccuped admin gate nor a slow render left
    // any trace: the tab strip was not there, the press never happened, the
    // searchbox never opened, and the sweep blamed the form.
    name: "admin-referrals", url: "/admin?view=referrals", as: "admin",
    prepare: async (page) => {
      await recoverAdminGate(page);
      const codes = page.getByRole("button", { name: /^codes\b/i }).first();
      await codes.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
      if (await codes.isVisible().catch(() => false)) await codes.click();
      await page.getByRole("searchbox", { name: /search referrals/i }).waitFor({ timeout: 10_000 }).catch(() => {});
    },
    covers: ["src/components/admin/AdminReferrals.tsx"],
  },
  { name: "admin-subscriptions", url: "/admin?view=subscriptions", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminSubscriptions.tsx"] },
  { name: "admin-notiflogs", url: "/admin?view=notiflogs", as: "admin", prepare: recoverAdminGate, covers: ["src/components/admin/AdminNotificationLogs.tsx"] },
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
  // Measured on prod as the admin test account, 2026-09-20 (screenshots in
  // the lane report). These two are EMPTY QUEUES, not unreachable screens:
  // the form is real, there is simply no row in prod for it to open against,
  // and seeding one would mean manufacturing a ban or a paid-for failed
  // Stripe Identity attempt. Re-check when prod has a row.
  "src/components/admin/AdminBanReview.tsx": "empty queue on prod — /admin?view=banreview renders \"No accounts awaiting review\"; the ban-reason and dismissal-note boxes live on a pending-review row and there is none. Seeding one means putting a real consequence-ladder restriction on a shared test account",
  "src/components/admin/AdminIDVReview.tsx": "empty queue on prod — /admin?view=idvreview renders \"Nobody is waiting on a human\"; a row lands here only after Stripe CHARGED for an identity attempt and failed it, which cannot be seeded without paying Stripe for a real verification",
  // Read-only by decision, not by reachability.
  "src/components/admin/EditEmailDialog.tsx": "reachable (user detail → Edit email) but deliberately NOT swept: it rewrites an account's login address, and every shared test account is a sign-in dependency for this whole suite. One stray submit slipping the write firewall would lock every lane out of that account",
};
