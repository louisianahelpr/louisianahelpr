import { useEffect, useState, lazy, Suspense } from "react";
import { formatName } from "@/lib/utils";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { lookupParishByZip } from "@/lib/parishLookup";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { splitName } from "@/lib/splitName";
import { requireOnline } from "@/lib/requireOnline";

// Only the landing tab + its lightweight header are needed on first paint.
// Every other tab panel and the rarely-opened dialogs are code-split so the
// Profile route chunk stays small — each is fetched the first time it shows.
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileLanding } from "@/components/profile/ProfileLanding";
import { ProfileSectionError } from "@/components/profile/ProfileSectionError";
const DeleteAccountDialog = lazy(() => import("@/components/profile/DeleteAccountDialog").then(m => ({ default: m.DeleteAccountDialog })));
const SecurityTab = lazy(() => import("@/components/profile/SecurityTab").then(m => ({ default: m.SecurityTab })));
const JobListTab = lazy(() => import("@/components/profile/JobListTab").then(m => ({ default: m.JobListTab })));
const ProfileEditForm = lazy(() => import("@/components/profile/ProfileEditForm").then(m => ({ default: m.ProfileEditForm })));
const SupportInline = lazy(() => import("@/components/profile/SupportInline").then(m => ({ default: m.SupportInline })));
const SavedHelpersTab = lazy(() => import("@/components/profile/SavedHelpersTab").then(m => ({ default: m.SavedHelpersTab })));
const SubscriptionTab = lazy(() => import("@/components/profile/SubscriptionTab").then(m => ({ default: m.SubscriptionTab })));
const LegalTab = lazy(() => import("@/components/profile/LegalTab").then(m => ({ default: m.LegalTab })));
const EarningsTab = lazy(() => import("@/components/profile/EarningsTab").then(m => ({ default: m.EarningsTab })));
const ScheduleTab = lazy(() => import("@/components/profile/ScheduleTab").then(m => ({ default: m.ScheduleTab })));
const AvailabilityTab = lazy(() => import("@/components/profile/AvailabilityTab").then(m => ({ default: m.AvailabilityTab })));
const ReviewsTab = lazy(() => import("@/components/profile/ReviewsTab").then(m => ({ default: m.ReviewsTab })));
const WarningsTab = lazy(() => import("@/components/profile/WarningsTab").then(m => ({ default: m.WarningsTab })));
const CredentialsTab = lazy(() => import("@/components/profile/CredentialsTab").then(m => ({ default: m.CredentialsTab })));
const PaymentTab = lazy(() => import("@/components/PaymentTab").then(m => ({ default: m.PaymentTab })));
const NotificationPreferences = lazy(() => import("@/components/NotificationPreferences"));
const ReferralSection = lazy(() => import("@/components/ReferralSection"));

const TabFallback = () => (
  <div className="space-y-4">
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <div className="h-5 w-32 rounded bg-muted/40 animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-muted/30 animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-muted/30 animate-pulse" />
    </div>
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <div className="h-4 w-1/3 rounded bg-muted/30 animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-muted/30 animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-muted/30 animate-pulse" />
    </div>
  </div>
);

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings" | "credentials" | "saved_helpers";

const ProfilePage = () => {
  usePageTitle("My Profile — Helpr");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: cachedUser, profile: cachedProfile, isLoading: authLoading, refresh: refreshCurrentUser } = useCurrentUser();
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

  // Per-section load errors. Each Profile sub-section loads independently;
  // a failure in one must NOT surface as a page-level "couldn't load your
  // profile" banner when the core profile (name, avatar) loaded fine.
  // Instead each failed section shows a small inline error scoped to it.
  type SectionKey = "stats" | "reviews" | "inlineJobs" | "earnings" | "schedule" | "violations";
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<SectionKey, boolean>>>({});
  const setSectionError = (key: SectionKey, failed: boolean) =>
    setSectionErrors((prev) => (prev[key] === failed ? prev : { ...prev, [key]: failed }));

  // Stats
  const [completedCount, setCompletedCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  // Reviews
  const [reviews, setReviews] = useState<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);

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

  // Earnings state
  const [earningsJobs, setEarningsJobs] = useState<Job[]>([]);
  const [tips, setTips] = useState<{ amount: number; job_id: string; created_at: string }[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Schedule state
  const [schedulePostedJobs, setSchedulePostedJobs] = useState<Job[]>([]);
  const [scheduleAssignedJobs, setScheduleAssignedJobs] = useState<Job[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Inline job lists on landing
  const [inlinePostedJobs, setInlinePostedJobs] = useState<Job[]>([]);
  const [inlineCompletedJobs, setInlineCompletedJobs] = useState<Job[]>([]);
  const [inlineJobsLoaded, setInlineJobsLoaded] = useState(false);

  // Warnings & violations
  type Violation = { id: string; violation_type: string; description: string | null; action_taken: string; created_at: string | null; job_id: string | null };
  const [violations, setViolations] = useState<Violation[]>([]);
  const [violationsLoading, setViolationsLoading] = useState(false);
  const [violationsLoaded, setViolationsLoaded] = useState(false);

  const loadViolations = async ({ force = false }: { force?: boolean } = {}) => {
    if (!user || (violationsLoaded && !force)) return;
    setViolationsLoading(true);
    setSectionError("violations", false);
    const { data, error } = await supabase.from("user_violations").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) {
      console.error("[Profile] loadViolations failed:", error);
      setSectionError("violations", true);
      setViolationsLoading(false);
      return;
    }
    setViolations(data || []);
    setViolationsLoaded(true);
    setViolationsLoading(false);
  };

  useEffect(() => { if (tab === "warnings") loadViolations(); }, [tab]);

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
      }
      setLoading(false);
      loadStats(cachedUser.id);
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

  const loadStats = async (userId: string) => {
    setSectionError("stats", false);
    const [helperJobsRes, reviewsRes, postedRes] = await Promise.all([
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("helper_id", userId).eq("status", "completed"),
      supabase.from("reviews").select("rating").eq("reviewee_id", userId).lte("feedback_visible_at", new Date().toISOString()),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId),
    ]);
    const statsError = helperJobsRes.error || reviewsRes.error || postedRes.error;
    if (statsError) {
      console.error("[Profile] loadStats failed:", statsError);
      setSectionError("stats", true);
      return;
    }
    setCompletedCount(helperJobsRes.count || 0);
    setPostedCount(postedRes.count || 0);
    if (reviewsRes.data && reviewsRes.data.length > 0) {
      setAvgRating(reviewsRes.data.reduce((s, r) => s + r.rating, 0) / reviewsRes.data.length);
      setReviewCount(reviewsRes.data.length);
    }
  };

  const loadReviews = async ({ force = false }: { force?: boolean } = {}) => {
    if (!user) return;
    // In-flight / loaded guard so the landing-tab effect fetches once.
    // Pull-to-refresh passes { force: true } to deliberately re-sync.
    if (!force && (reviewsLoading || reviewsLoaded)) return;
    setReviewsLoading(true);
    setSectionError("reviews", false);
    const { data, error } = await supabase
      .from("reviews")
      .select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, jobs!inner(status)")
      .eq("reviewee_id", user.id)
      .lte("feedback_visible_at", new Date().toISOString())
      .neq("jobs.status", "cancelled")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Profile] loadReviews failed:", error);
      setSectionError("reviews", true);
      setReviewsLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const reviewerIds = [...new Set(data.map((r) => r.reviewer_id))];
      const jobIds = [...new Set(data.map((r) => r.job_id))];
      const [profilesRes, jobsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
        supabase.from("jobs").select("id, title").in("id", jobIds),
      ]);
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
      const jobMap = new Map(jobsRes.data?.map((j) => [j.id, j.title]) || []);
      setReviews(data.map((r: any) => ({
        rating: r.rating,
        punctuality: r.punctuality ?? null,
        quality: r.quality ?? null,
        communication: r.communication ?? null,
        feedback: r.feedback,
        created_at: r.created_at,
        reviewerName: nameMap.get(r.reviewer_id) || "User",
        jobTitle: jobMap.get(r.job_id) || "Job",
      })));
    } else {
      setReviews([]);
    }
    setReviewsLoaded(true);
    setReviewsLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    if (tab === "earnings") loadEarnings();
    if (tab === "schedule") loadSchedule();
    if (tab === "reviews") loadReviews();
    // Landing page surfaces a 2-review preview on the hero card.
    // Fetch the same data lazily on first landing-tab mount so the
    // preview appears without making the user open the reviews tab.
    // loadReviews() has an in-flight/loaded guard so this fetches once.
    if (tab === "landing") loadReviews();
  }, [tab, user]);

  // Pull-to-refresh for the Profile landing — re-syncs the profile,
  // Stripe-connect status, helper stats, and review preview. Scoped to
  // the landing's scroll surface via PullToRefreshWrapper below.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await refreshCurrentUser();
      if (user) await loadStats(user.id);
      await loadReviews({ force: true });
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


  const loadEarnings = async () => {
    if (!user) return;
    setEarningsLoading(true);
    setSectionError("earnings", false);
    const [jobsRes, tipsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("helper_id", user.id).neq("status", "cancelled").order("created_at", { ascending: false }),
      supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", user.id),
    ]);
    if (jobsRes.error || tipsRes.error) {
      console.error("[Profile] loadEarnings failed:", jobsRes.error || tipsRes.error);
      setSectionError("earnings", true);
      setEarningsLoading(false);
      return;
    }
    if (jobsRes.data) {
      setEarningsJobs(jobsRes.data);
      const completedJobIds = new Set(jobsRes.data.filter(j => j.status === "completed").map(j => j.id));
      if (tipsRes.data) setTips(tipsRes.data.filter(t => completedJobIds.has(t.job_id)));
    } else if (tipsRes.data) {
      setTips(tipsRes.data);
    }
    setEarningsLoading(false);
  };

  const loadSchedule = async () => {
    if (!user) return;
    setScheduleLoading(true);
    setSectionError("schedule", false);
    const [posted, assigned] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).in("status", ["open", "accepted", "in_progress"]).order("date_needed"),
      supabase.from("jobs").select("*").eq("helper_id", user.id).in("status", ["accepted", "in_progress"]).order("date_needed"),
    ]);
    if (posted.error || assigned.error) {
      console.error("[Profile] loadSchedule failed:", posted.error || assigned.error);
      setSectionError("schedule", true);
      setScheduleLoading(false);
      return;
    }
    if (posted.data) setSchedulePostedJobs(posted.data);
    if (assigned.data) setScheduleAssignedJobs(assigned.data);
    setScheduleLoading(false);
  };

  const loadInlineJobs = async ({ force = false }: { force?: boolean } = {}) => {
    if (!user || (inlineJobsLoaded && !force)) return;
    setSectionError("inlineJobs", false);
    const [posted, completed] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("jobs").select("*").or(`customer_id.eq.${user.id},helper_id.eq.${user.id}`).eq("status", "completed").order("created_at", { ascending: false }).limit(20),
    ]);
    if (posted.error || completed.error) {
      console.error("[Profile] loadInlineJobs failed:", posted.error || completed.error);
      setSectionError("inlineJobs", true);
      return;
    }
    if (posted.data) setInlinePostedJobs(posted.data);
    if (completed.data) setInlineCompletedJobs(completed.data);
    setInlineJobsLoaded(true);
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
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Use JPG, PNG, WEBP or PDF"); return; }
    setIdUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/id-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("id-documents").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Upload failed: " + upErr.message); setIdUploading(false); return; }
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
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }

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
      toast.error("Upload failed: " + uploadError.message);
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
  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };
  const handleDeleteAccount = async () => {
    // The dialog asks the user to type "DELETE" (short, thumb-friendly).
    // The delete-own-account edge function still validates against the
    // legacy "DELETE MY ACCOUNT" phrase server-side, so we map here —
    // server contract is unchanged.
    if (deleteConfirmText !== "DELETE") return;
    setDeletingAccount(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account", {
        body: { confirmation: "DELETE MY ACCOUNT" },
      });
      if (error) throw error;
      toast.success("Account deleted successfully");
      await supabase.auth.signOut();
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete account");
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
        header={<DashboardHeader />}
        scrollable={false}
        contentClassName="overflow-hidden"
        className="bg-premium-page"
      >
        <main className="container mx-auto px-5 lg:px-8 xl:px-12 py-4 flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-lg mx-auto">
            <ProfilePageSkeleton />
          </div>
        </main>
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
  const totalEarnings = earningsJobs.filter((j) => j.status === "completed").reduce((sum, j) => {
    const fee = j.platform_fee_amount || 0;
    const feeTax = fee * 0.085;
    return sum + (j.budget - fee - feeTax + (j.urgent_fee ?? 0));
  }, 0);

  return (
    <>
    <AppShell
      header={<DashboardHeader />}
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page"
    >
      <main className="container mx-auto px-5 lg:px-8 xl:px-12 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
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
              onLoadInlineJobs={loadInlineJobs}
              onRequestDelete={() => { setDeleteStep(1); setDeleteConfirmText(""); setShowDeleteAccountDialog(true); }}
              onRequestLogout={() => setShowLogoutDialog(true)}
              reviewsPreview={reviews.slice(0, 2)}
              statsError={!!sectionErrors.stats}
              reviewsError={!!sectionErrors.reviews}
              onRetryStats={() => { if (user) loadStats(user.id); }}
              onRetryReviews={() => loadReviews({ force: true })}
            />
          </PullToRefreshWrapper>
        ) : (
          /* Non-landing tabs — own inner scroll surface. */
          <div className="w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto h-full overflow-y-auto pt-3 lg:pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)]">

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
                onSave={handleSave}
                onAvatarUpload={handleAvatarUpload}
                onIdUpload={handleIdUpload}
                onBack={() => setTab("landing")}
                onPortfolioChange={(urls) => setProfile((prev) => prev ? ({ ...prev, portfolio_urls: urls }) : prev)}
                onContactSupport={() => setTab("support")}
              />
            </Suspense>
          )}


          {/* EXTRACTED TAB COMPONENTS — lazy loaded */}
          {tab === "earnings" && user && (
            <div className="space-y-3">
              {sectionErrors.earnings && (
                <ProfileSectionError section="your earnings" onRetry={loadEarnings} />
              )}
              <Suspense fallback={<TabFallback />}>
                <EarningsTab
                  earningsJobs={earningsJobs}
                  tips={tips}
                  loading={earningsLoading}
                  onBack={() => setTab("landing")}
                  helperId={user.id}
                  helperName={profile?.full_name || user.email || "Helpr"}
                />
              </Suspense>
            </div>
          )}

          {tab === "schedule" && user && (
            <div className="space-y-3">
              {sectionErrors.schedule && (
                <ProfileSectionError section="your schedule" onRetry={loadSchedule} />
              )}
              <Suspense fallback={<TabFallback />}>
                <ScheduleTab postedJobs={schedulePostedJobs} assignedJobs={scheduleAssignedJobs} loading={scheduleLoading} userId={user.id} onBack={() => setTab("landing")} />
              </Suspense>
            </div>
          )}

          {tab === "availability" && user && (
            <Suspense fallback={<TabFallback />}>
              <AvailabilityTab userId={user.id} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "payment" && (
            <div className="space-y-4">
              <ProfileTabHeader
                eyebrow="Money"
                title="Payment settings"
                meta="Payouts & earnings"
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
              {sectionErrors.inlineJobs && (
                <ProfileSectionError section="your posted jobs" onRetry={() => loadInlineJobs({ force: true })} />
              )}
              <Suspense fallback={<TabFallback />}>
                <JobListTab variant="posted" jobs={inlinePostedJobs} onBack={() => setTab("landing")} />
              </Suspense>
            </div>
          )}

          {tab === "completed_jobs" && (
            <div className="space-y-3">
              {sectionErrors.inlineJobs && (
                <ProfileSectionError section="your completed jobs" onRetry={() => loadInlineJobs({ force: true })} />
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
                eyebrow="Inbox"
                title="Notifications"
                meta="Email, push, and SMS preferences"
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
              <ReviewsTab reviews={reviews} loading={reviewsLoading} avgRating={avgRating} reviewCount={reviewCount} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "referral" && user && (
            <div className="space-y-5">
              <ProfileTabHeader
                eyebrow="Invite friends"
                title="Referral program"
                meta="Earn credits when neighbors join"
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
              {sectionErrors.violations && (
                <ProfileSectionError
                  section="your warnings & strikes"
                  onRetry={() => loadViolations({ force: true })}
                />
              )}
              <Suspense fallback={<TabFallback />}>
                <WarningsTab violations={violations} loading={violationsLoading} onBack={() => setTab("landing")} />
              </Suspense>
            </div>
          )}

          {tab === "credentials" && user && (
            <div className="space-y-4">
              <ProfileTabHeader
                eyebrow="Trust"
                title="Licensed &amp; insured"
                meta="Verify your professional credentials"
                onBack={() => setTab("landing")}
              />
              <Suspense fallback={<TabFallback />}>
                <CredentialsTab userId={user.id} />
              </Suspense>
            </div>
          )}
          </div>
        )}
      </main>
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
