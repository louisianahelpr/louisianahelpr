import { useEffect, useState, lazy, Suspense } from "react";
import HelprMark from "@/components/HelprMark";
import { formatName } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import ReferralSection from "@/components/ReferralSection";
import NotificationPreferences from "@/components/NotificationPreferences";
import { PaymentTab } from "@/components/PaymentTab";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { lookupParishByZip } from "@/lib/parishLookup";

// Lazy-loaded tab components — keeps Profile.tsx initial bundle under 200KB.
// Each tab is only fetched the first time the user clicks it.
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";
import { SecurityTab } from "@/components/profile/SecurityTab";
import { JobListTab } from "@/components/profile/JobListTab";
import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { ProfileLanding } from "@/components/profile/ProfileLanding";
const SupportInline = lazy(() => import("@/components/profile/SupportInline").then(m => ({ default: m.SupportInline })));
const SubscriptionTab = lazy(() => import("@/components/profile/SubscriptionTab").then(m => ({ default: m.SubscriptionTab })));
const LegalTab = lazy(() => import("@/components/profile/LegalTab").then(m => ({ default: m.LegalTab })));
import { EarningsTab } from "@/components/profile/EarningsTab";
import { ScheduleTab } from "@/components/profile/ScheduleTab";
import { AvailabilityTab } from "@/components/profile/AvailabilityTab";
const ReviewsTab = lazy(() => import("@/components/profile/ReviewsTab").then(m => ({ default: m.ReviewsTab })));
const WarningsTab = lazy(() => import("@/components/profile/WarningsTab").then(m => ({ default: m.WarningsTab })));
const CredentialsTab = lazy(() => import("@/components/profile/CredentialsTab").then(m => ({ default: m.CredentialsTab })));

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

type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings" | "credentials";

const ProfilePage = () => {
  usePageTitle("My Profile — Helpr");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user: cachedUser, profile: cachedProfile, isLoading: authLoading } = useCurrentUser();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const initialTab = (searchParams.get("tab") as Tab) || "landing";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [activeMenuGroup, setActiveMenuGroup] = useState<string | null>("Account");

  // Sync tab to URL for bookmarkability and browser back
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    if (tab === "landing") {
      newParams.delete("tab");
    } else {
      newParams.set("tab", tab);
    }
    const newUrl = newParams.toString() ? `?${newParams.toString()}` : window.location.pathname;
    window.history.pushState(null, "", newUrl);
  }, [tab]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab") as Tab | null;
      setTab(urlTab || "landing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const urlTab = (searchParams.get("tab") as Tab) || "landing";
    setTab((prev) => (prev === urlTab ? prev : urlTab));
  }, [searchParams]);

  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null>(null);
  const [, setStripeConnectLoading] = useState(false);
  

  // Stats
  const [completedCount, setCompletedCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [, setTotalJobEarnings] = useState(0);
  const [, setTotalTipEarnings] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  // Reviews
  const [reviews, setReviews] = useState<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

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

  const loadViolations = async () => {
    if (!user || violationsLoaded) return;
    setViolationsLoading(true);
    const { data } = await supabase.from("user_violations").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
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
        const _parts = (cachedProfile.full_name || "").trim().split(/\s+/);
        setFirstName(_parts[0] || "");
        setLastName(_parts.slice(1).join(" ") || "");
        setPhone(cachedProfile.phone || "");
        setLocation(cachedProfile.location || "");
        setZipCode((cachedProfile as any).zip_code || "");
        setParish((cachedProfile as any).parish || null);
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
    const [helperJobsRes, reviewsRes, postedRes, tipsStatsRes, completedJobIdsRes] = await Promise.all([
      supabase.from("jobs").select("budget, platform_fee_amount, urgent_fee").eq("helper_id", userId).eq("status", "completed"),
      supabase.from("reviews").select("rating").eq("reviewee_id", userId).lte("feedback_visible_at", new Date().toISOString()),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId),
      supabase.from("tips").select("amount, job_id").eq("helper_id", userId),
      supabase.from("jobs").select("id").eq("helper_id", userId).eq("status", "completed"),
    ]);
    const completedIds = new Set((completedJobIdsRes.data || []).map(j => j.id));
    if (helperJobsRes.data) {
      setCompletedCount(helperJobsRes.data.length);
      const jobEarnings = helperJobsRes.data.reduce((s, j) => {
        const fee = j.platform_fee_amount || 0;
        return s + (j.budget - fee + (j.urgent_fee ?? 0));
      }, 0);
      setTotalJobEarnings(jobEarnings);
    }
    const tipEarnings = (tipsStatsRes.data || []).filter(t => completedIds.has(t.job_id)).reduce((s, t) => s + (t.amount || 0), 0);
    setTotalTipEarnings(tipEarnings);
    setPostedCount(postedRes.count || 0);
    if (reviewsRes.data && reviewsRes.data.length > 0) {
      setAvgRating(reviewsRes.data.reduce((s, r) => s + r.rating, 0) / reviewsRes.data.length);
      setReviewCount(reviewsRes.data.length);
    }
  };

  const loadReviews = async () => {
    if (!user) return;
    setReviewsLoading(true);
    const { data } = await supabase
      .from("reviews")
      .select("rating, punctuality, quality, communication, feedback, created_at, reviewer_id, job_id, jobs!inner(status)")
      .eq("reviewee_id", user.id)
      .lte("feedback_visible_at", new Date().toISOString())
      .neq("jobs.status", "cancelled")
      .order("created_at", { ascending: false });

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
    if (tab === "landing" && reviews.length === 0 && !reviewsLoading) loadReviews();
  }, [tab, user]);

  useEffect(() => {
    if (profile?.approval_status === "approved" && !stripeConnectStatus) {
      checkStripeConnect();
    }
  }, [profile]);

  const checkStripeConnect = async () => {
    setStripeConnectLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "status" } });
      if (error) throw error;
      setStripeConnectStatus(data);
    } catch {
      setStripeConnectStatus({ connected: false, details_submitted: false, payouts_enabled: false });
    } finally {
      setStripeConnectLoading(false);
    }
  };


  const loadEarnings = async () => {
    if (!user) return;
    setEarningsLoading(true);
    const [jobsRes, tipsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("helper_id", user.id).neq("status", "cancelled").order("created_at", { ascending: false }),
      supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", user.id),
    ]);
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
    const [posted, assigned] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).in("status", ["open", "accepted", "in_progress"]).order("date_needed"),
      supabase.from("jobs").select("*").eq("helper_id", user.id).in("status", ["accepted", "in_progress"]).order("date_needed"),
    ]);
    if (posted.data) setSchedulePostedJobs(posted.data);
    if (assigned.data) setScheduleAssignedJobs(assigned.data);
    setScheduleLoading(false);
  };

  const loadInlineJobs = async () => {
    if (!user || inlineJobsLoaded) return;
    const [posted, completed] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("jobs").select("*").or(`customer_id.eq.${user.id},helper_id.eq.${user.id}`).eq("status", "completed").order("created_at", { ascending: false }).limit(20),
    ]);
    if (posted.data) setInlinePostedJobs(posted.data);
    if (completed.data) setInlineCompletedJobs(completed.data);
    setInlineJobsLoaded(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (error) toast.error(error.message);
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
    if (updErr) toast.error("Failed to save ID");
    else {
      setProfile(prev => prev ? ({ ...prev, id_document_url: path, idv_status: "pending" }) : prev);
      toast.success("ID submitted for review");
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
      toast.error("Failed to save avatar");
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
    if (deleteConfirmText !== "DELETE MY ACCOUNT") return;
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
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center gap-2 h-16 px-4">
            <HelprMark to="/dashboard" size="md" />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-4">
          <div className="max-w-lg mx-auto">
            <ProfilePageSkeleton />
          </div>
        </main>
      </div>
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
      scrollable={tab === "landing"}
      contentClassName={tab === "landing" ? undefined : "overflow-hidden"}
      className="bg-premium-page"
    >
      <main
        className={tab === "landing"
          ? "container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-0 flex flex-col"
          : "container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden"}
      >
        <div className={tab === "landing"
          ? "w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex flex-col gap-3 lg:gap-4"
          : "w-full max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto h-full overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)]"}>

          {/* LANDING VIEW — two-box layout matching Dashboard / Activity / Messages */}
          {tab === "landing" && (
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
              activeMenuGroup={activeMenuGroup}
              setActiveMenuGroup={setActiveMenuGroup}
              onSelectTab={(key) => setTab(key as Tab)}
              onNavigate={navigate}
              onLoadInlineJobs={loadInlineJobs}
              onRequestDelete={() => { setDeleteStep(1); setDeleteConfirmText(""); setShowDeleteAccountDialog(true); }}
              onRequestLogout={() => setShowLogoutDialog(true)}
              reviewsPreview={reviews.slice(0, 2)}
            />
          )}

          {/* PROFILE TAB */}
          {tab === "profile" && (
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
              onPortfolioChange={(urls) => setProfile((prev) => prev ? ({ ...prev, portfolio_urls: urls } as any) : prev)}
            />
          )}


          {/* EXTRACTED TAB COMPONENTS — lazy loaded */}
          {tab === "earnings" && user && (
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
          )}

          {tab === "schedule" && user && (
            <Suspense fallback={<TabFallback />}>
              <ScheduleTab postedJobs={schedulePostedJobs} assignedJobs={scheduleAssignedJobs} loading={scheduleLoading} userId={user.id} onBack={() => setTab("landing")} />
            </Suspense>
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
                meta="Cards, bank accounts, payouts"
                onBack={() => setTab("landing")}
              />
              <PaymentTab
                earningsJobs={earningsJobs}
                totalEarnings={totalEarnings}
                onSeeEarnings={() => setTab("earnings")}
              />
            </div>
          )}

          {tab === "subscription" && (
            <Suspense fallback={<TabFallback />}>
              <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "posted_jobs" && (
            <JobListTab variant="posted" jobs={inlinePostedJobs} onBack={() => setTab("landing")} />
          )}

          {tab === "completed_jobs" && (
            <JobListTab variant="completed" jobs={inlineCompletedJobs} onBack={() => setTab("landing")} />
          )}

          {tab === "support" && (
            <Suspense fallback={<TabFallback />}>
              <SupportInline userId={user?.id} onBack={() => setTab("landing")} />
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
              <NotificationPreferences />
            </div>
          )}

          {tab === "security" && (
            <SecurityTab email={user?.email} onBack={() => setTab("landing")} />
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
              <ReferralSection userId={user.id} />
            </div>
          )}

          {tab === "legal" && (
            <Suspense fallback={<TabFallback />}>
              <LegalTab onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "warnings" && (
            <Suspense fallback={<TabFallback />}>
              <WarningsTab violations={violations} loading={violationsLoading} onBack={() => setTab("landing")} />
            </Suspense>
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
      </main>
    </AppShell>

    <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle
              className="font-display italic font-bold text-center"
              style={{
                fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.65rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Log out?
            </AlertDialogTitle>
            <AlertDialogDescription
              className="text-center font-serif italic text-ds-13"
              style={{ color: "hsl(var(--olivewood) / 0.75)" }}
            >
              You can sign back in anytime — your account stays intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-col-reverse gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 rounded-ds-md border-border/60">
              Stay signed in
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="rounded-ds-md"
              style={{
                // Bark (brand olive) — same primary tone used for Sign up
                // and Continue. Logout is reversible so it doesn't need
                // the warning sienna reserved for delete-account.
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(70 22% 24%)",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                boxShadow:
                  "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                  "0 1px 2px hsl(70 20% 18% / 0.22), " +
                  "0 6px 14px -4px hsl(var(--bark) / 0.4)",
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </>
  );
};

export default ProfilePage;
