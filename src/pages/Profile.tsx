import { useEffect, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { lookupParishByZip } from "@/lib/parishLookup";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { splitName } from "@/lib/splitName";
import { requireOnline } from "@/lib/requireOnline";
import { buildEarningsSparklineSeries } from "@/lib/earningsSparklineSeries";
import {
  useProfileStats,
  useProfileReviews,
  useProfileEarnings,
  useProfileSchedule,
  useProfileInlineJobs,
  useProfileViolations,
} from "@/hooks/useProfileTabData";

// Only the landing tab + its lightweight header are needed on first paint.
// Every other tab panel and the rarely-opened dialogs are code-split so the
// Profile route chunk stays small — each is fetched the first time it shows.
// The full non-landing tab router (and its lazy panel imports) lives in the
// co-located <ProfileTabPanels />; only the landing hero + delete dialog are
// referenced directly here.
import { ProfileLanding } from "@/components/profile/ProfileLanding";
import SectionBoundary from "@/components/SectionBoundary";
import { ProfileTabPanels } from "./profile/ProfileTabPanels";
import type { Profile, Tab } from "./profile/types";
const DeleteAccountDialog = lazy(() => import("@/components/profile/DeleteAccountDialog").then(m => ({ default: m.DeleteAccountDialog })));

const ProfilePage = () => {
  usePageTitle("My Profile — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: cachedUser, profile: cachedProfile, isLoading: authLoading, refresh: refreshCurrentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const initialTab = (searchParams.get("tab") as Tab) || "landing";
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sync tab to URL for bookmarkability; React Router owns history so browser
  // back/forward updates searchParams, which the effect below mirrors to state.
  useEffect(() => {
    const current = (searchParams.get("tab") as Tab | null) || "landing";
    if (current === tab) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "landing") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }, [tab]);

  // Mirror URL → state when back/forward (or a deep link) changes the tab param.
  useEffect(() => {
    const urlTab = (searchParams.get("tab") as Tab | null) || "landing";
    setTab((prev) => (prev === urlTab ? prev : urlTab));
  }, [searchParams]);

  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null>(null);

  const userId = user?.id;

  // Per-tab data — each section is its own `enabled`-gated React Query keyed
  // under ["profile", userId, <section>], so switching away from a tab and
  // back hits the cache, in-flight requests dedupe, and the prior
  // loading/loaded flag pairs are gone. Each section still surfaces failures
  // through its own inline <ProfileSectionError /> (driven by `.isError`)
  // rather than a page-level banner — so one section failing never blanks
  // the core profile (name, avatar) that loaded fine.
  const statsQuery = useProfileStats(userId);
  // Reviews are needed on both the landing tab (2-review hero preview) and
  // the reviews tab — gating on either shares one cached fetch.
  const reviewsQuery = useProfileReviews(userId, tab === "landing" || tab === "reviews");
  // Also enabled on the landing tab so the header earnings-sparkline
  // teaser has its (cheap jobs+tips) data without a second query. The
  // result is cached, so opening the Earnings tab next is instant.
  const earningsQuery = useProfileEarnings(
    userId,
    tab === "earnings" || tab === "payment" || tab === "landing",
  );
  // Schedule data drives the merged Schedule + Availability tab — gate
  // on either sub-view so the calendar grid is hot the moment the user
  // flips the internal toggle from Hours → Calendar.
  const scheduleQuery = useProfileSchedule(userId, tab === "schedule" || tab === "availability");
  const inlineJobsQuery = useProfileInlineJobs(userId, tab === "posted_jobs" || tab === "completed_jobs");
  const violationsQuery = useProfileViolations(userId, tab === "warnings");

  const completedCount = statsQuery.data?.completedCount ?? 0;
  const postedCount = statsQuery.data?.postedCount ?? 0;
  const avgRating = statsQuery.data?.avgRating ?? null;
  const reviewCount = statsQuery.data?.reviewCount ?? 0;

  const reviews = reviewsQuery.data ?? [];
  const earningsJobs = earningsQuery.data?.jobs ?? [];
  const tips = earningsQuery.data?.tips ?? [];
  const schedulePostedJobs = scheduleQuery.data?.posted ?? [];
  const scheduleAssignedJobs = scheduleQuery.data?.assigned ?? [];
  const inlinePostedJobs = inlineJobsQuery.data?.posted ?? [];
  const inlineCompletedJobs = inlineJobsQuery.data?.completed ?? [];
  const violations = violationsQuery.data ?? [];

  // Profile fields
  const [, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [parish, setParish] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idUploading, setIdUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Senior mode — local state shadows profile.senior_mode; applied to
  // <html> as a CSS class so all pages get the enlarged styles.
  const [seniorMode, setSeniorMode] = useState(false);

  useEffect(() => {
    // Once auth loading is done, resolve the loading state
    if (authLoading) return;
    
    if (cachedUser) {
      setUser(cachedUser);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setFullName(cachedProfile.full_name || "");
        const { firstName: _firstName, lastName: _lastName } = splitName(cachedProfile.full_name);
        setFirstName(_firstName);
        setLastName(_lastName);
        setPhone(cachedProfile.phone || "");
        setLocation(cachedProfile.location || "");
        setZipCode(cachedProfile.zip_code || "");
        setParish(cachedProfile.parish || null);
        setBio(cachedProfile.bio || "");
        setSkills(cachedProfile.skills || "");
        setHourlyRate(cachedProfile.hourly_rate?.toString() || "");
        setDateOfBirth(cachedProfile.date_of_birth || "");
        setSeniorMode(!!(cachedProfile as unknown as { senior_mode?: boolean }).senior_mode);
      }
      setLoading(false);
      // Stats load via useProfileStats — enabled once `user` is set below.
    } else {
      // No user — stop loading (ProtectedRoute will redirect)
      setLoading(false);
    }
  }, [cachedUser, cachedProfile, authLoading]);

  // No separate auth listener needed — useCurrentUser handles it via React Query

  // Auto-lookup parish from zip (Louisiana sales tax)
  useEffect(() => {
    const cleaned = zipCode.replace(/\D/g, "");
    if (cleaned.length !== 5) return;
    let cancelled = false;
    lookupParishByZip(cleaned).then((p) => { if (!cancelled && p) setParish(p); });
    return () => { cancelled = true; };
  }, [zipCode]);

  // Pull-to-refresh for the Profile landing — re-syncs the profile,
  // Stripe-connect status, helper stats, and review preview. Scoped to
  // the landing's scroll surface via PullToRefreshWrapper below.
  // Invalidating the stats/reviews queries deliberately re-fetches them
  // (the prior `{ force: true }` semantics) while reusing the cache for
  // everything else.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await refreshCurrentUser();
      if (userId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "stats"] }),
          queryClient.invalidateQueries({ queryKey: ["profile", userId, "reviews"] }),
        ]);
      }
    },
  });

  useEffect(() => {
    if (profile?.approval_status === "approved" && !stripeConnectStatus) {
      checkStripeConnect();
    }
  }, [profile]);

  const checkStripeConnect = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "status" } });
      if (error) throw error;
      setStripeConnectStatus(data);
    } catch (err) {
      console.error("[Profile] checkStripeConnect failed:", err);
      // Default to disconnected so payout-setup banner stays visible
      // rather than silently hiding when the edge function is unreachable.
      setStripeConnectStatus({ connected: false, details_submitted: false, payouts_enabled: false });
    }
  };


  const handleToggleSeniorMode = async (enabled: boolean) => {
    if (!user) return;
    // Optimistic update
    setSeniorMode(enabled);
    document.documentElement.classList.toggle("senior-mode", enabled);
    // Persist to profile — graceful fallback for PGRST202 if migration
    // hasn't been applied yet (senior_mode column may not exist on prod yet).
    const { error } = await supabase
      .from("profiles")
      .update({ senior_mode: enabled })
      .eq("user_id", user.id);
    if (error) {
      // Roll back optimistic update only if it's not a missing-column error
      if (!error.message?.includes("senior_mode")) {
        setSeniorMode(!enabled);
        document.documentElement.classList.toggle("senior-mode", !enabled);
        toast.error("Couldn't save setting — try again.");
      }
      // Missing column = migration not yet pushed; keep UI state, don't toast.
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireOnline()) return;
    if (!user) return;
    const merged = `${firstName.trim()} ${lastName.trim()}`.trim();
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      full_name: merged, phone: phone.trim(), location: location.trim(),
      bio: bio.trim(), skills: skills.trim(),
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
      date_of_birth: dateOfBirth || null,
      zip_code: zipCode.replace(/\D/g, "").slice(0, 5) || null,
      parish: parish,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error("We couldn't save your profile — please try again.");
    else {
      setFullName(merged);
      setJustSaved(true);
      toast.success("Profile updated!");
      setTimeout(() => setJustSaved(false), 1800);
    }
  };

  const handleIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5 MB"); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Use JPG, PNG, WEBP, or PDF"); return; }
    setIdUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/id-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("id-documents").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Couldn't upload your ID — " + upErr.message); setIdUploading(false); return; }
    const { error: updErr } = await supabase.from("profiles").update({ id_document_url: path, idv_status: "pending" }).eq("user_id", user.id);
    if (updErr) toast.error("Got your ID, but couldn't save it to your profile. Try again?");
    else {
      setProfile(prev => prev ? ({ ...prev, id_document_url: path, idv_status: "pending" }) : prev);
      toast.success("ID sent in — we'll let you know when it's cleared.");
    }
    setIdUploading(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) { toast.error("Select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }

    setAvatarUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;

    // Avatars go in the public `avatars` bucket (user-documents is now
    // private as of 2026-05-05; mixing public avatars with private docs
    // forced a wrong choice on bucket-level public flag).
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast.error("Couldn't upload your photo — " + uploadError.message);
      setAvatarUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = urlData.publicUrl + "?t=" + Date.now();

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("user_id", user.id);

    if (updateError) {
      toast.error("Photo uploaded, but couldn't pin it to your profile. Try again?");
    } else {
      setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      setAvatarBroken(false);
      toast.success("Profile picture updated!");
    }
    setAvatarUploading(false);
  };

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const handleLogout = async () => { await signOutWithPushCleanup(); navigate("/"); };
  const handleDeleteAccount = async () => {
    // The dialog asks the user to type "DELETE" (short, thumb-friendly).
    // The delete-own-account edge function still validates against the
    // legacy "DELETE MY ACCOUNT" phrase server-side, so we map here —
    // server contract is unchanged.
    if (deleteConfirmText !== "DELETE") return;
    setDeletingAccount(true);
    try {
      // Block deletion while the user is mid-transaction: an active job or
      // escrowed funds would be orphaned. The edge function enforces this too
      // (409), but pre-checking here lets us show a clear, human message
      // instead of a generic "Failed to delete" from a non-2xx response.
      if (user?.id) {
        const { data: activeJobs, error: activeErr } = await supabase
          .from("jobs")
          .select("id")
          .or(`customer_id.eq.${user.id},helper_id.eq.${user.id}`)
          .or("status.in.(accepted,arrived,in_progress,awaiting),payment_status.eq.escrow")
          .limit(1);
        if (activeErr) throw activeErr;
        if (activeJobs && activeJobs.length > 0) {
          toast.error(
            "You have an active task or a payment in progress. Wrap up your open tasks and let any payments settle first.",
          );
          setDeletingAccount(false);
          return;
        }
      }
      const { error } = await supabase.functions.invoke("delete-own-account", {
        body: { confirmation: "DELETE MY ACCOUNT" },
      });
      if (error) throw error;
      toast.success("Account deleted successfully");
      await signOutWithPushCleanup();
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Couldn't delete your account — try again?");
    } finally {
      setDeletingAccount(false);
    }
  };

  if (loading) {
    // Loading state mirrors the loaded state's shell so there's no
    // header jump when the skeleton resolves. Uses AppShell + the same
    // DashboardHeader (which carries `.glass-header` → safe-area-top
    // inset) so the HelprMark never overlaps the iOS status bar clock.
    return (
      <AppShell
        header={<DashboardHeader title="Profile" />}
        scrollable={false}
        contentClassName="overflow-hidden"
        className="bg-premium-page"
      >
        <div className="container mx-auto px-5 lg:px-8 xl:px-12 py-4 flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto">
            <ProfilePageSkeleton />
          </div>
        </div>
      </AppShell>
    );
  }

  const displayName = profile?.full_name?.trim() || (user?.email ? user.email.split("@")[0] : "");
  const initials = (profile?.full_name?.trim() || user?.email || "?")
    .split(/[\s@.]/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  // Take-home math (budget − per-job platform fee + net urgent bonus, divided
  // across a group job's roster, mirroring the release-payout edge function)
  // lives in `helperEarnings.ts` so this page, /wrapped, /work-record and the
  // Earnings tab can never drift apart again. The tier rate is the LAST-RESORT
  // fee for legacy rows that recorded neither a stamped `platform_fee_amount`
  // nor a frozen `helper_fee_percent`.
  const helperFeeFallbackPct = tierFeePercent(
    profile?.subscription_tier ?? null,
    profile?.subscription_expires_at ?? null,
  );
  const totalEarnings = sumHelperTakeHomeDollars(
    earningsJobs.filter((j) => j.status === "completed"),
    helperFeeFallbackPct,
  );

  // Last-6-weeks take-home series for the header sparkline teaser. Shares the
  // same per-job resolution as `totalEarnings` above (so the line and the
  // number agree). Returns null when there isn't enough signal to draw a
  // meaningful line, in which case ProfileLanding hides the teaser entirely.
  const earningsSparkline = buildEarningsSparklineSeries(earningsJobs, helperFeeFallbackPct);

  return (
    <>
    <AppShell
      header={<DashboardHeader title="Profile" />}
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page"
    >
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "landing" ? (
          /* Landing scrolls inside a PullToRefreshWrapper so swiping
             down re-syncs the profile, Stripe status, stats + reviews. */
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 pt-3 lg:pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)]"
          >
            <ProfileLanding
              profile={profile}
              userId={userId}
              displayName={displayName}
              initials={initials}
              avatarBroken={avatarBroken}
              setAvatarBroken={setAvatarBroken}
              avgRating={avgRating}
              reviewCount={reviewCount}
              postedCount={postedCount}
              completedCount={completedCount}
              stripeConnectStatus={stripeConnectStatus}
              onSelectTab={(key) => setTab(key as Tab)}
              onNavigate={navigate}
              /* Inline job lists now load via an enabled-gated query that
                 fires when the posted/completed tab opens, so the prior
                 imperative prefetch is a no-op. */
              onLoadInlineJobs={() => {}}
              onRequestDelete={() => { setDeleteStep(1); setDeleteConfirmText(""); setShowDeleteAccountDialog(true); }}
              onRequestLogout={() => setShowLogoutDialog(true)}
              reviewsPreview={reviews.slice(0, 2)}
              statsError={statsQuery.isError}
              reviewsError={reviewsQuery.isError}
              onRetryStats={() => { statsQuery.refetch(); }}
              onRetryReviews={() => { reviewsQuery.refetch(); }}
              earningsSparkline={earningsSparkline}
              totalEarnings={totalEarnings}
              seniorMode={seniorMode}
              onToggleSeniorMode={handleToggleSeniorMode}
            />
          </PullToRefreshWrapper>
        ) : (
          /* Non-landing tabs — own inner scroll surface. The
             SectionBoundary keyed on `tab` isolates a render error in
             any one tab so it never red-screens the profile chrome
             (header, back button, tab list). The boundary is rebuilt
             every time the user switches tabs so the previous tab's
             error state is cleared automatically. */
          <div className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto h-full overflow-y-auto pt-3 lg:pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)]">
          <SectionBoundary key={tab} label={`the ${tab.replace(/_/g, " ")} section`}>
          {/* `key={tab}` on the boundary re-mounts this wrapper on every
              tab switch, so `animate-ds-page-in` replays its entrance each
              time a panel opens (S18 polish). */}
          <div className="animate-ds-page-in">
          <ProfileTabPanels
            tab={tab}
            user={user}
            profile={profile}
            setTab={setTab}
            setProfile={setProfile}
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
            onSave={handleSave}
            onAvatarUpload={handleAvatarUpload}
            onIdUpload={handleIdUpload}
            earningsQuery={earningsQuery}
            scheduleQuery={scheduleQuery}
            inlineJobsQuery={inlineJobsQuery}
            reviewsQuery={reviewsQuery}
            violationsQuery={violationsQuery}
            earningsJobs={earningsJobs}
            tips={tips}
            schedulePostedJobs={schedulePostedJobs}
            scheduleAssignedJobs={scheduleAssignedJobs}
            inlinePostedJobs={inlinePostedJobs}
            inlineCompletedJobs={inlineCompletedJobs}
            reviews={reviews}
            violations={violations}
            totalEarnings={totalEarnings}
            avgRating={avgRating}
            reviewCount={reviewCount}
          />
          </div>
          </SectionBoundary>
          </div>
        )}
      </div>
    </AppShell>

    <BrandConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="Log out?"
        description="You can sign back in anytime — your account stays intact."
        primaryLabel="Log out"
        primaryTone="bark"
        primaryHaptic="medium"
        onPrimary={handleLogout}
        secondaryLabel="Stay signed in"
      />

      {/* Mounted only once the user opens it — the dialog chunk (and its
          confirm-flow deps) is fetched on demand rather than with the route. */}
      {showDeleteAccountDialog && (
        <Suspense fallback={null}>
          <DeleteAccountDialog
            open={showDeleteAccountDialog}
            onOpenChange={setShowDeleteAccountDialog}
            deleteStep={deleteStep}
            setDeleteStep={setDeleteStep}
            deleteConfirmText={deleteConfirmText}
            setDeleteConfirmText={setDeleteConfirmText}
            deletingAccount={deletingAccount}
            onDelete={handleDeleteAccount}
          />
        </Suspense>
      )}
    </>
  );
};

export default ProfilePage;
