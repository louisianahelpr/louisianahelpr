import { useEffect, useState } from "react";
import { formatName } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, DollarSign, LogOut, MapPin, Clock,
  CreditCard, Shield, FileText, ExternalLink, Mail, Lock, Upload, X,
  Star, Edit, CalendarDays, Gavel,
  ChevronRight as ChevronRightIcon,
  HelpCircle, Bell, AlertTriangle, Loader2, Heart, Crown, Camera,
  Briefcase,
} from "lucide-react";
import { ProfileCardSkeleton, StatsSkeleton } from "@/components/SkeletonLoaders";
import ReferralSection from "@/components/ReferralSection";
import NotificationPreferences from "@/components/NotificationPreferences";
import { PaymentTab } from "@/components/PaymentTab";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { MyRetainers } from "@/components/MyRetainers";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// Extracted tab components
import { SupportInline } from "@/components/profile/SupportInline";
import { SubscriptionTab } from "@/components/profile/SubscriptionTab";
import { LegalTab } from "@/components/profile/LegalTab";
import { EarningsTab } from "@/components/profile/EarningsTab";
import { ScheduleTab } from "@/components/profile/ScheduleTab";
import { ReviewsTab } from "@/components/profile/ReviewsTab";
import { WarningsTab } from "@/components/profile/WarningsTab";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type Tab = "landing" | "profile" | "earnings" | "schedule" | "payment" | "security" | "legal" | "reviews" | "referral" | "subscription" | "support" | "notifications" | "posted_jobs" | "completed_jobs" | "warnings";

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
  const { user: cachedUser, profile: cachedProfile } = useCurrentUser();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const initialTab = (searchParams.get("tab") as Tab) || "landing";
  const [tab, setTab] = useState<Tab>(initialTab);

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
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [stripeOnboarding, setStripeOnboarding] = useState(false);

  // Stats
  const [completedCount, setCompletedCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [totalJobEarnings, setTotalJobEarnings] = useState(0);
  const [totalTipEarnings, setTotalTipEarnings] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  // Reviews
  const [reviews, setReviews] = useState<{ rating: number; feedback: string | null; created_at: string; reviewerName: string; jobTitle: string }[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Profile fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

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
  const [showPostedJobs, setShowPostedJobs] = useState(false);
  const [showCompletedJobs, setShowCompletedJobs] = useState(false);
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
    if (cachedUser && !user) {
      setUser(cachedUser);
      if (cachedProfile) {
        setProfile(cachedProfile);
        setFullName(cachedProfile.full_name || "");
        setPhone(cachedProfile.phone || "");
        setLocation(cachedProfile.location || "");
        setBio(cachedProfile.bio || "");
        setSkills(cachedProfile.skills || "");
        setHourlyRate(cachedProfile.hourly_rate?.toString() || "");
        setDateOfBirth(cachedProfile.date_of_birth || "");
        setLoading(false);
      }
      loadStats(cachedUser.id);
    }
  }, [cachedUser, cachedProfile]);

  // No separate auth listener needed — useCurrentUser handles it via React Query

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("user_id", userId).single();
    if (data) {
      setProfile(data);
      setFullName(data.full_name || "");
      setPhone(data.phone || "");
      setLocation(data.location || "");
      setBio(data.bio || "");
      setSkills(data.skills || "");
      setHourlyRate(data.hourly_rate?.toString() || "");
      setDateOfBirth(data.date_of_birth || "");
    }
    setLoading(false);
  };

  const loadStats = async (userId: string) => {
    const [helperJobsRes, reviewsRes, postedRes, tipsStatsRes] = await Promise.all([
      supabase.from("jobs").select("budget, platform_fee_amount, urgent_fee").eq("helper_id", userId).eq("status", "completed"),
      supabase.from("reviews").select("rating").eq("reviewee_id", userId),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId),
      supabase.from("tips").select("amount").eq("helper_id", userId).eq("payment_status", "paid"),
    ]);
    if (helperJobsRes.data) {
      setCompletedCount(helperJobsRes.data.length);
      const jobEarnings = helperJobsRes.data.reduce((s, j) => {
        const fee = j.platform_fee_amount || 0;
        const feeTax = fee * 0.085;
        return s + (j.budget - fee - feeTax + (j.urgent_fee ?? 0));
      }, 0);
      const tipEarnings = (tipsStatsRes.data || []).reduce((s, t) => s + (t.amount || 0), 0);
      setTotalJobEarnings(jobEarnings);
      setTotalTipEarnings(tipEarnings);
    }
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
      .select("rating, feedback, created_at, reviewer_id, job_id")
      .eq("reviewee_id", user.id)
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
      setReviews(data.map((r) => ({
        rating: r.rating,
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

  const startStripeOnboarding = async () => {
    setStripeOnboarding(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "onboard" } });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start payout setup");
    } finally {
      setStripeOnboarding(false);
    }
  };

  const loadEarnings = async () => {
    if (!user) return;
    setEarningsLoading(true);
    const [jobsRes, tipsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
      supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", user.id),
    ]);
    if (jobsRes.data) setEarningsJobs(jobsRes.data);
    if (tipsRes.data) setTips(tipsRes.data);
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
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      full_name: fullName.trim(), phone: phone.trim(), location: location.trim(),
      bio: bio.trim(), skills: skills.trim(),
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
      date_of_birth: dateOfBirth || null,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated!");
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
  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center justify-between h-16 px-4">
            <span className="text-2xl font-display font-bold text-primary">Helpr</span>
          </div>
        </header>
        <main className="container mx-auto px-4 py-4">
          <div className="max-w-lg mx-auto space-y-4">
            <ProfileCardSkeleton />
            <StatsSkeleton />
          </div>
        </main>
      </div>
    );
  }

  const role = profile?.role || "customer";
  const initials = (profile?.full_name || user?.email || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const totalEarnings = earningsJobs.filter((j) => j.status === "completed").reduce((sum, j) => {
    const fee = j.platform_fee_amount || 0;
    const feeTax = fee * 0.085;
    return sum + (j.budget - fee - feeTax + (j.urgent_fee ?? 0));
  }, 0);

  const menuGroups: { title: string; items: { key: Tab; label: string; icon: React.ReactNode; desc: string }[] }[] = [
    {
      title: "Account",
      items: [
        { key: "profile", label: "Edit Profile", icon: <Edit className="w-5 h-5" />, desc: "Update your info & portfolio" },
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar, upcoming jobs & availability" },
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
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* LANDING VIEW */}
          {tab === "landing" && (
            <div className="space-y-5">
              {/* Profile header card */}
              <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
                <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-2xl font-bold overflow-hidden">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                  ) : initials}
                </div>
                <div>
                  <h1 className="text-xl font-display font-bold text-foreground">{profile?.full_name || "Set up your profile"}</h1>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    {role !== "customer" && <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">{role}</span>}
                    {profile?.location && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{profile.location}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{user?.email}</p>
                  {profile?.created_at && (
                    <p className="text-xs text-muted-foreground mt-0.5">Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
                  )}
                </div>
              </div>

              {/* Payout Banner */}
              {profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
                <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
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

              {/* Quick stats */}
              <div className="grid grid-cols-4 gap-2">
                <button onClick={() => setTab("reviews")} className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-center gap-1">
                    <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                    <p className="text-lg font-bold text-foreground">{avgRating ? avgRating.toFixed(1) : "—"}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{reviewCount} Review{reviewCount !== 1 ? "s" : ""}</p>
                </button>
                <button onClick={() => { if (postedCount > 0) { loadInlineJobs(); setTab("posted_jobs"); } }} className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all">
                  <p className="text-lg font-bold text-foreground">{postedCount}</p>
                  <p className="text-[10px] text-muted-foreground">Posted</p>
                </button>
                <button onClick={() => { if (completedCount > 0) { loadInlineJobs(); setTab("completed_jobs"); } }} className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all">
                  <p className="text-lg font-bold text-foreground">{completedCount}</p>
                  <p className="text-[10px] text-muted-foreground">Completed</p>
                </button>
                <button onClick={() => { loadEarnings(); setTab("earnings"); }} className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-primary" />
                    <p className="text-lg font-bold text-foreground">{totalJobEarnings > 0 ? `$${totalJobEarnings.toFixed(2)}` : "—"}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Earnings</p>
                  {totalTipEarnings > 0 && (
                    <p className="text-[10px] text-primary mt-0.5">+${totalTipEarnings.toFixed(2)} tips</p>
                  )}
                </button>
              </div>

              {/* Grouped vertical menu */}
              <div className="space-y-4">
                {menuGroups.map((group) => (
                  <div key={group.title}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">{group.title}</p>
                    <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                      {group.items.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setTab(item.key)}
                          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-secondary/50 transition-colors text-left"
                        >
                          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            {item.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                          <ChevronRightIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Logout */}
              <Button variant="outline" className="w-full" onClick={() => setShowLogoutDialog(true)}>
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </Button>
            </div>
          )}

          {/* PROFILE TAB */}
          {tab === "profile" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-2xl font-display font-bold text-foreground">Edit profile</h1>
                  <p className="text-muted-foreground text-sm">Keep your info up to date</p>
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                {/* Avatar Upload */}
                <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center gap-3">
                  <div className="relative group">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Profile" className="w-24 h-24 rounded-full object-cover border-2 border-primary/20" />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold border-2 border-primary/20">
                        {initials}
                      </div>
                    )}
                    <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      {avatarUploading ? (
                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                      ) : (
                        <Camera className="w-6 h-6 text-white" />
                      )}
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">Tap to change profile picture</p>
                </div>

                {/* Personal Info Card */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" /> Personal Information
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="fullName" className="text-xs">Full name</Label>
                      <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs">Phone</Label>
                      <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dob" className="text-xs">Date of birth</Label>
                      <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="location" className="text-xs">Location (city or ZIP)</Label>
                    <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Louisiana" />
                  </div>
                </div>

                {/* About Card */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" /> About & Skills
                  </h2>
                  <div className="space-y-1.5">
                    <Label htmlFor="bio" className="text-xs">About you</Label>
                    <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself…" rows={3} />
                  </div>
                  {role === "helper" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="skills" className="text-xs">Skills & services</Label>
                        <Input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Cleaning, yard work, moving…" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rate" className="text-xs">Hourly rate ($)</Label>
                        <Input id="rate" type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="25" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Portfolio Card — Pro+ only */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" /> Portfolio & Documents
                    </h2>
                    {(!profile?.subscription_tier || profile.subscription_tier === "basic") ? (
                      <div className="mt-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-xs text-primary font-medium">🔒 Pro+ Feature</p>
                        <p className="text-xs text-muted-foreground mt-1">Upgrade to Pro or Elite to showcase your portfolio and stand out to customers.</p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">Work samples, certifications, resume — up to 10 files</p>
                    )}
                  </div>
                  {(profile?.subscription_tier === "pro" || profile?.subscription_tier === "elite") && (
                  <div className="flex flex-wrap gap-3">
                    {(profile?.portfolio_urls as string[] || []).map((url, i) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                      const fileName = url.split("/").pop() || "Document";
                      return (
                        <div key={i} className="relative group">
                          {isImage ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-border hover:border-primary transition-colors">
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg border border-border flex flex-col items-center justify-center bg-secondary/30 px-1 hover:border-primary transition-colors">
                              <FileText className="w-5 h-5 text-muted-foreground" />
                              <p className="text-[9px] text-muted-foreground text-center mt-1 truncate w-full">{fileName}</p>
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              const currentUrls = (profile?.portfolio_urls as string[] || []).filter((_, idx) => idx !== i);
                              const { error } = await supabase.from("profiles").update({ portfolio_urls: currentUrls }).eq("user_id", user!.id);
                              if (error) toast.error("Failed to remove");
                              else { toast.success("Removed"); loadProfile(user!.id); }
                            }}
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                    <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
                      <input
                        type="file"
                        accept="image/*,.pdf,.doc,.docx"
                        multiple
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length || !user) return;
                          const currentUrls = (profile?.portfolio_urls as string[] || []);
                          if (currentUrls.length + files.length > 10) {
                            toast.error("Maximum 10 files allowed");
                            return;
                          }
                          toast.info("Uploading…");
                          const newUrls: string[] = [];
                          for (const file of files) {
                            const ext = file.name.split(".").pop();
                            const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                            const { error } = await supabase.storage.from("user-documents").upload(path, file);
                            if (!error) {
                              const { data: urlData } = supabase.storage.from("user-documents").getPublicUrl(path);
                              newUrls.push(urlData.publicUrl);
                            }
                          }
                          if (newUrls.length > 0) {
                            const updated = [...currentUrls, ...newUrls];
                            await supabase.from("profiles").update({ portfolio_urls: updated }).eq("user_id", user.id);
                            toast.success(`${newUrls.length} file(s) uploaded!`);
                            loadProfile(user.id);
                          }
                        }}
                      />
                    </label>
                  </div>
                  )}
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </form>
            </div>
          )}

          {/* EXTRACTED TAB COMPONENTS */}
          {tab === "earnings" && (
            <EarningsTab earningsJobs={earningsJobs} tips={tips} loading={earningsLoading} onBack={() => setTab("landing")} />
          )}

          {tab === "schedule" && user && (
            <ScheduleTab postedJobs={schedulePostedJobs} assignedJobs={scheduleAssignedJobs} loading={scheduleLoading} userId={user.id} onBack={() => setTab("landing")} />
          )}

          {tab === "payment" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Payment Settings</h1>
              </div>
              <PaymentTab role={role} earningsJobs={earningsJobs} totalEarnings={totalEarnings} />
            </div>
          )}

          {tab === "subscription" && (
            <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
          )}

          {tab === "posted_jobs" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Posted Jobs</h1>
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
                <h1 className="text-2xl font-display font-bold text-foreground">Completed Jobs</h1>
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
            <SupportInline userId={user?.id} onBack={() => setTab("landing")} />
          )}

          {tab === "notifications" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Notifications</h1>
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
                <h1 className="text-2xl font-display font-bold text-foreground">Account Security</h1>
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
                      const { error } = await supabase.auth.updateUser({ email: newEmail });
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
                        redirectTo: `${window.location.origin}/reset-password`,
                      });
                      if (error) toast.error(error.message);
                      else toast.success("Password reset link sent to your email!");
                    }}
                  >
                    <Lock className="w-4 h-4 mr-1" /> Reset
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === "reviews" && (
            <ReviewsTab reviews={reviews} loading={reviewsLoading} avgRating={avgRating} reviewCount={reviewCount} onBack={() => setTab("landing")} />
          )}

          {tab === "referral" && user && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Referral Program</h1>
              </div>
              <ReferralSection userId={user.id} />
            </div>
          )}

          {tab === "legal" && (
            <LegalTab onBack={() => setTab("landing")} />
          )}

          {tab === "warnings" && (
            <WarningsTab violations={violations} loading={violationsLoading} onBack={() => setTab("landing")} />
          )}
        </div>
      </main>

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
    </div>
  );
};

export default ProfilePage;
