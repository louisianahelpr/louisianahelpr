import { useEffect, useState, lazy, Suspense } from "react";
import helprIcon from "@/assets/helpr-icon-96.png";
import { formatName } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, DollarSign, LogOut, MapPin,
  CreditCard, Shield, FileText, Mail, Lock, Upload, X,
  Star, Edit, CalendarDays, Clock, Gavel,
  ChevronRight as ChevronRightIcon,
  HelpCircle, Bell, AlertTriangle, Loader2, Heart, Crown, Camera,
  ShieldCheck, Trash2,
} from "lucide-react";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";
import ReferralSection from "@/components/ReferralSection";
import NotificationPreferences from "@/components/NotificationPreferences";
import { PaymentTab } from "@/components/PaymentTab";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getPublicResetPasswordUrl, getPublicSiteUrl } from "@/lib/authRedirects";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { lookupParishByZip } from "@/lib/parishLookup";

// Lazy-loaded tab components — keeps Profile.tsx initial bundle under 200KB.
// Each tab is only fetched the first time the user clicks it.
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
  <div className="flex items-center justify-center py-16">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
);

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type Tab = "landing" | "profile" | "earnings" | "schedule" | "availability" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings" | "credentials";

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

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
  const initialTab = (searchParams.get("tab") as Tab) || "landing";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [activeMenuGroup, setActiveMenuGroup] = useState<string | null>("Money");

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

  useEffect(() => {
    if (tab === "profile") {
      document.documentElement.classList.add("edit-profile-screen-lock");
      return () => document.documentElement.classList.remove("edit-profile-screen-lock");
    }
  }, [tab]);
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null>(null);
  const [, setStripeConnectLoading] = useState(false);
  

  // Stats
  const [completedCount, setCompletedCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [totalJobEarnings, setTotalJobEarnings] = useState(0);
  const [totalTipEarnings, setTotalTipEarnings] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  // Reviews
  const [reviews, setReviews] = useState<{ rating: number; punctuality: number | null; quality: number | null; communication: number | null; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Profile fields
  const [fullName, setFullName] = useState("");
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
    const { data } = await (supabase.from("user_violations" as any) as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false });
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

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("user_id", userId).single();
    if (data) {
      setProfile(data);
      setFullName(data.full_name || "");
      const _p = (data.full_name || "").trim().split(/\s+/);
      setFirstName(_p[0] || "");
      setLastName(_p.slice(1).join(" ") || "");
      setPhone(data.phone || "");
      setLocation(data.location || "");
      setZipCode((data as any).zip_code || "");
      setParish((data as any).parish || null);
      setBio(data.bio || "");
      setSkills(data.skills || "");
      setHourlyRate(data.hourly_rate?.toString() || "");
      setDateOfBirth(data.date_of_birth || "");
    }
    setLoading(false);
  };

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
      supabase.from("reviews").select("rating").eq("reviewee_id", userId),
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
    } as any).eq("user_id", user.id);
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
    const { error: updErr } = await supabase.from("profiles").update({ id_document_url: path, idv_status: "pending" } as any).eq("user_id", user.id);
    if (updErr) toast.error("Failed to save ID");
    else {
      setProfile(prev => prev ? ({ ...prev, id_document_url: path, idv_status: "pending" } as any) : prev);
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

    const { error: uploadError } = await supabase.storage
      .from("user-documents")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast.error("Upload failed: " + uploadError.message);
      setAvatarUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("user-documents").getPublicUrl(path);
    const avatarUrl = urlData.publicUrl + "?t=" + Date.now();

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("user_id", user.id);

    if (updateError) {
      toast.error("Failed to save avatar");
    } else {
      setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
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
            <img src={helprIcon} alt="Helpr" width={36} height={36} className="w-9 h-9 rounded-xl shadow-md" />
            <span className="text-2xl font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent leading-none">Helpr</span>
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

  const role = profile?.role || "customer";
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

  const menuGroups: { title: string; items: { key: Tab; label: string; icon: React.ReactNode; desc: string; href?: string }[] }[] = [
    {
      title: "Money",
      items: [
        { key: "payment", label: "Payout & Payments", icon: <CreditCard className="w-5 h-5" />, desc: "Bank account, payment methods & summary" },
        { key: "subscription", label: "Subscription", icon: <Crown className="w-5 h-5" />, desc: "Manage your Helpr plan" },
        { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits" },
      ],
    },
    {
      title: "Settings & Support",
      items: [
        { key: "security", label: "Account Security", icon: <Shield className="w-5 h-5" />, desc: "Email, password & login" },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history" },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us" },
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines" },
      ],
    },
  ];

  return (
    <>
    <AppShell
      header={<DashboardHeader />}
      scrollable={false}
      contentClassName="overflow-hidden"
    >
      <main className="mx-auto h-full max-w-5xl overflow-hidden px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)]">
        <div className={tab === "profile" ? "max-w-2xl mx-auto h-full overflow-hidden" : "max-w-2xl mx-auto h-full min-h-0 overflow-hidden"}>

          {/* LANDING VIEW */}
          {tab === "landing" && (
            <div className="h-full min-h-0 overflow-hidden space-y-3">


              {/* Compact Hero — single horizontal row, half-height */}
              <div className="relative rounded-[24px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] p-3.5">
                <button
                  onClick={() => setTab("profile")}
                  aria-label="Edit profile"
                  className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-secondary/60 hover:bg-secondary active:scale-95 flex items-center justify-center text-foreground/70 hover:text-foreground transition-all"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <div className="flex flex-row items-center gap-3.5 pr-10">
                  {/* Avatar — 70px squircle, left */}
                  <div className="w-[75px] h-[75px] rounded-[22px] squircle bg-primary/10 text-primary flex items-center justify-center text-xl font-bold overflow-hidden shrink-0">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                    ) : initials}
                  </div>
                  {/* Identity + integrated stats, all stacked tight on the right */}
                  <div className="flex-1 min-w-0 text-left">
                    <h1 className="font-display font-bold text-foreground truncate leading-tight text-2xl">
                      {displayName || "Welcome back"}
                    </h1>
                    {profile?.location && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{profile.location}</span>
                      </p>
                    )}
                    {/* Integrated stats — single inline line directly under location */}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <button
                        onClick={() => setTab("reviews")}
                        className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
                      >
                        <Star className="w-3 h-3 text-primary fill-primary" />
                        <span className="font-bold text-foreground">{avgRating ? avgRating.toFixed(1) : "5.0"}</span>
                        <span className="text-muted-foreground">({reviewCount})</span>
                      </button>
                      <span className="w-px h-3 bg-border/60" />
                      <button
                        onClick={() => { if (postedCount > 0) { loadInlineJobs(); setTab("posted_jobs"); } }}
                        className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
                      >
                        <span className="font-bold text-foreground">{postedCount}</span>
                        <span className="text-muted-foreground">Posted</span>
                      </button>
                      <span className="w-px h-3 bg-border/60" />
                      <button
                        onClick={() => { if (completedCount > 0) { loadInlineJobs(); setTab("completed_jobs"); } }}
                        className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
                      >
                        <span className="font-bold text-foreground">{completedCount}</span>
                        <span className="text-muted-foreground">Done</span>
                      </button>
                    </div>
                    {!profile?.full_name?.trim() && (
                      <button
                        onClick={() => setTab("profile")}
                        className="mt-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        + Add your name
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Payout Banner */}
              {profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
                <div className="rounded-[24px] border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">Set up your payout account</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Add a bank account in Payment Settings to accept jobs and receive payments.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => setTab("payment")} className="w-full" size="sm">
                    <CreditCard className="w-4 h-4 mr-2" /> Go to Payment Settings
                  </Button>
                </div>
              )}

              {/* Category buttons replace the old always-expanded long list. */}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2.5">
                  {menuGroups.map((group) => {
                    const isActive = activeMenuGroup === group.title;
                    const GroupIcon = group.title === "Account" ? Edit : group.title === "Money" ? DollarSign : HelpCircle;

                    return (
                      <button
                        key={group.title}
                        type="button"
                        onClick={() => setActiveMenuGroup(isActive ? null : group.title)}
                        className={`min-h-[78px] rounded-[20px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${isActive ? "ring-2 ring-primary/30 text-primary" : "text-foreground hover:bg-secondary/40"}`}
                        aria-expanded={isActive}
                      >
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${isActive ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground"}`}>
                          <GroupIcon className="w-4.5 h-4.5" />
                        </span>
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] leading-tight text-center">
                          {group.title === "Settings & Support" ? "Support" : group.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {activeMenuGroup && (() => {
                  const group = menuGroups.find((menuGroup) => menuGroup.title === activeMenuGroup);
                  if (!group) return null;

                  return (
                    <div>
                      <div className="rounded-[24px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] overflow-hidden">
                        {group.items.map((item, idx) => (
                          <button
                            key={item.label}
                            onClick={() => {
                              if (item.href) navigate(item.href);
                              else setTab(item.key);
                            }}
                            className="group/row w-full flex items-center justify-between gap-4 pl-5 pr-4 py-3.5 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                          >
                            {idx > 0 && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute top-0 left-[68px] right-[15px] h-px bg-border/60"
                              />
                            )}
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-muted/60 text-muted-foreground flex items-center justify-center shrink-0 transition-colors group-hover/row:bg-primary/10 group-hover/row:text-primary">
                                {item.icon}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground leading-tight">{item.label}</p>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                              </div>
                            </div>
                            <span className="w-5 flex items-center justify-center shrink-0">
                              <ChevronRightIcon className="w-4 h-4 text-muted-foreground/70" strokeWidth={2.25} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Account actions — compact pair */}
              <div className="pt-1 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => { setDeleteStep(1); setDeleteConfirmText(""); setShowDeleteAccountDialog(true); }}
                  className="rounded-[20px] bg-destructive/10 border border-destructive/40 hover:bg-destructive/15 hover:border-destructive/60 py-3 inline-flex items-center justify-center gap-2 text-sm font-semibold text-destructive shadow-[0_1px_2px_hsl(0_60%_30%/0.06),0_8px_28px_-12px_hsl(0_60%_30%/0.18)] active:opacity-90 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoutDialog(true)}
                  className="rounded-[20px] bg-white shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] py-3 inline-flex items-center justify-center gap-2 text-sm font-semibold text-foreground hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            </div>
          )}

          {/* PROFILE TAB */}
          {tab === "profile" && (() => {
            const idStatus = (profile as any)?.idv_status as string | null;
            const hasId = !!(profile as any)?.id_document_url;
            const idBadge = idStatus === "verified"
              ? { label: "Verified", cls: "bg-green-500/10 text-green-600 dark:text-green-500" }
              : (idStatus === "pending" || idStatus === "processing" || idStatus === "manual_review" || (hasId && !idStatus))
              ? { label: "Pending review", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-500" }
              : idStatus === "failed"
              ? { label: "Action needed", cls: "bg-destructive/10 text-destructive" }
              : { label: "Not uploaded", cls: "bg-muted text-muted-foreground" };
            const bioOk = bio.trim().length >= 20;
            const ageOk = (() => {
              if (!dateOfBirth) return false;
              const d = new Date(dateOfBirth);
              if (isNaN(d.getTime())) return false;
              const t = new Date();
              let age = t.getFullYear() - d.getFullYear();
              const m = t.getMonth() - d.getMonth();
              if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
              return age >= 18;
            })();
              return (
              <div className="edit-profile-screen h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex items-center gap-2 shrink-0 mb-1.5">
                  <button onClick={() => setTab("landing")} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" aria-label="Back">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h1 className="text-base font-display font-bold text-foreground leading-tight">Edit profile</h1>
                </div>

                <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="relative group shrink-0">
                        {profile?.avatar_url ? (
                          <img src={profile.avatar_url} alt="Profile" className="w-12 h-12 rounded-full object-cover border-2 border-primary/20" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold border-2 border-primary/20">
                            {initials}
                          </div>
                        )}
                        <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                          {avatarUploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
                          <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                        </label>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground truncate">{`${firstName} ${lastName}`.trim() || "Your name"}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">Tap photo to change · Name locked</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-3">
                        <Label htmlFor="phone" className="text-[10px] leading-none mb-0.5">Phone</Label>
                        <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555 123 4567" className="h-7 text-sm" />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="location" className="text-[10px] leading-none mb-0.5">City</Label>
                        <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Baton Rouge" className="h-7 text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="zipCode" className="text-[10px] leading-none mb-0.5">ZIP</Label>
                        <Input
                          id="zipCode"
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                          placeholder="70801"
                          inputMode="numeric"
                          maxLength={5}
                          className="h-7 text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex-1 min-h-[64px] flex flex-col">
                      <Label htmlFor="bio" className="text-[10px] leading-none mb-0.5 flex items-center justify-between">
                        <span>About your work</span>
                        <span className={bioOk ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}>{bio.trim().length}/20</span>
                      </Label>
                      <Textarea
                        id="bio"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="What you do, tools you bring, what makes you reliable…"
                        className="flex-1 min-h-0 resize-none text-sm leading-snug py-2"
                      />
                    </div>

                    <div className="rounded-[16px] bg-white shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_24px_-12px_hsl(160_10%_12%/0.12)] p-2 flex items-center gap-2 shrink-0">
                      <Shield className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground flex items-center gap-2 flex-wrap leading-tight">
                          ID Verification
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${idBadge.cls}`}>{idBadge.label}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-snug">Encrypted &amp; reviewed by Helpr.</p>
                      </div>
                      <label className="shrink-0">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 h-8 rounded-[14px] bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 active:scale-[0.98] transition-all shadow-[0_1px_2px_hsl(160_10%_12%/0.06),0_6px_16px_-8px_hsl(var(--primary)/0.4)]">
                          {idUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                          {hasId ? "Replace" : "Upload"}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          className="hidden"
                          onChange={handleIdUpload}
                          disabled={idUploading}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="shrink-0 pt-2 grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setTab("landing")}
                      className="rounded-[20px] bg-white border border-border/40 shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] h-12 inline-flex items-center justify-center gap-2 text-sm font-semibold text-foreground hover:bg-secondary/40 active:scale-[0.98] transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || justSaved}
                      className={`col-span-2 rounded-[20px] h-12 inline-flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-[0.98] disabled:active:scale-100 shadow-[0_2px_4px_hsl(var(--primary)/0.15),0_12px_32px_-12px_hsl(var(--primary)/0.45)] ${
                        saving
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : justSaved
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground"
                      }`}
                    >
                      {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>) : justSaved ? "✓ Saved" : "Save Changes"}
                    </button>
                  </div>
                </form>
              </div>
            );
          })()}


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
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Payment Settings</h1>
              </div>
              <PaymentTab role={role} earningsJobs={earningsJobs} totalEarnings={totalEarnings} />
            </div>
          )}

          {tab === "subscription" && (
            <Suspense fallback={<TabFallback />}>
              <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "posted_jobs" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Posted Jobs</h1>
              </div>
              {inlinePostedJobs.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">No posted jobs yet.</p>
                  <Button onClick={() => navigate("/post-job")}>Post your first task</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {inlinePostedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground">{job.title}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                            <span>{new Date(job.date_needed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                            <span className="capitalize">{job.category.replace("_", " ")}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-sm font-bold text-primary">${job.budget}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[job.status] || "bg-muted text-muted-foreground"}`}>{job.status.replace("_", " ")}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "completed_jobs" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Completed Jobs</h1>
              </div>
              {inlineCompletedJobs.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No completed jobs yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {inlineCompletedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground">{job.title}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                            <span>{new Date(job.date_needed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                            <span className="capitalize">{job.category.replace("_", " ")}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-sm font-bold text-primary">${job.budget}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "support" && (
            <Suspense fallback={<TabFallback />}>
              <SupportInline userId={user?.id} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "notifications" && (
            <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Notifications</h1>
              </div>
              <NotificationPreferences />
            </div>
          )}

          {tab === "security" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Account Security</h1>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" /> Email Address
                </h2>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{user?.email}</p>
                    <p className="text-xs text-muted-foreground">Your login email</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const newEmail = prompt("Enter new email address:");
                      if (!newEmail) return;
                      const { error } = await supabase.auth.updateUser(
                        { email: newEmail },
                        { emailRedirectTo: getPublicSiteUrl() }
                      );
                      if (error) toast.error(error.message);
                      else toast.success("Confirmation sent to your new email!");
                    }}
                  >
                    <Mail className="w-4 h-4 mr-1" /> Change
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" /> Password
                </h2>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">••••••••</p>
                    <p className="text-xs text-muted-foreground">Reset via email link</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!user?.email) return;
                      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                        redirectTo: getPublicResetPasswordUrl(),
                      });
                      if (error) toast.error(error.message);
                      else toast.success("Password reset link sent to your email!");
                    }}
                  >
                    <Lock className="w-4 h-4 mr-1" /> Reset
                  </Button>
                </div>
              </div>

              {/* Delete Account moved to the landing tab, directly under
                  Sign out — keeps all destructive account actions grouped at
                  the bottom of the profile rather than buried in Security. */}
            </div>
          )}

          {tab === "reviews" && (
            <Suspense fallback={<TabFallback />}>
              <ReviewsTab reviews={reviews} loading={reviewsLoading} avgRating={avgRating} reviewCount={reviewCount} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "referral" && user && (
            <div className="h-[calc(100dvh-8.5rem)] flex flex-col gap-3 overflow-hidden">
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-page-title text-foreground text-2xl">Referral Program</h1>
              </div>
              <div className="flex-1 min-h-0">
                <ReferralSection userId={user.id} />
              </div>
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
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-page-title text-foreground text-2xl">Licensed & Insured</h1>
                  <p className="text-muted-foreground text-xs">Verify your professional credentials</p>
                </div>
              </div>
              <Suspense fallback={<TabFallback />}>
                <CredentialsTab userId={user.id} />
              </Suspense>
            </div>
          )}
        </div>
      </main>
    </AppShell>

    <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to log out of your account?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Log out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account — slide-up sheet, two-step flow with type-to-confirm safety catch */}
      <AlertDialog
        open={showDeleteAccountDialog}
        onOpenChange={(open) => {
          setShowDeleteAccountDialog(open);
          if (!open) { setDeleteConfirmText(""); setDeleteStep(1); }
        }}
      >
        <AlertDialogContent className="max-w-md">
          {deleteStep === 1 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your Helpr account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action is permanent. You will lose your job history, earnings records, and verified credentials. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="my-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Any pending or in-transit Stripe payouts will be forfeited. Cash out your available balance from the Earnings tab first.</span>
              </div>
              <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <AlertDialogCancel className="mt-0 sm:flex-1">Keep Account</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); setDeleteStep(2); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-1"
                >
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Final Confirmation
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Type <strong className="text-foreground">DELETE MY ACCOUNT</strong> below to confirm. There is no undo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                className="my-2 h-11 text-center font-mono tracking-wide"
                disabled={deletingAccount}
              />
              <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <AlertDialogCancel
                  disabled={deletingAccount}
                  onClick={(e) => { e.preventDefault(); setDeleteStep(1); setDeleteConfirmText(""); }}
                  className="mt-0 sm:flex-1"
                >
                  Back
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteConfirmText !== "DELETE MY ACCOUNT" || deletingAccount}
                  onClick={handleDeleteAccount}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-1"
                >
                  {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Delete Forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ProfilePage;
