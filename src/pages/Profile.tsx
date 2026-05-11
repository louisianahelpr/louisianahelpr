import { useEffect, useState, lazy, Suspense } from "react";
import HelprMark from "@/components/HelprMark";
import { formatName } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DollarSign, LogOut, MapPin,
  CreditCard, Shield, Upload,
  Star, Edit, CalendarDays, Clock, Gavel,
  ChevronRight as ChevronRightIcon,
  HelpCircle, Bell, AlertTriangle, Loader2, Heart, Crown, Camera,
  ShieldCheck, Trash2, Briefcase,
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
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { lookupParishByZip } from "@/lib/parishLookup";

// Lazy-loaded tab components — keeps Profile.tsx initial bundle under 200KB.
// Each tab is only fetched the first time the user clicks it.
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";
import { SecurityTab } from "@/components/profile/SecurityTab";
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

  const menuGroups: { title: string; items: { key: Tab; label: string; icon: React.ReactNode; desc: string; href?: string }[] }[] = [
    {
      title: "Account",
      items: [
        { key: "credentials", label: "Licensed & Insured", icon: <ShieldCheck className="w-5 h-5" />, desc: "Add your license and insurance" },
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar and upcoming jobs" },
        { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Set your weekly working hours" },
        { key: "landing" as Tab, label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", href: "/saved-helpers" },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get" },
      ],
    },
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
            <>
              {/* Top box — hero with avatar + name + stats. Same radial
                  Sienna→Verdigris backdrop as the Dashboard greeting card. */}
              <div
                className="relative liquid-glass shrink-0 p-3.5 overflow-hidden"
                style={{
                  backgroundImage:
                    "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                    "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                    "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
                    "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
                }}
              >
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
                    {profile?.avatar_url && !avatarBroken ? (
                      <img
                        loading="lazy"
                        decoding="async"
                        src={profile.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setAvatarBroken(true)}
                      />
                    ) : initials}
                  </div>
                  {/* Identity + integrated stats, all stacked tight on the right */}
                  <div className="flex-1 min-w-0 text-left">
                    <h1
                      className="font-display italic font-bold truncate leading-tight"
                      style={{
                        fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
                        color: "hsl(var(--ink-deep))",
                        letterSpacing: "-0.025em",
                      }}
                    >
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

              {/* Bottom box — menu groups + account actions. Extends
                  to viewport bottom with flat bottom corners. AppShell
                  handles vertical scroll (scrollable=true on landing),
                  so this card just stacks naturally. */}
              <div
                className="liquid-glass min-h-[60vh]"
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderBottom: "none",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                    "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
                    "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
                }}
              >
                <div className="px-4 pt-3 pb-4 space-y-3">
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
              </div>
            </>
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
              return (
              <div className="space-y-5 pb-24">
                <ProfileTabHeader
                  eyebrow="Identity"
                  title="Edit profile"
                  meta="Photo, contact, and verification"
                  onBack={() => setTab("landing")}
                />

                <form onSubmit={handleSave} className="space-y-4">
                  {/* Photo + Name section */}
                  <div className="rounded-2xl liquid-glass p-5 space-y-4">
                    <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                      Photo &amp; name
                    </p>
                    <div className="flex items-center gap-4">
                      <div className="relative group shrink-0">
                        {profile?.avatar_url && !avatarBroken ? (
                          <img
                            loading="lazy"
                            decoding="async"
                            src={profile.avatar_url}
                            alt=""
                            className="w-20 h-20 rounded-full object-cover border-2 border-primary/20"
                            onError={() => setAvatarBroken(true)}
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-display italic font-bold border-2 border-primary/20">
                            {initials}
                          </div>
                        )}
                        <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                          {avatarUploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
                          <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                        </label>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "1.15rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                          {`${firstName} ${lastName}`.trim() || "Your name"}
                        </p>
                        <p className="font-serif italic mt-1 leading-snug" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                          Tap the photo to change. Your name is locked after signup.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Contact section */}
                  <div className="rounded-2xl liquid-glass p-5 space-y-4">
                    <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                      Contact
                    </p>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="phone" className="text-xs mb-1.5 block">Phone</Label>
                        <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555 123 4567" className="h-10" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <Label htmlFor="location" className="text-xs mb-1.5 block">City</Label>
                          <Input id="location" autoComplete="address-level2" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Baton Rouge" className="h-10" />
                        </div>
                        <div>
                          <Label htmlFor="zipCode" className="text-xs mb-1.5 block">ZIP</Label>
                          <Input
                            id="zipCode"
                            value={zipCode}
                            onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                            placeholder="70801"
                            inputMode="numeric"
                            autoComplete="postal-code"
                            maxLength={5}
                            className="h-10"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bio section */}
                  <div className="rounded-2xl liquid-glass p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                        About your work
                      </p>
                      <span className={`text-xs font-medium ${bioOk ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`}>{bio.trim().length}/20</span>
                    </div>
                    <Textarea
                      id="bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="What you do, tools you bring, what makes you reliable…"
                      className="min-h-[112px] resize-none text-sm leading-relaxed"
                    />
                    <p className="font-serif italic leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                      Customers read this when deciding who to hire. The more specific, the better.
                    </p>
                  </div>

                  {/* ID Verification section */}
                  <div className="rounded-2xl liquid-glass p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                          Trust
                        </p>
                        <h2 className="font-display italic font-bold leading-tight flex items-center gap-2 flex-wrap" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                          ID verification
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium not-italic ${idBadge.cls}`}>{idBadge.label}</span>
                        </h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-serif italic leading-snug flex-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                        Upload a government-issued ID. Encrypted in transit and reviewed by Helpr.
                      </p>
                      <label className="shrink-0">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-9 rounded-xl bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 active:scale-[0.98] transition-all">
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

                  {/* Save / Cancel actions */}
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setTab("landing")}
                      className="rounded-2xl liquid-glass h-12 inline-flex items-center justify-center gap-2 text-sm font-semibold text-foreground hover:bg-secondary/40 active:scale-[0.98] transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || justSaved}
                      className={`col-span-2 rounded-2xl h-12 inline-flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-[0.98] disabled:active:scale-100 shadow-[0_2px_4px_hsl(var(--primary)/0.15),0_12px_32px_-12px_hsl(var(--primary)/0.45)] ${
                        saving
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : justSaved
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground"
                      }`}
                    >
                      {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : justSaved ? "✓ Saved" : "Save changes"}
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
              <ProfileTabHeader
                eyebrow="Money"
                title="Payment settings"
                meta="Cards, bank accounts, payouts"
                onBack={() => setTab("landing")}
              />
              <PaymentTab earningsJobs={earningsJobs} totalEarnings={totalEarnings} />
            </div>
          )}

          {tab === "subscription" && (
            <Suspense fallback={<TabFallback />}>
              <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
            </Suspense>
          )}

          {tab === "posted_jobs" && (
            <div className="space-y-4">
              <ProfileTabHeader
                eyebrow="History"
                title="Posted jobs"
                meta={`${inlinePostedJobs.length} task${inlinePostedJobs.length === 1 ? "" : "s"} posted`}
                onBack={() => setTab("landing")}
              />
              {inlinePostedJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-4 px-6 py-12">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Briefcase className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display italic font-bold" style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))" }}>
                      No posts yet
                    </p>
                    <p className="font-serif italic text-sm max-w-xs" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Tell a neighbor what you need done — they'll see it within minutes.
                    </p>
                  </div>
                  <Button onClick={() => navigate("/post-job")}>Post your first task</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {inlinePostedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl liquid-glass p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                            {job.title}
                          </p>
                          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 font-serif italic flex-wrap" style={{ color: "hsl(var(--olivewood) / 0.7)", fontSize: "0.78rem" }}>
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                            <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                            <span>{new Date(job.date_needed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                            <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                            <span className="capitalize">{job.category.replace("_", " ")}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-base font-bold text-primary tabular-nums">${job.budget}</span>
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
              <ProfileTabHeader
                eyebrow="Track record"
                title="Completed jobs"
                meta={`${inlineCompletedJobs.length} job${inlineCompletedJobs.length === 1 ? "" : "s"} delivered`}
                onBack={() => setTab("landing")}
              />
              {inlineCompletedJobs.length === 0 ? (
                <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-4 px-6 py-12">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Star className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display italic font-bold" style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))" }}>
                      No history yet
                    </p>
                    <p className="font-serif italic text-sm max-w-xs" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Every job you complete builds your record. Apply to one to get started.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {inlineCompletedJobs.map((job) => (
                    <div key={job.id} className="rounded-xl liquid-glass p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-display italic font-bold leading-tight truncate" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                            {job.title}
                          </p>
                          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 font-serif italic flex-wrap" style={{ color: "hsl(var(--olivewood) / 0.7)", fontSize: "0.78rem" }}>
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                            <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                            <span>{new Date(job.date_needed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                            <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                            <span className="capitalize">{job.category.replace("_", " ")}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-base font-bold text-primary tabular-nums">${job.budget}</span>
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
