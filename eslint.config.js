import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";


/* ── Type-scale guards ──────────────────────────────────────────────────
   Two spellings of one rule. Banning only the first is why B1 "closed" and
   then regrew: `text-[13px]` dropped to five legitimate hero sizes, while
   379 inline `style={{ fontSize }}` declarations accumulated in a shape the
   selector could not see.

   px and rem need separate bounds — 1rem is 16px, so a single numeric range
   would wrongly ban the hero's 3.5rem (56px, above the ceiling).
     px  : 1–40      → banned (the scale covers 9–40)
     rem : 0–2.99    → banned (≈ up to 47px; the hero starts at 3.5rem)   */
const DS_TYPE_CLASS_RULE = {
  selector:
    "Literal[value=/text-\\[(?:(?:[1-9]|[1-3][0-9]|40)(?:\\.[0-9]+)?px|[0-2](?:\\.[0-9]+)?rem)\\]/]",
  message:
    "Use a ds-* type token (ds-9 … ds-40) instead of an arbitrary text-[…] size. " +
    "Arbitrary sizes carry no line-height and break vertical rhythm. " +
    "Sizes above 40px (the hero ramp) and colour values like text-[hsl(var(--x))] are fine.",
};

const DS_TYPE_INLINE_RULE = {
  selector:
    "Property[key.name='fontSize'] > Literal[value=/^(?:(?:[1-9]|[1-3][0-9]|40)(?:\\.[0-9]+)?px|[0-2](?:\\.[0-9]+)?rem)$/]",
  message:
    "Use a ds-* type token (ds-9 … ds-40) via className instead of an inline fontSize. " +
    "Inline sizes carry no line-height and break vertical rhythm — the same reason " +
    "arbitrary text-[…] classes are banned above.",
};

/* Files that already carry inline fontSize, exempt from the INLINE rule only —
   the class rule still applies to them. This list is a debt ledger, not a
   permanent allowance: every file migrated to ds-* tokens should be deleted
   from it, and it should only ever get shorter. New files are not exempt. */
const DS_TYPE_INLINE_LEGACY = [
  "src/components/BirthdayPopup.tsx",
  "src/components/BrowseMap.tsx",
  "src/components/BuildStamp.tsx",
  "src/components/CancellationDialog.tsx",
  "src/components/DesktopSidebarNav.tsx",
  "src/components/DisputeDialog.tsx",
  "src/components/DisputeTimelineDialog.tsx",
  "src/components/ErrorBoundary.tsx",
  "src/components/HelperAvailability.tsx",
  "src/components/IDVPromptDialog.tsx",
  "src/components/InstantPayoutDialog.tsx",
  "src/components/JobBoostDialog.tsx",
  "src/components/JobConfirmation.tsx",
  "src/components/MessageAttachment.tsx",
  "src/components/Navbar.tsx",
  "src/components/NotificationPanel.tsx",
  "src/components/NotificationPreferences.tsx",
  "src/components/OnboardingTour.tsx",
  "src/components/PaymentTab.tsx",
  "src/components/PayoutSetupForm.tsx",
  "src/components/PhotoProof.tsx",
  "src/components/ProUpgradeSheet.tsx",
  "src/components/ReferralSection.tsx",
  "src/components/TipDialog.tsx",
  "src/components/activity/AppliedJobsTab.tsx",
  "src/components/activity/CompletionChoiceSheet.tsx",
  "src/components/activity/EditJobDialog.tsx",
  "src/components/activity/HelperRevisionCard.tsx",
  "src/components/activity/appliedJobCard/ActiveJobSection.tsx",
  "src/components/activity/appliedJobCard/DisputedSection.tsx",
  "src/components/activity/appliedJobCard/OfferedActions.tsx",
  "src/components/activity/postedJobCard/PostedJobActions.tsx",
  "src/components/activity/postedJobCard/PostedJobApplicants.tsx",
  "src/components/activity/postedJobs/ApplicantsPanel.tsx",
  "src/components/activity/postedJobs/DeclineApplicantSheet.tsx",
  "src/components/activity/postedJobs/applicantsPanel/ApplicantsStates.tsx",
  "src/components/admin/AdminAnalyticsCharts.tsx",
  "src/components/admin/AdminSidebar.tsx",
  "src/components/admin/dashboard/TaxReserveCard.tsx",
  "src/components/auth/AuthShell.tsx",
  "src/components/business/SpendDashboardTab.tsx",
  "src/components/dashboard/ApplyConfirmDialog.tsx",
  "src/components/dashboard/BrowseTasksToolbar.tsx",
  "src/components/dashboard/CompactJobCard.tsx",
  "src/components/dashboard/DashboardInProgressBadge.tsx",
  "src/components/dashboard/DashboardStatusBanners.tsx",
  "src/components/dashboard/JobCard.tsx",
  "src/components/dashboard/JobPrice.tsx",
  "src/components/dashboard/WelcomeModal.tsx",
  "src/components/dashboard/YourHelpersRow.tsx",
  "src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx",
  "src/components/dashboard/jobDetailDialog/ApplicantQueueBanner.tsx",
  "src/components/jobs/WhatToBringChecklist.tsx",
  "src/components/landing/HeroSection.tsx",
  "src/components/messages/ChatHeader.tsx",
  "src/components/messages/ConversationList.tsx",
  "src/components/messages/chatView/ChatTimeline.tsx",
  "src/components/payment/EscrowFlowExplainer.tsx",
  "src/components/postjob/AiJobBuilder.tsx",
  "src/components/postjob/CurrentLocationPill.tsx",
  "src/components/postjob/PostingQualityMeter.tsx",
  "src/components/postjob/SectionCard.tsx",
  "src/components/postjob/detailsSection/CategoryPicker.tsx",
  "src/components/postjob/detailsSection/CredentialTierSelector.tsx",
  "src/components/profile/CredentialsTab.tsx",
  "src/components/profile/EarningsBreakdownCharts.tsx",
  "src/components/profile/EarningsForecastCard.tsx",
  "src/components/profile/EarningsTab.tsx",
  "src/components/profile/HelperScheduleStrip.tsx",
  "src/components/profile/HelperTierBadge.tsx",
  "src/components/profile/JobListTab.tsx",
  "src/components/profile/MonthlyGoalCard.tsx",
  "src/components/profile/ProfileEditForm.tsx",
  "src/components/profile/ProfileStatsTrend.tsx",
  "src/components/profile/ReferralExtras.tsx",
  "src/components/profile/ReviewsTab.tsx",
  "src/components/profile/ScheduleTab.tsx",
  "src/components/profile/SecurityTab.tsx",
  "src/components/profile/SkillEndorsements.tsx",
  "src/components/profile/SkillsManager.tsx",
  "src/components/profile/SubscriptionTab.tsx",
  "src/components/profile/SupportInline.tsx",
  "src/components/profile/TwoFactorCard.tsx",
  "src/components/profile/WarningsTab.tsx",
  "src/components/profile/earningsTab/EarningHistory.tsx",
  "src/components/profile/earningsTab/PayoutHistory.tsx",
  "src/components/profile/earningsTab/RecentTransfers.tsx",
  "src/components/profile/earningsTab/ThresholdBanner.tsx",
  "src/components/profile/earningsTab/WalletCard.tsx",
  "src/components/profile/profileEditForm/PhotoNameSection.tsx",
  "src/components/profile/profileEditForm/RecentWorkSection.tsx",
  "src/components/profile/savedHelpersTab/SavedHelperCard.tsx",
  "src/components/profile/subscriptionTab/CancelSurveyDialog.tsx",
  "src/components/profile/subscriptionTab/PauseOfferDialog.tsx",
  "src/components/reviewPanel/ReviewForm.tsx",
  "src/components/reviewPanel/StarRow.tsx",
  "src/components/wallet/PayoutCelebration.tsx",
  "src/lib/accessibility.test.tsx",
  "src/pages/AccountPending.tsx",
  "src/pages/Activity.tsx",
  "src/pages/ForBusiness.tsx",
  "src/pages/HelperAnalytics.tsx",
  "src/pages/Login.tsx",
  "src/pages/NotFound.tsx",
  "src/pages/ResetPassword.tsx",
  "src/pages/Signup.tsx",
  "src/pages/StrSettings.tsx",
  "src/pages/SubscriptionPage.tsx",
  "src/pages/activity/ActivitySectionedView.tsx",
  "src/pages/helperAnalytics/HeroSummary.tsx",
  "src/pages/helperAnalytics/MonthlyGoalCard.tsx",
  "src/pages/helperAnalytics/OnTimeArrivalCard.tsx",
  "src/pages/helperAnalytics/ProfileViewsCard.tsx",
  "src/pages/helperAnalytics/RatingsReviewsCard.tsx",
  "src/pages/helperAnalytics/RepeatHireCard.tsx",
  "src/pages/helperAnalytics/SuccessRateCard.tsx",
  "src/pages/legal/PrivacySection.tsx",
  "src/pages/messages/MessagesEmptyThread.tsx",
  "src/pages/messages/MessagesTitleCard.tsx",
  "src/pages/payItForward/CreditCard.tsx",
  "src/pages/postjob/CheckoutStepIndicator.tsx",
  "src/pages/postjob/DraftSavedIndicator.tsx",
  "src/pages/postjob/EntryChoice.tsx",
  "src/pages/postjob/FormStep.tsx",
  "src/pages/strSettings/AddCalendarForm.tsx",
  "src/pages/strSettings/ConnectionCard.tsx",
  "src/pages/strSettings/EmptyConnections.tsx",
  "src/pages/userProfile/ProfileHeaderCard.tsx",
];

export default tseslint.config(
  // `.claude/**` excludes agent worktree copies under `.claude/worktrees/` —
  // without this, `eslint .` lints a duplicate of the whole codebase per
  // worktree (slow) and reports `supabase/functions` errors the top-level
  // ignore can't match through the nested path.
  // `.remember/**` excludes the remember plugin's per-machine working dir
  // (session buffer, daily notes, .remember/tmp/last-ndc.ts) — eslint v9
  // flat config doesn't auto-honor .gitignore, so the dir needs an
  // explicit ignore here or local lint fails on plugin scratch.
  // `ios/**` excludes Xcode build products (build_sim/, DerivedData/) whose
  // bundled Capacitor native-bridge.js otherwise reds `eslint .` locally.
  // `src/test/edge/*.gen.ts` are gitignored scratch files written by the
  // edge-function test harness (see src/test/edge/harness.ts). Leftovers from a
  // prior run were adding 176 phantom typecheck errors and 28 lint warnings to
  // the local gate — the gate CLAUDE.md treats as load-bearing — training us to
  // ignore it. Excluded here and in tsconfig.app.json so the gate stays honest.
  { ignores: ["dist", "build", "**/build/**", "ios/**", ".claude/**", ".remember/**", "supabase/functions/**", "src/test/edge/**/*.gen.ts", "playwright-fixture.ts", "playwright.config.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Disabled: we intentionally co-locate small helpers, types, and
      // constants with their owning component (shadcn/ui pattern + our own
      // HelperBadges/OnboardingTour/TimePickerSelect/JobFilters). HMR still
      // works fine for component edits; this rule only affects refresh
      // granularity, not correctness.
      "react-refresh/only-export-components": "off",
      // `any` is used pervasively for Supabase row types and `catch (err: any)`
      // patterns — both are conventional and safe here. Disabling rather than
      // bulk-rewriting hundreds of call sites.
      "@typescript-eslint/no-explicit-any": "off",
      // Many useEffect deps are intentionally omitted (one-shot mounts, refs
      // that should not retrigger). Disabling to remove false-positive noise;
      // genuine stale-closure bugs are caught in code review.
      "react-hooks/exhaustive-deps": "off",
      // eslint-plugin-react-hooks v7 added several new rules (set-state-in-effect,
      // refs, purity, immutability, static-components, etc.) that flag 163
      // pre-existing patterns written under v5. These are intentional React
      // patterns in this codebase; disabling the new rule-set rather than
      // bulk-refactoring ~163 existing call sites.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/globals": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // tailwind.config.ts uses CommonJS require() for the plugin —
      // standard Tailwind pattern, not worth rewriting.
      "@typescript-eslint/no-require-imports": "off",
      // Empty catch{} blocks and marker interfaces are intentional patterns
      // in this codebase (silent fallbacks, type aliases). Downgrade to warn.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-object-type": "warn",

      // ── Type scale guardrail ────────────────────────────────────────────
      // tailwind.config.ts defines an 18-step scale (ds-9 … ds-40), each rung
      // carrying a tuned line-height (1.45 in the body range) and letter
      // spacing. Arbitrary `text-[13px]` / `text-[0.78rem]` values carry NO
      // line-height, so they silently inherit Tailwind's default and break
      // vertical rhythm inside a card — the "unfinished but unnameable" look.
      //
      // 220 such values had accumulated across 106 files (28 distinct sizes
      // layered over an 18-step system, several differing by a third of a
      // pixel). They were mapped onto the scale on 2026-08-10; this rule stops
      // them coming back.
      //
      // Deliberately NUMERIC-only: `text-[hsl(var(--token))]` is the required
      // way to set brand colours here and must stay legal. Sizes above the
      // scale's 40px ceiling are also allowed — the marketing hero ramp
      // (3.5rem…7.25rem) genuinely has no rung.
      "no-restricted-syntax": ["error", DS_TYPE_CLASS_RULE, DS_TYPE_INLINE_RULE],

    },
  },
  {
    files: DS_TYPE_INLINE_LEGACY,
    rules: {
      // Class rule still enforced here; only the inline one is grandfathered.
      "no-restricted-syntax": ["error", DS_TYPE_CLASS_RULE],
    },
  },
);
