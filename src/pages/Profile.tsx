import { useEffect, useState } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, DollarSign, TrendingUp, Gift, Briefcase, LogOut,
  ChevronLeft, ChevronRight, MapPin, Clock, Calendar, Filter,
  CreditCard, Shield, FileText, ExternalLink, Mail, Lock, ImagePlus, X, Upload,
  User as UserIcon, Star, Edit, History, CalendarDays, Gavel, ChevronRight as ChevronRightIcon,
  LifeBuoy, RotateCcw, Crown, CheckCircle, Loader2, Heart, Users, HelpCircle, CalendarHeart, Bell,
  MessageSquarePlus, Lightbulb, AlertTriangle, Send, CheckCircle2, Ban, XCircle, Scale, Timer,
  Camera,
} from "lucide-react";
import { ProfileCardSkeleton, StatsSkeleton } from "@/components/SkeletonLoaders";
import { HelperAvailability } from "@/components/HelperAvailability";
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

type HistoryTab = "all" | "posted" | "worked";
type StatusFilter = "all" | "open" | "in_progress" | "completed" | "cancelled";

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
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [stripeOnboarding, setStripeOnboarding] = useState(false);

  // Stats
  const [completedCount, setCompletedCount] = useState(0);
  const [postedCount, setPostedCount] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
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
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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

  // Load violations when tab changes
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      setUser(session.user);
      loadProfile(session.user.id);
      loadStats(session.user.id);
    });
    if (!cachedUser) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return;
        setUser(session.user);
        loadProfile(session.user.id);
        loadStats(session.user.id);
      });
    }
    return () => subscription.unsubscribe();
  }, []);

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
    const [jobsRes, reviewsRes, postedRes] = await Promise.all([
      supabase.from("jobs").select("budget, platform_fee_amount").or(`customer_id.eq.${userId},helper_id.eq.${userId}`).eq("status", "completed"),
      supabase.from("reviews").select("rating").eq("reviewee_id", userId),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", userId),
    ]);
    if (jobsRes.data) {
      setCompletedCount(jobsRes.data.length);
      setTotalEarned(jobsRes.data.reduce((s, j) => s + (j.budget - (j.platform_fee_amount || 0)), 0));
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

  // Load tab data on demand
  useEffect(() => {
    if (!user) return;
    if (tab === "earnings") loadEarnings();
    if (tab === "schedule") loadSchedule();
    if (tab === "reviews") loadReviews();
    if (tab === "reviews") loadReviews();
  }, [tab, user]);

  // Check Stripe Connect status for all users
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

  // Earnings calculations
  const completedJobs = earningsJobs.filter((j) => j.status === "completed");
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.budget - (j.platform_fee_amount || 0)), 0);
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

  // Schedule calculations
  const allScheduleJobs = [...schedulePostedJobs, ...scheduleAssignedJobs];
  const jobsByDate = new Map<string, Job[]>();
  allScheduleJobs.forEach((j) => {
    const key = j.date_needed;
    if (!jobsByDate.has(key)) jobsByDate.set(key, []);
    jobsByDate.get(key)!.push(j);
  });
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const selectedJobs = selectedDate ? (jobsByDate.get(selectedDate) || []) : [];
  const upcomingJobs = allScheduleJobs.filter((j) => j.date_needed >= today).sort((a, b) => a.date_needed.localeCompare(b.date_needed)).slice(0, 10);

type SupportCategory = "message" | "suggestion" | "report" | "help";

const supportCategories: { key: SupportCategory; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-5 h-5" />, description: "Send a direct message to the admin team" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-5 h-5" />, description: "Share an idea to improve the platform" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-5 h-5" />, description: "Report a bug, problem, or concern" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-5 h-5" />, description: "Ask a question or request assistance" },
];

function SupportInline({ userId, onBack }: { userId?: string; onBack: () => void }) {
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !category || !message.trim()) return;
    setSending(true);
    const labels: Record<SupportCategory, string> = { message: "Admin Message", suggestion: "Suggestion", report: "Issue Report", help: "Help Request" };
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      reported_type: "support",
      reported_id: userId,
      reason: `[${labels[category]}] ${subject.trim() || "No subject"}`,
      description: message.trim(),
    });
    setSending(false);
    if (error) { toast.error("Failed to send. Please try again."); }
    else { setSent(true); toast.success("Message sent to admin!"); }
  };

  const reset = () => { setCategory(null); setSubject(""); setMessage(""); setSent(false); };

  if (sent) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Message Sent!</h1>
        <p className="text-muted-foreground">Our team will review your message and get back to you soon.</p>
        <Button variant="outline" onClick={reset}>Send Another</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" /> Help & Support
          </h1>
          <p className="text-sm text-muted-foreground">Message admin, share suggestions, or report issues</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {supportCategories.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`rounded-xl border p-4 text-left transition-all ${
              category === c.key
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className={`mb-2 ${category === c.key ? "text-primary" : "text-muted-foreground"}`}>
              {c.icon}
            </div>
            <p className="font-medium text-sm text-foreground">{c.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
          </button>
        ))}
      </div>

      {category && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="support-subject" className="text-xs">Subject (optional)</Label>
            <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-message" className="text-xs">Your message *</Label>
            <Textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe in detail…" rows={5} required />
          </div>
          <Button type="submit" className="w-full" disabled={sending || !message.trim()}>
            {sending ? "Sending…" : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
          </Button>
        </form>
      )}
    </div>
  );
}

  const menuItems: { key: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: "profile", label: "Edit Profile", icon: <Edit className="w-5 h-5" />, desc: "Update your info & portfolio" },
    
    { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar, upcoming jobs & availability" },
    { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits" },
    
    
    
    { key: "subscription", label: "Subscription", icon: <Crown className="w-5 h-5" />, desc: "Manage your Helpr plan" },
    { key: "payment", label: "Payment", icon: <CreditCard className="w-5 h-5" />, desc: "Payment methods & summary" },
    { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get" },
    { key: "security", label: "Account Security", icon: <Shield className="w-5 h-5" />, desc: "Email, password & login" },
    { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history" },
    { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines" },
    { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us" },
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
                <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto text-2xl font-bold">
                  {initials}
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

              {/* Stripe Connect Banner for helpers without payout account */}
              {role === "helper" && profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
                <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {!stripeConnectStatus.connected ? "Set up your payout account" : !stripeConnectStatus.details_submitted ? "Complete your payout setup" : "Payout verification in progress"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {!stripeConnectStatus.connected
                          ? "You need to connect a bank account before you can accept jobs and receive payments."
                          : !stripeConnectStatus.details_submitted
                          ? "Your payout account setup is incomplete. Please finish it to receive payments."
                          : "Your account is being verified. This usually takes 1–2 business days."}
                      </p>
                    </div>
                  </div>
                  {(!stripeConnectStatus.connected || !stripeConnectStatus.details_submitted) && (
                    <Button onClick={startStripeOnboarding} disabled={stripeOnboarding} className="w-full" size="sm">
                      {stripeOnboarding ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</>
                      ) : (
                        <><CreditCard className="w-4 h-4 mr-2" /> {stripeConnectStatus.connected ? "Complete setup" : "Connect payout account"}</>
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* Quick stats */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setTab("reviews")}
                  className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-center gap-1">
                    <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                    <p className="text-lg font-bold text-foreground">{avgRating ? avgRating.toFixed(1) : "—"}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{reviewCount} Review{reviewCount !== 1 ? "s" : ""}</p>
                </button>
                <button
                  onClick={() => { if (postedCount > 0) { loadInlineJobs(); setTab("posted_jobs"); } }}
                  className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <p className="text-lg font-bold text-foreground">{postedCount}</p>
                  <p className="text-[10px] text-muted-foreground">Posted</p>
                </button>
                <button
                  onClick={() => { if (completedCount > 0) { loadInlineJobs(); setTab("completed_jobs"); } }}
                  className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <p className="text-lg font-bold text-foreground">{completedCount}</p>
                  <p className="text-[10px] text-muted-foreground">Completed</p>
                </button>
                <button
                  onClick={() => { loadEarnings(); setTab("earnings"); }}
                  className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-primary" />
                    <p className="text-lg font-bold text-foreground">{totalEarned > 0 ? `${totalEarned.toFixed(0)}` : "—"}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Earnings</p>
                </button>
              </div>

              {/* Vertical menu */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                {menuItems.map((item) => (
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

              {/* Logout */}
              <Button variant="outline" className="w-full" onClick={handleLogout}>
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
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarUpload}
                        disabled={avatarUploading}
                      />
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

                {/* Portfolio Card */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" /> Portfolio & Documents
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      Work samples, certifications, resume — up to 10 files
                    </p>
                  </div>

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
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </form>
            </div>
          )}

          {/* EARNINGS TAB */}
          {tab === "earnings" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">My Earnings</h1>
              </div>
              {earningsLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Total</span>
                        <TrendingUp className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{completedJobs.length} jobs</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Tips</span>
                        <Gift className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">${totalTips.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{tips.length} tips</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Briefcase className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">{inProgressJobs.length}</p>
                      <p className="text-xs text-muted-foreground mt-1">in progress</p>
                    </div>
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-semibold text-foreground mb-3">Earning History</h2>
                    {earningsJobs.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground mb-4">No jobs yet.</p>
                        <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {earningsJobs.map((job) => {
                          const payout = job.status === "completed" ? job.budget - (job.platform_fee_amount || 0) : null;
                          const jobTips = tips.filter((t) => t.job_id === job.id);
                          const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
                          return (
                            <div key={job.id} className="rounded-xl border border-border bg-card p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-semibold text-foreground text-sm">{job.title}</h3>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{job.location} · {new Date(job.date_needed).toLocaleDateString()}</p>
                                </div>
                                <div className="text-right">
                                  {payout !== null && <p className="font-bold text-foreground text-sm">${payout.toFixed(2)}</p>}
                                  {tipTotal > 0 && <p className="text-xs text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${tipTotal.toFixed(2)}</p>}
                                  {job.status === "in_progress" && <p className="text-xs text-muted-foreground">${job.budget} budget</p>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* SCHEDULE TAB (includes availability) */}
          {tab === "schedule" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-2xl font-display font-bold text-foreground">My Schedule</h1>
                  <p className="text-muted-foreground text-sm">Your calendar, upcoming jobs & working hours</p>
                </div>
              </div>

              {/* Calendar */}
              {scheduleLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-4">
                      <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
                      <h2 className="font-display font-semibold text-foreground text-sm">
                        {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </h2>
                      <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                        <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {days.map((day, i) => {
                        if (day === null) return <div key={`e-${i}`} />;
                        const dateStr = getDateStr(day);
                        const hasJobs = jobsByDate.has(dateStr);
                        const isToday = dateStr === today;
                        const isSelected = dateStr === selectedDate;
                        return (
                          <button
                            key={day}
                            onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                            className={`relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors ${
                              isSelected ? "bg-primary text-primary-foreground" :
                              isToday ? "bg-primary/10 text-primary font-bold" :
                              "hover:bg-secondary text-foreground"
                            }`}
                          >
                            {day}
                            {hasJobs && (
                              <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedDate && (
                    <div className="space-y-3">
                      <h3 className="font-display font-semibold text-foreground text-sm">
                        {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                      </h3>
                      {selectedJobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No jobs scheduled for this day.</p>
                      ) : (
                        selectedJobs.map((job) => (
                          <ScheduleCard key={job.id} job={job} isPosted={schedulePostedJobs.some((j) => j.id === job.id)} />
                        ))
                      )}
                    </div>
                  )}

                  {!selectedDate && (
                    <div className="space-y-3">
                      <h3 className="font-display font-semibold text-foreground text-sm">Upcoming</h3>
                      {upcomingJobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No upcoming jobs.</p>
                      ) : (
                        upcomingJobs.map((job) => (
                          <ScheduleCard key={job.id} job={job} isPosted={schedulePostedJobs.some((j) => j.id === job.id)} />
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Availability section */}
              <div className="border-t border-border pt-6">
                <h2 className="text-lg font-display font-bold text-foreground mb-1">Working Hours</h2>
                <p className="text-muted-foreground text-xs mb-4">Set your weekly availability so customers know when you're free</p>
                {user && <HelperAvailability userId={user.id} />}
              </div>
            </div>
          )}

          {/* PAYMENT TAB */}
          {tab === "payment" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Payment Settings</h1>
              </div>
              <PaymentTab
                role={role}
                earningsJobs={earningsJobs}
                totalEarnings={totalEarnings}
              />
            </div>
          )}

          {/* SUBSCRIPTION TAB */}
          {tab === "subscription" && (
            <SubscriptionTab profile={profile} user={user} onBack={() => setTab("landing")} />
          )}


          {/* POSTED JOBS TAB */}
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

          {/* COMPLETED JOBS TAB */}
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


          {/* SUPPORT TAB */}
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

          {/* REVIEWS TAB */}
          {tab === "reviews" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h1 className="text-2xl font-display font-bold text-foreground">My Reviews</h1>
                  <p className="text-muted-foreground text-sm">
                    {avgRating ? `${avgRating.toFixed(1)} average from ${reviewCount} review${reviewCount !== 1 ? "s" : ""}` : "No reviews yet"}
                  </p>
                </div>
              </div>

              {reviewsLoading ? (
                <p className="text-sm text-muted-foreground">Loading reviews...</p>
              ) : reviews.length === 0 ? (
                <div className="text-center py-12">
                  <Star className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No reviews yet. Complete jobs to receive reviews!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reviews.map((review, i) => (
                    <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, s) => (
                              <Star
                                key={s}
                                className={`w-3.5 h-3.5 ${s < review.rating ? "text-primary fill-primary" : "text-muted-foreground/30"}`}
                              />
                            ))}
                          </div>
                          <span className="text-sm font-semibold text-foreground">{review.rating}/5</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      </div>
                      {review.feedback && (
                        <p className="text-sm text-foreground">{review.feedback}</p>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>By <span className="font-medium text-foreground">{review.reviewerName}</span></span>
                        <span>·</span>
                        <span>{review.jobTitle}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* REFERRAL TAB */}
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

          {/* LEGAL TAB */}
          {tab === "legal" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-2xl font-display font-bold text-foreground">Legal & Policies</h1>
              </div>

              {/* Quick Links */}
              <div className="flex flex-wrap gap-2">
                <Link to="/rules" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                  <FileText className="w-3.5 h-3.5" /> Full Platform Rules
                  <ExternalLink className="w-3 h-3" />
                </Link>
                <Link to="/terms" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
                  Terms of Service <ExternalLink className="w-3 h-3" />
                </Link>
                <Link to="/privacy" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
                  Privacy Policy <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {/* Platform Rules Section */}
              <div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Platform Rules</h2>
                <div className="space-y-2">
                  <LegalCard icon={<FileText className="w-4 h-4 text-primary" />} title="Terms of Service">
                    <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account and all activity under it.</p>
                    <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helpr, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
                    <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, or any conduct that violates the rights of others.</p>
                    <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms.</p>
                  </LegalCard>
                  <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Privacy Policy">
                    <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, location) and usage data to improve the platform.</p>
                    <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, and communicate important updates.</p>
                    <p><strong className="text-foreground">Data Sharing:</strong> We share limited information (first name, reviews) with other users. Payment data is handled securely by Stripe. We never sell your personal information.</p>
                    <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. You can request deletion by contacting support.</p>
                  </LegalCard>
                  <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Community Guidelines">
                    <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism.</p>
                    <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions.</p>
                    <p><strong className="text-foreground">Safety:</strong> Never share personal information like home addresses or financial details through messages.</p>
                    <p><strong className="text-foreground">Reporting:</strong> Report any suspicious or inappropriate behavior using the report feature.</p>
                  </LegalCard>
                </div>
              </div>

              {/* Payments & Fees Section */}
              <div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payments & Fees</h2>
                <div className="space-y-2">
                  <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Payment & Refund Policy">
                    <p><strong className="text-foreground">Escrow System:</strong> All payments are held in escrow until both parties confirm the job is complete.</p>
                    <p><strong className="text-foreground">Platform Fee:</strong> Helpr charges a platform fee on each transaction. The fee percentage is visible before payment.</p>
                    <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 72 hours after one party marks it done, payment is automatically released.</p>
                    <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions before approving completion.</p>
                    <p><strong className="text-foreground">Disputes:</strong> If you have a payment dispute, contact support.</p>
                  </LegalCard>
                  <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Platform Fees">
                    <p><strong className="text-foreground">Service Fee:</strong> A platform fee is applied to each transaction and deducted from the helpr's payout.</p>
                    <p><strong className="text-foreground">Urgent Job Fee:</strong> $5 fee for posters who mark a job as urgent.</p>
                    <p><strong className="text-foreground">Job Boost:</strong> Optional paid boost to increase visibility of your listing.</p>
                    <p><strong className="text-foreground">Tipping:</strong> 100% of tips go to the helpr — no platform fee on tips.</p>
                  </LegalCard>
                  <LegalCard icon={<DollarSign className="w-4 h-4 text-primary" />} title="Job Budget Limits">
                    <p><strong className="text-foreground">Minimum:</strong> $5 per job.</p>
                    <p><strong className="text-foreground">Maximum:</strong> $5,000 per job.</p>
                  </LegalCard>
                  <LegalCard icon={<Crown className="w-4 h-4 text-primary" />} title="Subscription Tiers">
                    <p><strong className="text-foreground">Basic ⭐ ($5/mo):</strong> Standard access with basic features.</p>
                    <p><strong className="text-foreground">Pro 🔥 ($10/mo):</strong> Priority job access and enhanced visibility.</p>
                    <p><strong className="text-foreground">Elite 💎 ($15/mo):</strong> Top-tier access with maximum visibility and early job access.</p>
                    <p><strong className="text-foreground">Annual Plans:</strong> Available at ~10x monthly rate (save ~17%).</p>
                    <p><strong className="text-foreground">Billing:</strong> One-time, monthly (choose billing day 1st–28th), or annual.</p>
                  </LegalCard>
                </div>
              </div>

              {/* Cancellations & Strikes Section */}
              <div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cancellations & Strikes</h2>
                <div className="space-y-2">
                  <LegalCard icon={<XCircle className="w-4 h-4 text-destructive" />} title="Cancellation Policy" variant="warning">
                    <p><strong className="text-foreground">Free Cancellation:</strong> Cancel 24+ hours before the job at no charge.</p>
                    <p><strong className="text-foreground">Late Cancellation (&lt;24h):</strong> 25% cancellation fee applied.</p>
                    <p><strong className="text-foreground">Very Late Cancellation (&lt;2h):</strong> 50% cancellation fee applied.</p>
                  </LegalCard>
                  <LegalCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="Cancellation Strikes (Posters)" variant="warning">
                    <p className="mb-1">Cancelling a job <strong className="text-foreground">after a helpr has been selected</strong> triggers escalating penalties:</p>
                    <p>• <strong className="text-accent">1st cancellation:</strong> Written warning (Strike 1/2)</p>
                    <p>• <strong className="text-accent">2nd cancellation:</strong> Final warning (Strike 2/2)</p>
                    <p>• <strong className="text-destructive">3rd cancellation:</strong> Permanent account ban</p>
                    <p className="italic text-xs mt-1">Cancelling jobs with no helpr assigned does not count toward strikes.</p>
                  </LegalCard>
                  <LegalCard icon={<Ban className="w-4 h-4 text-destructive" />} title="Job Denial Strikes (Helprs)" variant="warning">
                    <p className="mb-1">Declining a job <strong className="text-foreground">after being selected</strong> triggers escalating penalties:</p>
                    <p>• <strong className="text-accent">1st decline:</strong> Written warning (Strike 1/2)</p>
                    <p>• <strong className="text-accent">2nd decline:</strong> Final warning (Strike 2/2)</p>
                    <p>• <strong className="text-destructive">3rd decline:</strong> Permanent account ban</p>
                    <p className="italic text-xs mt-1">Withdrawing your application before being selected does not count.</p>
                  </LegalCard>
                </div>
              </div>

              {/* Safety & Enforcement Section */}
              <div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Safety & Enforcement</h2>
                <div className="space-y-2">
                  <LegalCard icon={<Ban className="w-4 h-4 text-destructive" />} title="No-Show Policy" variant="warning">
                    <p>If a helpr accepts a job and fails to show up without prior cancellation, their account is <strong className="text-destructive">permanently banned</strong> immediately. No warnings, no exceptions. The poster receives a full refund.</p>
                  </LegalCard>
                  <LegalCard icon={<Shield className="w-4 h-4 text-destructive" />} title="Immediate Ban Offenses" variant="warning">
                    <p className="mb-1">These skip all warnings and result in an immediate permanent ban:</p>
                    <p>• <strong className="text-foreground">No-show</strong> — accepting a job and not showing up</p>
                    <p>• <strong className="text-foreground">Fraud</strong> — fake profiles, falsified photos, or payment manipulation</p>
                    <p>• <strong className="text-foreground">Harassment or threats</strong> — abusive language, intimidation, or safety threats</p>
                    <p>• <strong className="text-foreground">Off-platform payments</strong> — arranging payment outside of Helpr</p>
                    <p>• <strong className="text-foreground">Identity fraud</strong> — using someone else's identity or fake ID</p>
                    <p>• <strong className="text-foreground">Dispute abuse</strong> — filing false disputes to avoid paying</p>
                  </LegalCard>
                  <LegalCard icon={<AlertTriangle className="w-4 h-4 text-accent" />} title="Repeat Offender Policy">
                    <p><strong className="text-foreground">1st violation:</strong> Written warning via email and in-app notification.</p>
                    <p><strong className="text-foreground">2nd violation:</strong> 7-day account suspension.</p>
                    <p><strong className="text-foreground">3rd violation:</strong> Permanent ban from the platform.</p>
                    <p className="italic text-xs mt-1">Severe violations (no-shows, fraud, harassment) skip this ladder and result in an immediate permanent ban.</p>
                  </LegalCard>
                  <LegalCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="User Report Policy" variant="warning">
                    <p className="mb-1">If other users report your account for misconduct:</p>
                    <p>• <strong className="text-accent">2 reports:</strong> Account suspension while admins review.</p>
                    <p>• <strong className="text-destructive">3rd report:</strong> Permanent ban from the platform.</p>
                    <p className="italic text-xs mt-1">All reports are reviewed by admins. False reports may result in action against the reporter.</p>
                  </LegalCard>
                </div>
              </div>

              {/* Job Rules Section */}
              <div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Job Rules</h2>
                <div className="space-y-2">
                  <LegalCard icon={<Clock className="w-4 h-4 text-primary" />} title="Job Editing Restrictions">
                    <p><strong className="text-foreground">Before helpr selected:</strong> You can freely edit job details.</p>
                    <p><strong className="text-foreground">After helpr selected:</strong> Jobs are locked and cannot be edited. Use addon requests for adjustments, or cancel and repost.</p>
                  </LegalCard>
                  <LegalCard icon={<Scale className="w-4 h-4 text-primary" />} title="Dispute Resolution">
                    <p><strong className="text-foreground">48-hour review:</strong> All disputes are reviewed by our team within 48 hours. Both parties can submit evidence.</p>
                    <p><strong className="text-foreground">24-hour appeal:</strong> After a decision, both parties have 24 hours to appeal with new evidence.</p>
                    <p><strong className="text-foreground">Escrow hold:</strong> Funds are held in escrow until resolution.</p>
                  </LegalCard>
                  <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="New Helper Restrictions">
                    <p><strong className="text-foreground">Job Limit:</strong> New helprs are limited to 3 active jobs at a time until they build a track record.</p>
                    <p><strong className="text-foreground">Earnings Cap:</strong> Total earnings capped at $100 until 3 verified completions with a 4+ star rating.</p>
                    <p><strong className="text-foreground">Response Deadlines:</strong> Helpers must respond to job offers within 1–48 hours (set by the poster).</p>
                  </LegalCard>
                  <LegalCard icon={<Shield className="w-4 h-4 text-primary" />} title="Safety & Verification">
                    <p><strong className="text-foreground">Age Verification:</strong> All users must be 18+ to use Helpr.</p>
                    <p><strong className="text-foreground">ID Verification:</strong> Helpers must upload a valid government-issued ID.</p>
                    <p><strong className="text-foreground">GPS Check-in:</strong> Helpers must check in within 500ft of the job location.</p>
                    <p><strong className="text-foreground">Minimum Duration:</strong> Jobs cannot be marked complete until at least 30 minutes have passed.</p>
                    <p><strong className="text-foreground">Photo Proof:</strong> Before and after photos are required for completion.</p>
                    <p><strong className="text-foreground">Chat Safety:</strong> Messages are scanned for off-platform payment attempts.</p>
                  </LegalCard>
                </div>
              </div>
            </div>
          )}

          {/* WARNINGS & STRIKES TAB */}
          {tab === "warnings" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setTab("landing")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-lg font-display font-bold text-foreground">Warnings & Strikes</h1>
              </div>

              {violationsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : violations.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
                  <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-7 h-7 text-green-600" />
                  </div>
                  <h2 className="text-base font-display font-bold text-foreground">Clean record!</h2>
                  <p className="text-sm text-muted-foreground">You have no warnings or strikes on your account. Keep up the great work.</p>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-2">
                    {(() => {
                      const warnings = violations.filter(v => v.action_taken === "warning").length;
                      const suspensions = violations.filter(v => v.action_taken === "suspension" || v.action_taken === "temporary_ban").length;
                      const bans = violations.filter(v => v.action_taken === "permanent_ban").length;
                      return (
                        <>
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                            <p className="text-2xl font-bold text-amber-600">{warnings}</p>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Warnings</p>
                          </div>
                          <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 text-center">
                            <p className="text-2xl font-bold text-orange-600">{suspensions}</p>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Suspensions</p>
                          </div>
                          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-center">
                            <p className="text-2xl font-bold text-destructive">{bans}</p>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Bans</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Strike progress */}
                  {(() => {
                    const strikeCount = violations.length;
                    return (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-foreground">Strike Progress</span>
                          <span className={`text-xs font-bold ${strikeCount >= 3 ? "text-destructive" : strikeCount >= 2 ? "text-orange-600" : "text-amber-600"}`}>
                            {strikeCount}/3
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          {[1, 2, 3].map(i => (
                            <div
                              key={i}
                              className={`h-2 flex-1 rounded-full transition-colors ${
                                i <= strikeCount
                                  ? i === 3 ? "bg-destructive" : i === 2 ? "bg-orange-500" : "bg-amber-500"
                                  : "bg-muted"
                              }`}
                            />
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {strikeCount === 0 ? "No strikes — you're in good standing."
                            : strikeCount === 1 ? "1 strike — this is your first warning."
                            : strikeCount === 2 ? "2 strikes — one more violation may result in a permanent ban."
                            : "3+ strikes — your account may be permanently banned."}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Violation history */}
                  <div className="space-y-2">
                    <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider">History</h2>
                    {violations.map((v) => (
                      <div key={v.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                              v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive"
                              : v.action_taken === "suspension" || v.action_taken === "temporary_ban" ? "bg-orange-500/10 text-orange-600"
                              : "bg-amber-500/10 text-amber-600"
                            }`}>
                              {v.action_taken.replace(/_/g, " ")}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground shrink-0">
                              {v.violation_type.replace(/_/g, " ")}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                            {v.created_at ? new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </span>
                        </div>
                        {v.description && (
                          <p className="text-sm text-muted-foreground leading-relaxed">{v.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const ScheduleCard = ({ job, isPosted }: { job: Job; isPosted: boolean }) => (
  <div className={`rounded-xl border p-3 ${
    job.status === "open" ? "bg-primary/10 text-primary border-primary/20" :
    job.status === "in_progress" || job.status === "accepted" ? "bg-accent/20 text-accent-foreground border-accent/30" :
    "border-border bg-card"
  }`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h4 className="font-semibold text-sm">{job.title}</h4>
          <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 font-medium">{isPosted ? "Posted" : "Assigned"}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
          {job.start_time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.start_time}</span>}
        </div>
      </div>
      <span className="text-xs font-medium capitalize">{job.status.replace("_", " ")}</span>
    </div>
  </div>
);


const LegalCard = ({ icon, title, children, variant }: { icon: React.ReactNode; title: string; children: React.ReactNode; variant?: "warning" }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border p-4 transition-colors ${variant === "warning" ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 font-display font-semibold text-foreground text-sm">
          {icon} {title}
        </span>
        <ChevronRightIcon className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="text-sm text-muted-foreground space-y-1.5 mt-3 pt-3 border-t border-border/50">{children}</div>}
    </div>
  );
};

const tierConfig = [
  {
    id: "basic",
    name: "Basic",
    badge: "⭐",
    monthly: "$5/mo",
    annual: "$50/yr",
    lifetime: "$5",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Helpr Badge", "Search Priority", "5-min Early Job Access"],
  },
  {
    id: "pro",
    name: "Pro",
    badge: "🔥",
    monthly: "$10/mo",
    annual: "$100/yr",
    lifetime: "$10",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Everything in Basic", "Boosted Visibility", "Portfolio Showcase", "Weekly Reports", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    badge: "💎",
    monthly: "$15/mo",
    annual: "$150/yr",
    lifetime: "$15",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Landing Page Spotlight", "Auto-Match Jobs", "Priority Dispute Resolution", "20-min Early Access"],
  },
];

const SubscriptionTab = ({ profile, user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "lifetime">("lifetime");
  const [billingDay, setBillingDay] = useState<number>(1);
  const currentTier = profile?.subscription_tier || null;

  const handleManageSubscription = async () => {
    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open subscription portal");
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSubscribe = async (tier: string) => {
    setLoadingCheckout(tier);
    try {
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", {
        body: { tier, interval: billingInterval, ...(billingInterval === "monthly" ? { billing_day: billingDay } : {}) },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setLoadingCheckout(null);
    }
  };

  const getPrice = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annual;
    if (billingInterval === "lifetime") return tier.lifetime;
    return tier.monthly;
  };

  const getSaveBadge = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annualSave;
    if (billingInterval === "lifetime") return "Best value";
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Subscription</h1>
      </div>

      {currentTier && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              <span className="font-bold text-foreground capitalize">{currentTier} Plan</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">Active</span>
          </div>
          <Button
            onClick={handleManageSubscription}
            disabled={loadingPortal}
            variant="outline"
            className="w-full"
          >
            {loadingPortal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Manage Subscription
          </Button>
        </div>
      )}

      {!currentTier && (
        <p className="text-sm text-muted-foreground">You're on the free plan. Upgrade to unlock premium features and get more jobs.</p>
      )}

      {/* Billing Interval Toggle */}
      <div className="flex items-center justify-center gap-1 p-1 rounded-xl bg-muted">
        {([
          { key: "lifetime", label: "One-Time" },
          { key: "monthly", label: "Monthly" },
          { key: "annual", label: "Annual" },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setBillingInterval(opt.key)}
            className={`flex-1 text-sm font-medium py-2 px-3 rounded-lg transition-all ${
              billingInterval === opt.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {billingInterval === "monthly" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <label className="text-sm font-medium text-foreground">Billing day of the month</label>
          <select
            value={billingDay}
            onChange={(e) => setBillingDay(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day === 1 ? "1st" : day === 2 ? "2nd" : day === 3 ? "3rd" : `${day}th`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">You'll be charged on this day each month</p>
        </div>
      )}

      <div className="space-y-3">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id;
          const saveBadge = getSaveBadge(tier);
          return (
            <div
              key={tier.id}
              className={`rounded-2xl border p-5 space-y-3 ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-foreground">{tier.badge} {tier.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-primary">{getPrice(tier)}</p>
                    {saveBadge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {saveBadge}
                      </span>
                    )}
                  </div>
                </div>
                {isActive && (
                  <span className="flex items-center gap-1 text-xs text-primary font-medium">
                    <CheckCircle className="w-4 h-4" /> Current
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {tier.features.map((f) => (
                  <li key={f} className="text-xs text-muted-foreground flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              {!isActive && (
                <Button
                  onClick={() => currentTier ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className="w-full"
                  variant="outline"
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {currentTier ? "Change Plan" : billingInterval === "lifetime" ? "Buy Now" : "Subscribe"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProfilePage;
