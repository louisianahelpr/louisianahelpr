import { lazy, Suspense } from "react";
import type { User } from "@supabase/supabase-js";
import type { UseQueryResult } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
import type { Database } from "@/integrations/supabase/types";
import type {
  ProfileReview,
  ProfileViolation,
} from "@/hooks/useProfileTabData";
import type { Profile, Tab } from "./types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type ProfileTip = { amount: number; job_id: string; created_at: string };

// Only the landing tab + its lightweight header are needed on first paint.
// Every other tab panel and the rarely-opened dialogs are code-split so the
// Profile route chunk stays small — each is fetched the first time it shows.
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
const NotificationPreferences = lazy(() => import("@/components/NotificationPreferences"));
const AccessibilityTab = lazy(() => import("@/components/profile/AccessibilityTab").then(m => ({ default: m.AccessibilityTab })));
const ReferralSection = lazy(() => import("@/components/ReferralSection"));

const TabFallback = () => (
  <div className="space-y-4">
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <Skeleton className="h-5 w-32 rounded" />
      <Skeleton className="h-4 w-2/3 rounded" />
      <Skeleton className="h-4 w-1/2 rounded" />
    </div>
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="h-4 w-1/2 rounded" />
    </div>
  </div>
);

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
   * every other sub-page (/work-record, /benefits, /pets) returns you to the
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
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
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
  avatarBroken,
  setAvatarBroken,
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
        <Suspense fallback={<TabFallback />}>
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
            avatarBroken={avatarBroken}
            setAvatarBroken={setAvatarBroken}
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
      {(tab === "earnings" || tab === "payment") && !user && <TabFallback />}
      {(tab === "earnings" || tab === "payment") && user && (
        <div className="space-y-3">
          {earningsQuery.isError && (
            <ProfileSectionError section="your earnings" onRetry={() => { earningsQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <EarningsTab
              earningsJobs={earningsJobs}
              tips={tips}
              loading={earningsQuery.isPending}
              onBack={onBackFromTab}
              helperId={user.id}
              helperName={profile?.full_name || user.email || "Helpr"}
            />
          </Suspense>
        </div>
      )}

      {tab === "schedule" && !user && <TabFallback />}
      {tab === "schedule" && user && (
        <div className="space-y-4">
          {scheduleQuery.isError && (
            <ProfileSectionError section="your schedule" onRetry={() => { scheduleQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <ScheduleTab
              postedJobs={schedulePostedJobs}
              assignedJobs={scheduleAssignedJobs}
              loading={scheduleQuery.isPending}
              userId={user.id}
              onBack={onBackFromTab}
            />
          </Suspense>
        </div>
      )}

      {tab === "availability" && (!user ? <TabFallback /> : (
        <Suspense fallback={<TabFallback />}>
          <AvailabilityTab userId={user.id} onBack={onBackFromTab} />
        </Suspense>
      ))}

      {tab === "subscription" && (
        <Suspense fallback={<TabFallback />}>
          <SubscriptionTab profile={profile} user={user} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "support" && (
        <Suspense fallback={<TabFallback />}>
          <SupportInline userId={user?.id} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "saved_helpers" && (
        <Suspense fallback={<TabFallback />}>
          <SavedHelpersTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "accessibility" && (
        <Suspense fallback={<TabFallback />}>
          <AccessibilityTab
            seniorMode={seniorMode}
            onToggleSeniorMode={onToggleSeniorMode}
            onBack={onBackFromTab}
          />
        </Suspense>
      )}

      {tab === "notifications" && (
        <div className="space-y-4">
          <ProfileTabHeader
            title="Notifications"
            onBack={onBackFromTab}
          />
          <Suspense fallback={<TabFallback />}>
            <NotificationPreferences />
          </Suspense>
        </div>
      )}

      {tab === "security" && (
        <Suspense fallback={<TabFallback />}>
          <SecurityTab email={user?.email} onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "reviews" && (
        // The error branch is not optional decoration: on a failed fetch
        // `isPending` is false and `reviews` is `[]`, so ReviewsTab drops
        // straight into its "no reviews yet" empty state — telling a helper
        // nobody has reviewed them when in truth the query died. Mirrors the
        // warnings tab below.
        <div className="space-y-3">
          {reviewsQuery.isError && (
            <ProfileSectionError
              section="your reviews"
              onRetry={() => { reviewsQuery.refetch(); }}
            />
          )}
          <Suspense fallback={<TabFallback />}>
            <ReviewsTab reviews={reviews} loading={reviewsQuery.isPending} avgRating={avgRating} reviewCount={reviewCount} onBack={onBackFromTab} />
          </Suspense>
        </div>
      )}

      {tab === "referral" && !user && <TabFallback />}
      {tab === "referral" && user && (
        <div className="space-y-4">
          <ProfileTabHeader
            title="Referrals"
            onBack={onBackFromTab}
          />
          <Suspense fallback={<TabFallback />}>
            <ReferralSection userId={user.id} />
          </Suspense>
        </div>
      )}

      {tab === "legal" && (
        <Suspense fallback={<TabFallback />}>
          <LegalTab onBack={onBackFromTab} />
        </Suspense>
      )}

      {tab === "warnings" && (
        <div className="space-y-4">
          {violationsQuery.isError && (
            <ProfileSectionError
              section="your warnings & strikes"
              onRetry={() => { violationsQuery.refetch(); }}
            />
          )}
          <Suspense fallback={<TabFallback />}>
            <WarningsTab violations={violations} loading={violationsQuery.isPending} onBack={onBackFromTab} />
          </Suspense>
        </div>
      )}

      {tab === "credentials" && !user && <TabFallback />}
      {tab === "credentials" && user && (
        <div className="space-y-4">
          <Suspense fallback={<TabFallback />}>
            <CredentialsTab userId={user.id} onBack={onBackFromTab} />
          </Suspense>
        </div>
      )}
    </>
  );
};
