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
const JobListTab = lazy(() => import("@/components/profile/JobListTab").then(m => ({ default: m.JobListTab })));
const ProfileEditForm = lazy(() => import("@/components/profile/ProfileEditForm").then(m => ({ default: m.ProfileEditForm })));
const SupportInline = lazy(() => import("@/components/profile/SupportInline").then(m => ({ default: m.SupportInline })));
const SavedHelpersTab = lazy(() => import("@/components/profile/SavedHelpersTab").then(m => ({ default: m.SavedHelpersTab })));
const SubscriptionTab = lazy(() => import("@/components/profile/SubscriptionTab").then(m => ({ default: m.SubscriptionTab })));
const LegalTab = lazy(() => import("@/components/profile/LegalTab").then(m => ({ default: m.LegalTab })));
const EarningsTab = lazy(() => import("@/components/profile/EarningsTab").then(m => ({ default: m.EarningsTab })));
// Schedule + Availability merged into a single tab with a sub-toggle
// (handoff item #22). Deep links to /schedule and /availability still
// resolve via App.tsx redirects → /profile?tab=schedule|availability;
// the merged tab uses the initial `tab` value to pick its sub-view.
const ScheduleAvailabilityTab = lazy(() => import("@/components/profile/ScheduleAvailabilityTab").then(m => ({ default: m.ScheduleAvailabilityTab })));
const ReviewsTab = lazy(() => import("@/components/profile/ReviewsTab").then(m => ({ default: m.ReviewsTab })));
const WarningsTab = lazy(() => import("@/components/profile/WarningsTab").then(m => ({ default: m.WarningsTab })));
const CredentialsTab = lazy(() => import("@/components/profile/CredentialsTab").then(m => ({ default: m.CredentialsTab })));
const PaymentTab = lazy(() => import("@/components/PaymentTab").then(m => ({ default: m.PaymentTab })));
const NotificationPreferences = lazy(() => import("@/components/NotificationPreferences"));
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
  setTab: (tab: Tab) => void;
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
  inlineJobsQuery: UseQueryResult<{ posted: Job[]; completed: Job[] }>;
  reviewsQuery: UseQueryResult<ProfileReview[]>;
  violationsQuery: UseQueryResult<ProfileViolation[]>;
  earningsJobs: Job[];
  tips: ProfileTip[];
  schedulePostedJobs: Job[];
  scheduleAssignedJobs: Job[];
  inlinePostedJobs: Job[];
  inlineCompletedJobs: Job[];
  reviews: ProfileReview[];
  violations: ProfileViolation[];
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
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
  setTab,
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
  inlineJobsQuery,
  reviewsQuery,
  violationsQuery,
  earningsJobs,
  tips,
  schedulePostedJobs,
  scheduleAssignedJobs,
  inlinePostedJobs,
  inlineCompletedJobs,
  reviews,
  violations,
  totalEarnings,
  avgRating,
  reviewCount,
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
            onBack={() => setTab("landing")}
            onPortfolioChange={(urls) => setProfile((prev) => prev ? ({ ...prev, portfolio_urls: urls }) : prev)}
            onContactSupport={() => setTab("support")}
          />
        </Suspense>
      )}


      {/* EXTRACTED TAB COMPONENTS — lazy loaded */}
      {tab === "earnings" && user && (
        <div className="space-y-3">
          {earningsQuery.isError && (
            <ProfileSectionError section="your earnings" onRetry={() => { earningsQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <EarningsTab
              earningsJobs={earningsJobs}
              tips={tips}
              loading={earningsQuery.isPending}
              onBack={() => setTab("landing")}
              helperId={user.id}
              helperName={profile?.full_name || user.email || "Helpr"}
            />
          </Suspense>
        </div>
      )}

      {(tab === "schedule" || tab === "availability") && user && (
        <div className="space-y-3">
          {scheduleQuery.isError && tab === "schedule" && (
            <ProfileSectionError section="your schedule" onRetry={() => { scheduleQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <ScheduleAvailabilityTab
              initialView={tab === "availability" ? "availability" : "calendar"}
              onSubViewChange={(v) => setTab(v === "availability" ? "availability" : "schedule")}
              postedJobs={schedulePostedJobs}
              assignedJobs={scheduleAssignedJobs}
              loading={scheduleQuery.isPending}
              userId={user.id}
              onBack={() => setTab("landing")}
            />
          </Suspense>
        </div>
      )}

      {tab === "payment" && (
        <div className="space-y-4">
          <ProfileTabHeader
            title="Payment settings"
            onBack={() => setTab("landing")}
          />
          <Suspense fallback={<TabFallback />}>
            <PaymentTab
              earningsJobs={earningsJobs}
              totalEarnings={totalEarnings}
              onSeeEarnings={() => setTab("earnings")}
            />
          </Suspense>
        </div>
      )}

      {tab === "subscription" && (
        <Suspense fallback={<TabFallback />}>
          <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "posted_jobs" && (
        <div className="space-y-3">
          {inlineJobsQuery.isError && (
            <ProfileSectionError section="your posted jobs" onRetry={() => { inlineJobsQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <JobListTab variant="posted" jobs={inlinePostedJobs} onBack={() => setTab("landing")} />
          </Suspense>
        </div>
      )}

      {tab === "completed_jobs" && (
        <div className="space-y-3">
          {inlineJobsQuery.isError && (
            <ProfileSectionError section="your completed jobs" onRetry={() => { inlineJobsQuery.refetch(); }} />
          )}
          <Suspense fallback={<TabFallback />}>
            <JobListTab variant="completed" jobs={inlineCompletedJobs} onBack={() => setTab("landing")} />
          </Suspense>
        </div>
      )}

      {tab === "support" && (
        <Suspense fallback={<TabFallback />}>
          <SupportInline userId={user?.id} onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "saved_helpers" && (
        <Suspense fallback={<TabFallback />}>
          <SavedHelpersTab onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "notifications" && (
        <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">
          <ProfileTabHeader
            title="Notifications"
            onBack={() => setTab("landing")}
          />
          <Suspense fallback={<TabFallback />}>
            <NotificationPreferences />
          </Suspense>
        </div>
      )}

      {tab === "security" && (
        <Suspense fallback={<TabFallback />}>
          <SecurityTab email={user?.email} onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "reviews" && (
        <Suspense fallback={<TabFallback />}>
          <ReviewsTab reviews={reviews} loading={reviewsQuery.isPending} avgRating={avgRating} reviewCount={reviewCount} onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "referral" && user && (
        <div className="space-y-5">
          <ProfileTabHeader
            title="Referral program"
            onBack={() => setTab("landing")}
          />
          <Suspense fallback={<TabFallback />}>
            <ReferralSection userId={user.id} />
          </Suspense>
        </div>
      )}

      {tab === "legal" && (
        <Suspense fallback={<TabFallback />}>
          <LegalTab onBack={() => setTab("landing")} />
        </Suspense>
      )}

      {tab === "warnings" && (
        <div className="space-y-3">
          {violationsQuery.isError && (
            <ProfileSectionError
              section="your warnings & strikes"
              onRetry={() => { violationsQuery.refetch(); }}
            />
          )}
          <Suspense fallback={<TabFallback />}>
            <WarningsTab violations={violations} loading={violationsQuery.isPending} onBack={() => setTab("landing")} />
          </Suspense>
        </div>
      )}

      {tab === "credentials" && user && (
        <div className="space-y-4">
          <ProfileTabHeader
            title="Licensed &amp; insured"
            onBack={() => setTab("landing")}
          />
          <Suspense fallback={<TabFallback />}>
            <CredentialsTab userId={user.id} />
          </Suspense>
        </div>
      )}
    </>
  );
};
