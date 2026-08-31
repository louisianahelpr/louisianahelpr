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
// `window.location.*` must never be handed to anything OFF this device.
//
// Inside the shipped iOS/Android build the page origin is
// `capacitor://localhost`, which is not a URL anyone else can resolve. Stripe
// rejects it outright (`url_invalid` → the edge function 500s, which is how
// Connect onboarding was silently dead on iOS), an email client cannot open it,
// and an invite link built from it is useless to the person you send it to.
//
// Use getPublicReturnUrl() (come back to this page) or getPublicOrigin()
// (canonical origin) from @/lib/authRedirects — both keep the real origin on
// web so preview deploys still return to themselves.
//
// Deliberately narrow: this flags the shapes where the value ESCAPES — stored
// in a variable, interpolated into a URL string, or passed as an object
// property (return_url:, emailRedirectTo:, url:). It does NOT flag local
// inspection like `new URL(path, window.location.origin)` or attaching the
// current href to an error report, which never leave the device, and it does
// NOT flag `window.location.href = "/login"`, which is ordinary navigation.
const LOCATION_MEMBER =
  ':matches(' +
  'MemberExpression[property.name=/^(href|origin)$/][object.property.name="location"],' +
  'MemberExpression[property.name=/^(href|origin)$/][object.name="location"]' +
  ')';

const LOCATION_LEAK_MESSAGE =
  "Don't hand window.location.href/origin to anything that leaves this device — " +
  "in the native build it is `capacitor://localhost`, which Stripe rejects and " +
  "no email client or recipient can open. Use getPublicReturnUrl() or " +
  "getPublicOrigin() from @/lib/authRedirects. " +
  "(Local-only use, e.g. `new URL(p, window.location.origin)`, is fine — " +
  "disable this line with a comment saying why it stays on-device.)";

const NATIVE_ORIGIN_RULES = [
  { selector: `VariableDeclarator > ${LOCATION_MEMBER}`, message: LOCATION_LEAK_MESSAGE },
  { selector: `TemplateLiteral > ${LOCATION_MEMBER}`, message: LOCATION_LEAK_MESSAGE },
  { selector: `Property > ${LOCATION_MEMBER}`, message: LOCATION_LEAK_MESSAGE },
];

const DS_TYPE_CLASS_RULE = {
  selector:
    "Literal[value=/text-\\[(?:(?:[1-9]|[1-3][0-9]|40)(?:\\.[0-9]+)?px|[0-2](?:\\.[0-9]+)?rem)\\]/]",
  message:
    "Use a ds-* type token (ds-9 … ds-40) instead of an arbitrary text-[…] size. " +
    "Arbitrary sizes carry no line-height and break vertical rhythm. " +
    "Sizes above 40px (the hero ramp) and colour values like text-[hsl(var(--x))] are fine.",
};

/* ── Opacity is not a state signal ───────────────────────────────────────
   Dimming a CONTAINER with `opacity-*` to mean "off / disabled / unselected"
   attenuates its TEXT along with everything else, which silently drops the
   copy below the 4.5:1 WCAG AA bar. This produced 29 of the 51 contrast
   failures found in the 2026-08-31 audit, in three independent places:

     ProfileEditForm skill chips      opacity-45  → ~1.85:1  (11 nodes)
     HelperAvailability "off" cards   opacity-70  → <4.5:1   (12 nodes)
     NotificationPreferences rows     opacity-60  → <4.5:1   ( 6 nodes)

   Use an explicit muted token for the text, or carry the state with
   fill-vs-outline, which is what the chips do now.

   Deliberately narrow. Only bare, always-on values 5–75 are banned. These
   remain legal because they are transient or non-text:
     active:opacity-70   hover:opacity-100   disabled:opacity-50
     group-hover:*       focus:*             opacity-80 and above
   `disabled:` is exempt because WCAG exempts disabled controls.            */
const OPACITY_STATE_RULE = {
  selector:
    "Literal[value=/(?<![-:\\w])opacity-(?:5|10|15|20|25|30|35|40|45|50|55|60|65|70|75)(?![\\d])/]",
  message:
    "Don't signal state with a bare opacity-* on a container — it dims the TEXT too and " +
    "drops it under WCAG AA (this caused 29 contrast failures). Use a muted colour token " +
    "for the text, or fill-vs-outline for selected state. Prefixed forms " +
    "(active:/hover:/focus:/disabled:/group-*) and opacity-80+ are still allowed.",
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
  "src/components/DisputeTimelineDialog.tsx",
  "src/components/ReferralSection.tsx",
  "src/components/activity/EditJobDialog.tsx",
  "src/components/admin/AdminAnalyticsCharts.tsx",
  "src/components/business/SpendDashboardTab.tsx",
  "src/components/profile/EarningsBreakdownCharts.tsx",
  "src/components/profile/EarningsTab.tsx",
  "src/components/profile/ProfileStatsTrend.tsx",
  "src/components/profile/ReviewsTab.tsx",
  "src/components/profile/subscriptionTab/CancelSurveyDialog.tsx",
  "src/components/wallet/PayoutCelebration.tsx",
  "src/lib/accessibility.test.tsx",
  "src/pages/SubscriptionPage.tsx",
  "src/pages/helperAnalytics/MonthlyGoalCard.tsx",
  "src/pages/helperAnalytics/RatingsReviewsCard.tsx",
];

/* Files carrying a pre-existing bare `opacity-*`, exempt from
   OPACITY_STATE_RULE only. A debt ledger, not a permanent allowance — the
   same pattern as DS_TYPE_INLINE_LEGACY above, and it should only ever get
   shorter.

   These are grandfathered rather than rewritten because an axe sweep of all
   69 routes in both themes currently reports ZERO contrast violations, so
   none of these is failing AA today — the great majority dim an ICON, and
   WCAG holds non-text graphics to 3:1, not 4.5:1. What the rule is really
   there to stop is the next person reaching for `opacity-*` to mean "off" on
   a container that holds TEXT, which is what produced 29 real failures.

   Before deleting a file from this list, re-run axe on the surface it
   renders on — several of these live inside dialogs, which the route-level
   sweep does not open.                                                      */
const OPACITY_STATE_LEGACY = [
  "src/components/CancellationDialog.tsx",
  "src/components/CredentialBadge.tsx",
  "src/components/DateWheelPicker.tsx",
  "src/components/MessageAttachment.tsx",
  "src/components/MobileNav.tsx",
  "src/components/QuickReplies.tsx",
  "src/components/ReportDialog.tsx",
  "src/components/TimePickerWheel.tsx",
  "src/components/TimeRangeField.tsx",
  "src/components/admin/AdminCommandPalette.tsx",
  "src/components/admin/AdminReferrals.tsx",
  "src/components/admin/AdminReports.tsx",
  "src/components/admin/AdminSubscriptions.tsx",
  "src/components/admin/UserVerificationHistory.tsx",
  "src/components/admin/adminJobs/JobListItem.tsx",
  "src/components/admin/adminPayoutBatches/LedgerList.tsx",
  "src/components/admin/adminusers/AdminUserRow.tsx",
  "src/components/dashboard/DashboardInProgressBadge.tsx",
  "src/components/dashboard/JobCard.tsx",
  "src/components/dashboard/PhotoLightbox.tsx",
  "src/components/messages/MessageBubble.tsx",
  "src/components/profile/HelperScheduleStrip.tsx",
  "src/components/profile/SkillEndorsements.tsx",
  "src/components/profile/earningsTab/RecentTransfers.tsx",
  "src/components/profile/profileLanding/IdentityHeader.tsx",
  "src/components/ui/calendar.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/select.tsx",
  "src/pages/userProfile/ReviewsSection.tsx",
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
      // ERROR, not warn — and no `varsIgnorePattern`. This rule was a warning
      // that nothing failed on, so ~60 dead symbols accumulated behind it,
      // including whole half-wired features: an intro-video upload whose
      // handlers were destructured and dropped, a completion checklist that
      // could never render, per-row "action needed" chips that were computed
      // and never used. Every one of them read as intentional in review
      // because an underscore or a passing lint run said nothing was wrong.
      //
      // `argsIgnorePattern` stays: an unused leading ARGUMENT is often forced
      // by a callback signature you don't control. An unused VARIABLE never
      // is — it is either dead or a feature someone forgot to finish, and
      // both deserve to stop the build rather than be renamed to `_thing`.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
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
      "no-restricted-syntax": ["error", DS_TYPE_CLASS_RULE, DS_TYPE_INLINE_RULE, OPACITY_STATE_RULE, ...NATIVE_ORIGIN_RULES],

    },
  },
  {
    files: DS_TYPE_INLINE_LEGACY,
    rules: {
      // Class rule still enforced here; only the inline one is grandfathered.
      // The opacity and native-origin rules stay on — being on the type-debt
      // ledger is not a reason to stop enforcing unrelated guards.
      "no-restricted-syntax": ["error", DS_TYPE_CLASS_RULE, OPACITY_STATE_RULE, ...NATIVE_ORIGIN_RULES],
    },
  },
  {
    // Grandfathered for the opacity rule ONLY — every other guard still
    // applies. Disjoint from DS_TYPE_INLINE_LEGACY (asserted: no overlap), so
    // the two blocks cannot shadow each other.
    files: OPACITY_STATE_LEGACY,
    rules: {
      "no-restricted-syntax": ["error", DS_TYPE_CLASS_RULE, DS_TYPE_INLINE_RULE, ...NATIVE_ORIGIN_RULES],
    },
  },
);
