import { lazy, Suspense } from "react";
import type { User } from "@supabase/supabase-js";
import type { UseQueryResult } from "@tanstack/react-query";
import { ProfileTabFallback } from "@/components/profile/ProfileTabFallback";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import type { ReadableJobRow } from "@/lib/jobColumns";
import type {
  ProfileReview,
  ProfileViolation,
} from "@/hooks/useProfileTabData";
import type { Profile, Tab } from "./types";

// jobs.offered_to_helper_id is not client-selectable (20260915045110).
type Job = ReadableJobRow;
type ProfileTip = { amount: number; job_id: string; created_at: string };

// Only the landing tab + its lightweight header are needed on first paint.
// Every other tab panel and the rarely-opened dialogs are code-split so the
// Profile route chunk stays small — each is fetched the first time it shows.
import { EarningsPageSkeleton } from "@/components/profile/earningsTab/EarningsPageSkeleton";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
const SecurityTab = lazy(() => import("@/components/profile/SecurityTab").then(m => ({ default: m.SecurityTab })));
const ProfileEditForm = lazy(() => import("@/components/profile/ProfileEditForm").then(m => ({ default: m.ProfileEditForm })));
const SupportInline = lazy(() => import("@/components/profile/SupportInline").then(m => ({ default: m.SupportInline })));
const SavedHelpersTab = lazy(() => import("@/components/profile/SavedHelpersTab").then(m => ({ default: m.SavedHelpersTab })));
const SubscriptionTab = lazy(() => import("@/components/profile/SubscriptionTab").then(m => ({ default: m.SubscriptionTab })));
const LegalTab = lazy(() => import("@/components/profile/LegalTab").then(m => ({ default: m.LegalTab })));
const EarningsTab = lazy(() => import("@/components/profile/EarningsTab").then(m => ({ default: m.EarningsTab })));
// Schedule and Availability are TWO tabs again (owner request 2026-08-19).
// They were merged behind an in-page segmented Calendar|Hours control, which
// meant one Profile row opened a screen that immediately asked you to choose
// again — and swapped its own title under a back button that didn't move.
// Deep links to /schedule and /availability keep resolving via the App.tsx
// redirects → /profile?tab=schedule|availability; each now lands on its own
// tab rather than on a shared screen with a pre-selected segment.
const ScheduleTab = lazy(() => import("@/components/profile/ScheduleTab").then(m => ({ default: m.ScheduleTab })));
const AvailabilityTab = lazy(() => import("@/components/profile/AvailabilityTab").then(m => ({ default: m.AvailabilityTab })));
const ReviewsTab = lazy(() => import("@/components/profile/ReviewsTab").then(m => ({ default: m.ReviewsTab })));
const WarningsTab = lazy(() => import("@/components/profile/WarningsTab").then(m => ({ default: m.WarningsTab })));
const CredentialsTab = lazy(() => import("@/components/profile/CredentialsTab").then(m => ({ default: m.CredentialsTab })));
const PetsTab = lazy(() => import("@/pages/PetProfiles"));
const WorkRecordTab = lazy(() => import("@/pages/WorkRecord"));
const HomeHistoryTab = lazy(() => import("@/pages/HomeHistory"));
const StrSettingsTab = lazy(() => import("@/pages/StrSettings"));
const AutoTipTab = lazy(() => import("@/pages/AutoTip"));
const WrappedTab = lazy(() => import("@/pages/HelprWrapped"));
const AnalyticsTab = lazy(() => import("@/pages/HelperAnalytics"));
const GiftCardTab = lazy(() => import("@/pages/GiftCard"));
const NotificationPreferences = lazy(() => import("@/components/NotificationPreferences"));
const AccessibilityTab = lazy(() => import("@/components/profile/AccessibilityTab").then(m => ({ default: m.AccessibilityTab })));
const ReferralSection = lazy(() => import("@/components/ReferralSection"));

/**
 * The Suspense fallback for every tab, thin: it exists only to narrow `tab`
 * away from "landing" (which is not a lazy panel and has its own skeleton in
 * Profile.tsx) before handing off to the shared placeholder. Everything about
 * what the placeholder IS — the real header, the one-screenful reserve, and
 * why that reserve is empty below the bones — lives in ProfileTabFallback.
 */
const TabFallback = ({ tab, onBack }: { tab: Tab; onBack: () => void }) =>
  tab === "landing" ? null : <ProfileTabFallback tab={tab} onBack={onBack} />;

export interface ProfileTabPanelsProps {
  tab: Tab;
  user: User | null;
  profile: Profile | null;
  /**
   * Back out of the CURRENT tab. Every tab used to pass its own
   * `onBack={onBackFromTab}` (seventeen of them), which meant back
   * from a tab always went to the Profile landing even when you had arrived
   * from somewhere else entirely — a notification, `/earnings`, `/schedule`.
   * That is the one back button in the app that ignored where you came from:
   * every other sub-page (/work-record, /pets) returns you to the
   * previous screen. The parent decides which of the two this is; the tabs
   * just call it. See `backFromTab` in Profile.tsx.
   */
  onBackFromTab: () => void;
  setProfile: React.Dispatch<React.SetStateAction<Profile | null>>;

  // Profile edit form
  firstName: string;
  lastName: string;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  skills: string;
  setSkills: (v: string) => void;
  initials: string;
  avatarUploading: boolean;
  idUploading: boolean;
  saving: boolean;
  justSaved: boolean;
  onSave: (e: React.FormEvent) => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onIdUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // Derived data + query handles
  earningsQuery: UseQueryResult<{ jobs: Job[]; tips: ProfileTip[] }>;
  scheduleQuery: UseQueryResult<{ posted: Job[]; assigned: Job[] }>;
  reviewsQuery: UseQueryResult<ProfileReview[]>;
  violationsQuery: UseQueryResult<ProfileViolation[]>;
  earningsJobs: Job[];
  tips: ProfileTip[];
  schedulePostedJobs: Job[];
  scheduleAssignedJobs: Job[];
  reviews: ProfileReview[];
  violations: ProfileViolation[];
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
}

/**
 * ProfileTabPanels — the non-landing tab router for the Profile page. Each
 * panel is code-split via `lazy()` (declared above) and wrapped in a
 * `<Suspense>` with the shared `TabFallback` skeleton, so opening a tab for
 * the first time fetches only that panel's chunk. Extracted from
 * Profile.tsx verbatim; the parent still owns the `SectionBoundary` +
 * `animate-ds-page-in` wrapper and all state.
 */
export const ProfileTabPanels = ({
  tab,
  user,
  profile,
  onBackFromTab,
  setProfile,
  firstName,
  lastName,
  phone,
  setPhone,
  location,
  setLocation,
  zipCode,
  setZipCode,
  bio,
  setBio,
  skills,
  setSkills,
  initials,
  avatarUploading,
  idUploading,
  saving,
  justSaved,
  onSave,
  onAvatarUpload,
  onIdUpload,
  earningsQuery,
  scheduleQuery,
  reviewsQuery,
  violationsQuery,
  earningsJobs,
  tips,
  schedulePostedJobs,
  scheduleAssignedJobs,
  reviews,
  violations,
  // Unused since the payment tab merged into the earnings tab — EarningsTab
  // derives its own total from `earningsJobs`. Kept on the props interface so
  // Profile.tsx's call site doesn't churn.
  totalEarnings: _totalEarnings,
  avgRating,
  reviewCount,
  seniorMode,
  onToggleSeniorMode,
}: ProfileTabPanelsProps) => {
  return (
    <>
      {/* PROFILE TAB */}
      {tab === "profile" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <ProfileEditForm
            profile={profile}
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            setPhone={setPhone}
            location={location}
            setLocation={setLocation}
            zipCode={zipCode}
            setZipCode={setZipCode}
            bio={bio}
            setBio={setBio}
            skills={skills}
            setSkills={setSkills}
            initials={initials}
            avatarUploading={avatarUploading}
            idUploading={idUploading}
            saving={saving}
            justSaved={justSaved}
            onSave={onSave}
            onAvatarUpload={onAvatarUpload}
            onIdUpload={onIdUpload}
            onBack={onBackFromTab}
            onPortfolioChange={(urls) => setProfile((prev) => prev ? ({ ...prev, portfolio_urls: urls }) : prev)}
          />
        </Suspense>
      )}


      {/* EXTRACTED TAB COMPONENTS — lazy loaded */}
      {/* Earnings, analytics and payout setup are ONE tab (owner request
          2026-08-19). `tab === "payment"` renders the same screen so the old
          /profile?tab=payment deep link — used by Stripe's onboarding return
          URL and by the landing's payout-status row — still lands on the
          surface that owns payout setup, rather than on a tab with no entry
          point of its own. */}
      {/* !user here means auth hasn't hydrated yet (a cold deep-link straight
          into ?tab=earnings, not a signed-out state — Profile itself gates
          on ProtectedRoute) — render the same Suspense skeleton the lazy
          import uses rather than nothing, so the tab doesn't flash blank.
          Kept as a sibling branch (not a ternary) so the `tab === "x" && (`
          shell shape below stays intact for profileTabShell.test.ts. */}
      {(tab === "earnings" || tab === "payment") && !user && <EarningsPageSkeleton />}
      {(tab === "earnings" || tab === "payment") && user && (
        <ProfileTabBody>
          {earningsQuery.isError && (
            <ProfileSectionError section="your earnings" onRetry={() => { earningsQuery.refetch(); }} />
          )}
          <Suspense fallback={<EarningsPageSkeleton />}>
            <EarningsTab
              earningsJobs={earningsJobs}
              tips={tips}
              loading={earningsQuery.isPending}
              onBack={onBackFromTab}
              helperId={user.id}
              helperName={profile?.full_name || user.email || "Helpr"}
            />
          </Suspense>
        </ProfileTabBody>
      )}

      {tab === "schedule" && !user && <TabFallback tab={tab} onBack={onBackFromTab} />}
      {tab === "schedule" && user && (
        <ProfileTabBody>
          {scheduleQuery.isError && (
            <ProfileSectionError section="your schedule" onRetry={() => { scheduleQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
            <ScheduleTab
              postedJobs={schedulePostedJobs}
              assignedJobs={scheduleAssignedJobs}
              loading={scheduleQuery.isPending}
              userId={user.id}
              onBack={onBackFromTab}
            />
          </Suspense>
        </ProfileTabBody>
      )}

      {tab === "availability" && (!user ? <TabFallback tab={tab} onBack={onBackFromTab} /> : (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <AvailabilityTab userId={user.id} onBack={onBackFromTab} />
        </Suspense>
      ))}

      {tab === "subscription" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <SubscriptionTab profile={profile} user={user} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "support" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <SupportInline userId={user?.id} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "saved_helpers" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <SavedHelpersTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "work_record" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <WorkRecordTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "home_history" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <HomeHistoryTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "str_settings" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <StrSettingsTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "auto_tip" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <AutoTipTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "wrapped" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <WrappedTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "analytics" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <AnalyticsTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "gift_card" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <GiftCardTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "pets" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <PetsTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "accessibility" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <AccessibilityTab
            seniorMode={seniorMode}
            onToggleSeniorMode={onToggleSeniorMode}
            onBack={onBackFromTab}
          />
        </Suspense>
      )}

      {/* Suspense wraps the WHOLE tab, header included. It used to sit inside,
          under a header the router painted itself — so the fallback (which now
          carries the tab's real header) would have drawn a second one. Every
          branch in this file is the same shape for that reason: one Suspense,
          around everything, with ProfileTabFallback supplying the header while
          the chunk is in flight and the branch below supplying it after. */}
      {tab === "notifications" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <ProfileTabBody>
            <ProfileTabHeader
              title="Notifications"
              onBack={onBackFromTab}
            />
            <NotificationPreferences />
          </ProfileTabBody>
        </Suspense>
      )}

      {tab === "security" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <SecurityTab email={user?.email} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "reviews" && (
        // The error branch is not optional decoration: on a failed fetch
        // `isPending` is false and `reviews` is `[]`, so ReviewsTab drops
        // straight into its "no reviews yet" empty state — telling a helper
        // nobody has reviewed them when in truth the query died. Mirrors the
        // warnings tab below.
        <ProfileTabBody>
          {reviewsQuery.isError && (
            <ProfileSectionError
              section="your reviews"
              onRetry={() => { reviewsQuery.refetch(); }}
            />
          )}
          <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
            <ReviewsTab reviews={reviews} loading={reviewsQuery.isPending} avgRating={avgRating} reviewCount={reviewCount} onBack={onBackFromTab} />
          </Suspense>
        </ProfileTabBody>
      )}

      {tab === "referral" && !user && <TabFallback tab={tab} onBack={onBackFromTab} />}
      {tab === "referral" && user && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <ProfileTabBody>
            <ProfileTabHeader
              title="Referrals"
              onBack={onBackFromTab}
            />
            <ReferralSection userId={user.id} />
          </ProfileTabBody>
        </Suspense>
      )}

      {tab === "legal" && (
        <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
          <LegalTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "warnings" && (
        <ProfileTabBody>
          {violationsQuery.isError && (
            <ProfileSectionError
              section="your warnings & strikes"
              onRetry={() => { violationsQuery.refetch(); }}
            />
          )}
          <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
            <WarningsTab violations={violations} loading={violationsQuery.isPending} onBack={onBackFromTab} />
          </Suspense>
        </ProfileTabBody>
      )}

      {tab === "credentials" && !user && <TabFallback tab={tab} onBack={onBackFromTab} />}
      {tab === "credentials" && user && (
        <ProfileTabBody>
          <Suspense fallback={<TabFallback tab={tab} onBack={onBackFromTab} />}>
            <CredentialsTab userId={user.id} onBack={onBackFromTab} />
          </Suspense>
        </ProfileTabBody>
      )}
    </>
  );
};
