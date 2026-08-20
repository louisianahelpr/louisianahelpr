import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { stripeConnectStatusKey } from "@/hooks/useStripeConnectStatus";
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
import { TAB_TITLES, type Profile, type Tab } from "./profile/types";
const DeleteAccountDialog = lazy(() => import("@/components/profile/DeleteAccountDialog").then(m => ({ default: m.DeleteAccountDialog })));

/**
 * Profile-landing scroll offsets, keyed by history entry.
 *
 * MEASURED ON DEVICE, not assumed. An on-screen probe reported
 * `shell=NONE ref=1009 win=0` while the list was scrolled: `.app-shell-scroll`
 * does not exist on /profile (AppShell is `scrollable={false}` here), the
 * PullToRefreshWrapper below IS the scroller, and window.scrollY is always 0.
 * That is why the global ScrollToTop — which resolves its scroller via
 * `document.querySelector(".app-shell-scroll")` and otherwise falls back to the
 * window — recorded 0 for every profile entry and had nothing to restore.
 *
 * An earlier attempt keyed on `location.key` and still failed, because back was
 * a PUSH at the time (seven sub-pages passed `onBack={() => navigate("/profile")}`)
 * and a push mints a NEW key, so the saved offset was never looked up. That is
 * fixed (PageHeader `backTo`), so the key is stable across the round trip.
 */
const profileScrollByKey = new Map<string, number>();

const ProfilePage = () => {
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

  // One title per tab. Every one of the 18 tabs used to report the same
  // "My Profile — Helpr", so browser history, bookmarks and the tab bar could
  // not tell Security from Payment from Legal. `?tab=` is already the URL
  // source of truth (synced both ways below), so the title follows it.
  // TAB_TITLES has no `landing` key — the bare profile page keeps the plain
  // title rather than repeating itself.
  usePageTitle(
    tab === "landing" || !TAB_TITLES[tab]
      ? "My Profile — Helpr"
      : `${TAB_TITLES[tab]} — My Profile — Helpr`,
  );

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
  // Availability is its own tab again and renders no job list, so it no
  // longer needs the schedule fetch — only the calendar tab does.
  const scheduleQuery = useProfileSchedule(userId, tab === "schedule");
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
          // The comment above has always claimed pull-to-refresh re-syncs the
          // Stripe-connect status; until this line it did not — the old effect
          // was guarded on `!stripeConnectStatus`, so once it had any answer
          // (including a failed one) nothing could re-ask.
          queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) }),
        ]);
      }
    },
  });

  // Preserve the landing list's scroll position across a round trip into any
  // profile sub-page. See profileScrollByKey above for why the global handler
  // cannot do this for /profile.
  const routeLocation = useLocation();
  const routeKey = routeLocation.key;
  useEffect(() => {
    // `loading` is in the deps deliberately. Profile early-returns a SKELETON
    // while loading, so PullToRefreshWrapper — and therefore containerRef — does
    // not exist on first mount. Without this dep the effect bailed on the null
    // ref and never re-ran when the real list appeared, so the scroll listener
    // was never attached and nothing was ever saved. That is what defeated the
    // previous attempt at this fix, verified on device.
    if (loading || tab !== "landing") return;
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const target = profileScrollByKey.get(routeKey) ?? 0;
    if (target > 0) {
      // Rows depend on async data, so the list's full height does not exist for
      // several frames; assigning scrollTop once clamps to the short content.
      let frames = 0;
      const apply = () => {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(target, Math.max(0, max));
        if (max < target && ++frames < 40) raf = requestAnimationFrame(apply);
      };
      apply();
    }

    const onScroll = () => { profileScrollByKey.set(routeKey, el.scrollTop); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [loading, tab, routeKey, containerRef]);

  // Stripe payout status is fetched by `useStripeConnectStatus()` inside
  // <ProfileLanding />, not here — it used to be a `useState` + `useEffect`
  // pair on this page that could not start until `profile` had been set, and
  // that re-asked Stripe on every single mount. What stays here is the other
  // half of caching it: the two moments the answer can actually have changed.
  //
  // Leaving the Payment tab is one of them — that is where the user finishes
  // (or repairs) payout onboarding, so the landing's cached "no payout
  // account" verdict is exactly what would otherwise go on lying to them.
  // Invalidating an unmounted query is fine: it marks the key stale and the
  // refetch happens when the landing next mounts.
  const prevTabRef = useRef<Tab>(tab);
  useEffect(() => {
    const leftPaymentTab = prevTabRef.current === "payment" && tab !== "payment";
    prevTabRef.current = tab;
    if (leftPaymentTab && userId) {
      queryClient.invalidateQueries({ queryKey: stripeConnectStatusKey(userId) });
    }
  }, [tab, userId, queryClient]);

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
    if (error) { hapticError(); toast.error("We couldn't save your profile — please try again."); }
    else {
      setFullName(merged);
      setJustSaved(true);
      hapticSuccess();
      toast.success("Profile updated");
      setTimeout(() => setJustSaved(false), 1800);
    }
  };

  const handleIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("That file is over 5 MB — try a smaller one."); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("That file type isn't supported — use JPG, PNG, WEBP, or PDF."); return; }
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
    if (!file.type.startsWith("image/")) { toast.error("That doesn't look like an image — try JPG or PNG."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("That image is over 5 MB — try a smaller one."); return; }

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
      toast.success("Profile picture updated");
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
        scrollable={false}
        contentClassName="overflow-hidden"
        className="bg-premium-page"
      >
        <div className="container mx-auto px-5 lg:px-8 xl:px-12 pb-4 flex-1 min-h-0 overflow-y-auto" style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 1rem)" }}>
          <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto">
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
      
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page"
    >
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden" style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 0.75rem)" }}>
        {tab === "landing" ? (
          /* Landing scrolls inside a PullToRefreshWrapper so swiping
             down re-syncs the profile, Stripe status, stats + reviews. */
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 pt-3 lg:pt-5 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]"
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
            />
          </PullToRefreshWrapper>
        ) : (
          /* Non-landing tabs — own inner scroll surface. The
             SectionBoundary keyed on `tab` isolates a render error in
             any one tab so it never red-screens the profile chrome
             (header, back button, tab list). The boundary is rebuilt
             every time the user switches tabs so the previous tab's
             error state is cleared automatically. */
          <div className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto h-full overflow-y-auto pt-3 lg:pt-5 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]">
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
            seniorMode={seniorMode}
            onToggleSeniorMode={handleToggleSeniorMode}
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
