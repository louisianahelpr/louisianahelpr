import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { createNotification } from "@/lib/notifications";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { safeStorage } from "@/lib/safeStorage";
import { toast } from "sonner";
import { Star, ShieldAlert, Clock, MailIcon, ShieldCheck, MessageCircle, Briefcase, MapPin, CreditCard, Flag, DollarSign } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logAdminAction } from "@/lib/adminAudit";
import { report } from "@/lib/errorLogger";
import { AutoRestrictedRail } from "./AutoRestrictedRail";
import { DenyUserDialog } from "./DenyUserDialog";
import { BanDialog } from "./BanDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { EditEmailDialog } from "./EditEmailDialog";
import { ManualVerifyDialog } from "./ManualVerifyDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ReuploadIdDialog } from "./ReuploadIdDialog";
import { FormalWarningDialog } from "./FormalWarningDialog";
import { AdminUserDetailDialog } from "./AdminUserDetailDialog";
import {
  type Profile,
  isVerifiedEmail,
  isPendingReview,
  isAwaitingEmail,
  wasFlaggedByStripe,
  statusBadge,
} from "./adminUserHelpers";
import { useAdminUserSummaries } from "./useAdminUserSummaries";

type Tab = "pending" | "awaiting_email" | "approved" | "denied" | "banned" | "all";

const AdminUsers = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

  // Auto-restricted rail moved to its own component (AutoRestrictedRail).
  // Owns its own data fetch + reverse handler. Parent only forwards the
  // "Review" callback so the existing profile detail dialog can open.

  // Profile detail view
  const [viewProfile, setViewProfile] = useState<Profile | null>(null);
  const [profileReviews, setProfileReviews] = useState<{ rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileReviewsLeft, setProfileReviewsLeft] = useState<{ rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileViolations, setProfileViolations] = useState<any[]>([]);
  const [, setProfileBans] = useState<any[]>([]);
  const [idDocSignedUrl, setIdDocSignedUrl] = useState<string | null>(null);
  const [emailTracking, setEmailTracking] = useState<{ event_type: string; email_type: string; created_at: string }[]>([]);
  const [emailSendStats, setEmailSendStats] = useState<{ template_name: string; count: number; last_sent: string }[]>([]);
  // Jobs history (worked as helper + posted as customer) — the Jobs-tab
  // filter/sort state lives inside AdminUserDetailDialog now.
  const [profileJobs, setProfileJobs] = useState<any[]>([]);

  // Deny dialog — moved into DenyUserDialog component. Parent only
  // tracks "which profile is being denied right now"; the dialog
  // owns reason + saving state internally.
  const [denyProfile, setDenyProfile] = useState<Profile | null>(null);

  // Ban dialog — moved into BanDialog component. Parent only tracks
  // which profile is targeted; dialog owns type/reason/duration/saving.
  const [banProfile, setBanProfile] = useState<Profile | null>(null);

  // Edit email dialog
  // Edit email dialog — moved into EditEmailDialog component.
  const [editEmailProfile, setEditEmailProfile] = useState<Profile | null>(null);

  // Delete denied account
  // Delete dialog — moved into DeleteUserDialog component.
  const [deleteProfile, setDeleteProfile] = useState<Profile | null>(null);

  // Per-action dialog targets — each dialog owns its own form state +
  // edge-fn invocation + saving flag internally now (ReuploadIdDialog,
  // FormalWarningDialog, ManualVerifyDialog, ResetPasswordDialog). The
  // parent only tracks "which profile is the dialog targeting."
  const [reuploadProfile, setReuploadProfile] = useState<Profile | null>(null);
  const [warningProfile, setWarningProfile] = useState<Profile | null>(null);
  const [manualVerifyProfile, setManualVerifyProfile] = useState<Profile | null>(null);
  const [resetPwProfile, setResetPwProfile] = useState<Profile | null>(null);

  // Per-user supplemental data (ratings, strikes, pay, activity, notes,
  // open reports) — owned by the useAdminUserSummaries hook.
  const {
    notesSummary,
    strikesSummary,
    lastLoginSummary,
    paySummary,
    ratingSummary,
    jobsCompletedSummary,
    openReportsSummary,
    loadSummaries,
  } = useAdminUserSummaries();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc" | "alpha" | "standing_worst" | "standing_best" | "pay_high" | "pay_low" | "joined_new" | "joined_old" | "never_logged_in">("alpha");

  // Track which user IDs the admin has already seen (per tab category) — persisted in storage
  const SEEN_KEY = "admin_seen_user_ids_v1";
  const [seenUserIds, setSeenUserIds] = useState<Set<string>>(() => {
    try {
      const raw = safeStorage.getItem(SEEN_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const markUsersSeen = (ids: string[]) => {
    if (!ids.length) return;
    setSeenUserIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (changed) {
        try {
          safeStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(next)));
        } catch {}
      }
      return next;
    });
  };

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setProfiles(data);
      // Load supplemental data in parallel (non-blocking). `profiles` (the
      // prior render's state) is passed for loadActivitySummary's
      // failed-ID detection — matching the previous closure behaviour.
      loadSummaries(data.map((p) => p.user_id), profiles);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  // Deep-link from admin notifications: /admin?view=people&user=<id>.
  // Once profiles are loaded, find the user and open their detail dialog
  // automatically. Strip the ?user= param afterwards so navigating back
  // doesn't re-open the dialog every time.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const userIdParam = searchParams.get("user");
    if (!userIdParam || profiles.length === 0) return;
    const target = profiles.find((p) => p.user_id === userIdParam);
    if (target) {
      openProfile(target);
      const next = new URLSearchParams(searchParams);
      next.delete("user");
      setSearchParams(next, { replace: true });
    }
  }, [profiles, searchParams]);

  const openProfile = async (profile: Profile) => {
    setViewProfile(profile);
    setIdDocSignedUrl(null);
    setEmailTracking([]);
    setEmailSendStats([]);
    setProfileJobs([]);

    const [reviewsRes, reviewsLeftRes, violationsRes, bansRes, trackingRes, sendLogRes, jobsRes] = await Promise.all([
      supabase.from("reviews").select("rating, feedback, reviewer_id, created_at, job_id").eq("reviewee_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("reviews").select("rating, feedback, reviewee_id, created_at, job_id").eq("reviewer_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("user_violations").select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("user_bans").select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("email_tracking").select("event_type, email_type, created_at").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      profile.email
        ? supabase.from("email_send_log")
            .select("template_name, message_id, status, created_at")
            .eq("recipient_email", profile.email)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("jobs")
        .select("id, title, status, payment_status, budget, helper_fee_percent, customer_fee_amount, platform_fee_amount, sales_tax_amount, customer_id, helper_id, created_at, updated_at, poster_completed_at, helper_completed_at, parish")
        .or(`customer_id.eq.${profile.user_id},helper_id.eq.${profile.user_id}`)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    setProfileJobs(jobsRes.data || []);

    // Generate signed URL for private ID document
    if (profile.id_document_url) {
      const { data: signedData } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(profile.id_document_url, 3600); // 1 hour
      if (signedData?.signedUrl) {
        setIdDocSignedUrl(signedData.signedUrl);
      }
    }

    // Build a single lookup of all related users + jobs from both review sets
    const relatedUserIds = new Set<string>();
    const relatedJobIds = new Set<string>();
    (reviewsRes.data || []).forEach((r: any) => { relatedUserIds.add(r.reviewer_id); if (r.job_id) relatedJobIds.add(r.job_id); });
    (reviewsLeftRes.data || []).forEach((r: any) => { relatedUserIds.add(r.reviewee_id); if (r.job_id) relatedJobIds.add(r.job_id); });

    const [relatedUsersRes, relatedJobsRes] = await Promise.all([
      relatedUserIds.size > 0
        ? supabase.from("profiles").select("user_id, full_name").in("user_id", Array.from(relatedUserIds))
        : Promise.resolve({ data: [] as any[] }),
      relatedJobIds.size > 0
        ? supabase.from("jobs").select("id, title").in("id", Array.from(relatedJobIds))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameMap = new Map((relatedUsersRes.data || []).map((p: any) => [p.user_id, formatName(p.full_name)]));
    const jobMap = new Map((relatedJobsRes.data || []).map((j: any) => [j.id, j.title]));

    setProfileReviews((reviewsRes.data || []).map((r: any) => ({
      rating: r.rating,
      feedback: r.feedback,
      reviewer_name: nameMap.get(r.reviewer_id) || "User",
      created_at: r.created_at,
      job_title: r.job_id ? jobMap.get(r.job_id) : undefined,
    })));
    setProfileReviewsLeft((reviewsLeftRes.data || []).map((r: any) => ({
      rating: r.rating,
      feedback: r.feedback,
      reviewee_name: nameMap.get(r.reviewee_id) || "User",
      created_at: r.created_at,
      job_title: r.job_id ? jobMap.get(r.job_id) : undefined,
    })));

    setProfileViolations(violationsRes.data || []);
    setProfileBans(bansRes.data || []);
    setEmailTracking(trackingRes.data || []);

    // Deduplicate email_send_log by message_id (latest status per email),
    // count successful sends per template_name.
    const rows = (sendLogRes.data || []) as { template_name: string; message_id: string | null; status: string; created_at: string }[];
    const latestByMsg = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const key = r.message_id || `${r.template_name}-${r.created_at}`;
      if (!latestByMsg.has(key)) latestByMsg.set(key, r); // first iteration is latest (ordered desc)
    }
    const counts = new Map<string, { count: number; last_sent: string }>();
    for (const r of latestByMsg.values()) {
      if (!["sent", "pending"].includes(r.status)) continue; // count delivered/queued only
      const existing = counts.get(r.template_name);
      if (existing) {
        existing.count += 1;
        if (r.created_at > existing.last_sent) existing.last_sent = r.created_at;
      } else {
        counts.set(r.template_name, { count: 1, last_sent: r.created_at });
      }
    }
    setEmailSendStats(
      Array.from(counts.entries())
        .map(([template_name, v]) => ({ template_name, count: v.count, last_sent: v.last_sent }))
        .sort((a, b) => b.count - a.count)
    );
  };

  const approveUser = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({
      approval_status: "approved",
      approval_email_count: 1,
      last_approval_email_at: new Date().toISOString(),
      // Clear denial info so re-approved users are fully removed from the Denied tab
      denial_reason: null,
      denial_email_count: 0,
      last_denial_email_at: null,
    }).eq("id", profile.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`${formatName(profile.full_name)} approved!`);
      await logAdminAction("approve_user", "user", profile.user_id, { name: profile.full_name });
      await createNotification({
        user_id: profile.user_id, title: "Account approved!",
        message: "Your account has been approved. You can now use the platform.",
        type: "success", link: "/dashboard",
      });
      // Send approval email
      supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "approved" },
      }).catch((err) => report(err, { tags: { source: "AdminUsers.sendApprovalEmail" } }));
      loadProfiles();
      setViewProfile(null);
    }
  };

  const resendApprovalEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { error } = await supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "approved" },
      });
      if (error) throw error;

      await supabase.from("profiles").update({
        approval_email_count: (profile.approval_email_count || 0) + 1,
        last_approval_email_at: new Date().toISOString(),
      }).eq("id", profile.id);

      toast.success("Approval email resent");
      loadProfiles();
    } catch (err: any) {
      toast.error("Failed to resend email");
      report(err, { tags: { source: "AdminUsers.resendApprovalEmail" } });
    } finally {
      setResending(null);
    }
  };

  // denyUser logic moved into DenyUserDialog. This component only opens
  // the dialog (via setDenyProfile) and handles the post-success refetch
  // through DenyUserDialog's onSuccess prop.

  // deleteDeniedUser logic moved into DeleteUserDialog. Parent only
  // opens via setDeleteProfile + refetches via the dialog's onSuccess.

  const [resending, setResending] = useState<string | null>(null);

  const resendDenialEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { error } = await supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "denied", reason: profile.denial_reason || "" },
      });
      if (error) throw error;

      // Update count
      await supabase.from("profiles").update({
        denial_email_count: (profile.denial_email_count || 0) + 1,
        last_denial_email_at: new Date().toISOString(),
      }).eq("id", profile.id);

      toast.success("Denial email resent");
      loadProfiles();
    } catch (err: any) {
      toast.error("Failed to resend email");
      report(err, { tags: { source: "AdminUsers.resendDenialEmail" } });
    } finally {
      setResending(null);
    }
  };

  const resendVerificationEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-resend-verification", {
        body: { userId: profile.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Verification email resent");
      loadProfiles();
    } catch (err: any) {
      toast.error(err.message || "Failed to resend verification email");
      report(err, { tags: { source: "AdminUsers.resendVerificationEmail" } });
    } finally {
      setResending(null);
    }
  };

  // handleBanAction logic moved into BanDialog. Parent only opens the
  // dialog (via setBanProfile) and refetches via the dialog's onSuccess.

  const unbanUser = async (profile: Profile) => {
    await supabase.from("user_bans").update({ is_active: false }).eq("user_id", profile.user_id).eq("is_active", true);
    await supabase.from("profiles").update({ ban_status: "active" }).eq("user_id", profile.user_id);
    await supabase.from("notifications").insert({
      user_id: profile.user_id, title: "✅ Ban lifted",
      message: "Your account ban has been lifted. Please follow community guidelines going forward.",
      type: "success", link: "/dashboard",
    });
    toast.success("User unbanned.");
    loadProfiles();
    setViewProfile(null);
  };

  // handleUpdateEmail logic moved into EditEmailDialog. Parent only opens
  // via setEditEmailProfile + refetches via the dialog's onSuccess prop.

  // callAdminAction was the shared coordinator across the 4 admin-action
  // dialogs (manual_verify, request_id_reupload, reset_password,
  // formal_warning). Each of those dialogs now lives in its own file
  // and calls admin-user-actions itself, so this helper is no longer
  // needed in the parent.

  const viewHistoryFor = (profile: Profile) => {
    // Notify the Admin page to switch to notification logs filtered for this user
    window.dispatchEvent(new CustomEvent("admin:view-user-history", {
      detail: { userId: profile.user_id, email: profile.email },
    }));
    setViewProfile(null);
  };

  const filtered = profiles.filter((p) => {
    // Tab filter
    if (tab === "pending" && !isPendingReview(p)) return false;
    else if (tab === "awaiting_email" && !isAwaitingEmail(p)) return false;
    else if (tab === "approved" && !(p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes(p.ban_status || ""))) return false;
    else if (tab === "denied" && (p.approval_status !== "denied" || (p as { role?: string }).role === "customer")) return false;
    else if (tab === "banned" && !["temp_banned", "permanently_banned"].includes(p.ban_status || "")) return false;

    // Search by name (also matches email for convenience)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${p.full_name || ""} ${p.email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortDir === "alpha") {
      const aName = (a.full_name || a.email || "").toLowerCase();
      const bName = (b.full_name || b.email || "").toLowerCase();
      return aName.localeCompare(bName);
    }
    if (sortDir === "standing_worst" || sortDir === "standing_best") {
      const aStrikes = strikesSummary[a.user_id] || 0;
      const bStrikes = strikesSummary[b.user_id] || 0;
      if (aStrikes !== bStrikes) {
        return sortDir === "standing_worst" ? bStrikes - aStrikes : aStrikes - bStrikes;
      }
      // Tiebreaker: most recent login
      const aLogin = lastLoginSummary[a.user_id];
      const bLogin = lastLoginSummary[b.user_id];
      if (!aLogin && !bLogin) return 0;
      if (!aLogin) return 1;
      if (!bLogin) return -1;
      return new Date(bLogin).getTime() - new Date(aLogin).getTime();
    }
    if (sortDir === "pay_high" || sortDir === "pay_low") {
      const aPay = paySummary[a.user_id] || 0;
      const bPay = paySummary[b.user_id] || 0;
      return sortDir === "pay_high" ? bPay - aPay : aPay - bPay;
    }
    if (sortDir === "joined_new" || sortDir === "joined_old") {
      const aJoined = new Date(a.created_at || 0).getTime();
      const bJoined = new Date(b.created_at || 0).getTime();
      return sortDir === "joined_new" ? bJoined - aJoined : aJoined - bJoined;
    }
    if (sortDir === "never_logged_in") {
      // Never-logged-in users first, then those with the oldest signup date among them.
      // Logged-in users fall to the bottom, sorted by most recent login last.
      const aLogin = lastLoginSummary[a.user_id];
      const bLogin = lastLoginSummary[b.user_id];
      if (!aLogin && !bLogin) {
        // Both never logged in — oldest signups first (most concerning)
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      }
      if (!aLogin) return -1;
      if (!bLogin) return 1;
      return new Date(bLogin).getTime() - new Date(aLogin).getTime();
    }
    const aLogin = lastLoginSummary[a.user_id];
    const bLogin = lastLoginSummary[b.user_id];
    if (!aLogin && !bLogin) return 0;
    if (!aLogin) return 1;
    if (!bLogin) return -1;
    const diff = new Date(bLogin).getTime() - new Date(aLogin).getTime();
    return sortDir === "desc" ? diff : -diff;
  });

  const isUnseen = (p: Profile) => !seenUserIds.has(p.user_id);

  // When the admin views a tab, mark the users they're seeing as "seen" so the
  // notification badge clears after a short dwell. Runs on tab change + new data.
  useEffect(() => {
    if (loading || filtered.length === 0) return;
    const ids = filtered.map((p) => p.user_id);
    const t = setTimeout(() => markUsersSeen(ids), 800);
    return () => clearTimeout(t);
     
  }, [tab, profiles.length, loading]);
  // Pending + Email badges always show the FULL queue so admins know what's outstanding
  // (other tabs continue to use the "unseen" filter as a new-since-last-visit indicator)
  const pendingCount = profiles.filter((p) => isPendingReview(p)).length;
  const awaitingEmailCount = profiles.filter((p) => isAwaitingEmail(p)).length;
  const bannedCount = profiles.filter(
    (p) => ["temp_banned", "permanently_banned"].includes(p.ban_status || "") && isUnseen(p),
  ).length;

  // Notes icon w/ count badge + hover preview of recent 2 notes
  const NotesIndicator = ({ userId }: { userId: string }) => {
    const summary = notesSummary[userId];
    if (!summary || summary.count === 0) return null;
    return (
      <HoverCard openDelay={120}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="relative inline-flex items-center justify-center text-accent-foreground hover:text-primary transition-colors"
            aria-label={`${summary.count} admin note${summary.count > 1 ? "s" : ""}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-accent-foreground text-[9px] font-bold flex items-center justify-center border border-background">
              {summary.count}
            </span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-72 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recent admin notes ({summary.count})</p>
          {summary.recent.map((n, i) => (
            <div key={i} className="text-ds-11 space-y-0.5 border-l-2 border-accent/40 pl-2">
              <p className="text-foreground line-clamp-3">{n.note}</p>
              <p className="text-muted-foreground text-ds-11">
                {n.category} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
              </p>
            </div>
          ))}
        </HoverCardContent>
      </HoverCard>
    );
  };

  if (loading) return <p className="text-muted-foreground">Loading users…</p>;

  const approvedCount = profiles.filter(
    (p) =>
      p.approval_status === "approved" &&
      !["temp_banned", "permanently_banned"].includes(p.ban_status || "") &&
      isUnseen(p),
  ).length;
  // Unified user model: no helper-vs-customer distinction in the count.
  // (Previous version filtered out denied "customers" via a non-existent
  // p.role property, which evaluated to undefined !== "customer" → true,
  // i.e. it was a no-op anyway.)
  const deniedCount = profiles.filter(
    (p) => p.approval_status === "denied" && isUnseen(p),
  ).length;
  const allCount = profiles.filter(isUnseen).length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "awaiting_email", label: "Email", count: awaitingEmailCount },
    { key: "approved", label: "Active", count: approvedCount },
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "denied", label: "Denied", count: deniedCount },
    { key: "all", label: "All", count: allCount },
  ];

  const tabCountLabel: Record<Tab, string> = {
    pending: "pending",
    awaiting_email: "pending email verification",
    approved: "active",
    banned: "banned",
    denied: "denied",
    all: "total",
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5 w-full">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-0 px-1 py-1.5 rounded-md text-[10px] sm:text-ds-13 font-medium transition-colors flex items-center justify-center gap-0.5 ${
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="text-[9px] sm:text-[10px] bg-destructive/10 text-destructive px-1 py-0.5 rounded-full flex-shrink-0">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Recently auto-restricted rail — extracted into its own component.
          Hides itself when empty; reverse + review handlers live there. */}
      <AutoRestrictedRail
        onReview={(userId) => {
          const p = profiles.find((pr) => pr.user_id === userId);
          if (p) openProfile(p);
        }}
        onChange={() => loadProfiles()}
      />

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="search"
          aria-label="Search users by name"
          placeholder="Search by name…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 text-ds-13 flex-1"
        />
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as typeof sortDir)}>
          <SelectTrigger className="h-9 text-ds-13 sm:w-[220px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Most Recent</SelectItem>
            <SelectItem value="asc">Longest Inactive</SelectItem>
            <SelectItem value="alpha">Alphabetical (A–Z)</SelectItem>
            <SelectItem value="joined_new">Joined: Newest First</SelectItem>
            <SelectItem value="joined_old">Joined: Oldest First</SelectItem>
            <SelectItem value="never_logged_in">Never Logged In First</SelectItem>
            <SelectItem value="pay_high">Pay: High → Low</SelectItem>
            <SelectItem value="pay_low">Pay: Low → High</SelectItem>
            {tab === "approved" && (
              <>
                <SelectItem value="standing_worst">Standing: Worst First</SelectItem>
                <SelectItem value="standing_best">Standing: Best First</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-ds-11 text-muted-foreground">
          {filtered.length} {tabCountLabel[tab]} {filtered.length === 1 ? "user" : "users"}
        </p>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-[11px] text-primary hover:underline"
          >
            Clear search
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground text-center py-8">No users in this category.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-ds-md liquid-glass p-3 cursor-pointer hover:bg-secondary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => openProfile(p)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openProfile(p);
                }
              }}
            >
              <div className="flex items-start gap-3">
                {(() => {
                  const lastLogin = lastLoginSummary[p.user_id];
                  const isOnline = lastLogin
                    ? (Date.now() - new Date(lastLogin).getTime()) < 24 * 60 * 60 * 1000
                    : false;
                  return (
                    <div className="relative flex-shrink-0">
                      {p.avatar_url ? (
                        <img loading="lazy" decoding="async" src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground text-ds-11 font-medium">
                          {formatName(p.full_name, "?")[0]?.toUpperCase()}
                        </div>
                      )}
                      {isOnline && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-card"
                          title="Active in last 24h"
                        />
                      )}
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-foreground text-ds-13 truncate">{formatName(p.full_name, "—")}</p>
                    {statusBadge(p)}
                    <NotesIndicator userId={p.user_id} />
                  </div>
                  {/* Wait-time countdown — shown for both pending review and awaiting-email-verification */}
                  {(tab === "pending" || tab === "awaiting_email") && (isPendingReview(p) || isAwaitingEmail(p)) && (() => {
                    const waitMs = Date.now() - new Date(p.created_at).getTime();
                    const waitHours = waitMs / (1000 * 60 * 60);
                    const waitDays = Math.floor(waitHours / 24);
                    const remHours = Math.floor(waitHours % 24);
                    const label = waitDays > 0
                      ? `${waitDays}d ${remHours}h waiting`
                      : `${Math.floor(waitHours)}h waiting`;
                    const tone = waitHours >= 48
                      ? "bg-destructive/15 text-destructive border-destructive/30"
                      : waitHours >= 24
                      ? "bg-accent/20 text-accent-foreground border-accent/30"
                      : "bg-primary/10 text-primary border-primary/20";
                    return (
                      <Badge variant="outline" className={`mt-1 h-5 px-2 text-[10px] font-semibold ${tone}`}>
                        <Clock className="w-2.5 h-2.5 mr-1" />
                        {label}
                      </Badge>
                    );
                  })()}

                  {/* Denial reason — surfaced prominently for denied users */}
                  {p.approval_status === "denied" && (
                    <p className="text-[11px] font-medium text-destructive truncate mt-1" title={p.denial_reason || "No reason on file"}>
                      Denied: {p.denial_reason || "No reason on file"}
                    </p>
                  )}

                  {/* Meta chips — only for verified users */}
                  {isVerifiedEmail(p) && p.approval_status !== "denied" && (() => {
                    const strikes = strikesSummary[p.user_id] || 0;
                    const rating = ratingSummary[p.user_id];
                    const jobsDone = jobsCompletedSummary[p.user_id] || 0;
                    const ltv = paySummary[p.user_id] || 0;
                    const openReports = openReportsSummary[p.user_id] || 0;
                    const lastLogin = lastLoginSummary[p.user_id];
                    const isApproved = p.approval_status === "approved";
                    const neverLoggedIn = isApproved && !lastLogin;
                    const hasIdv = p.idv_status === "verified";
                    const hasStripe = !!p.stripe_account_id;
                    // Same legacy-role pattern as deniedCount above.
                    const isHelper = (p as { role?: string }).role !== "customer";
                    const parish = p.parish;

                    const chip = (key: string, content: React.ReactNode, tone = "bg-secondary/40 text-muted-foreground") => (
                      <span key={key} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${tone}`}>
                        {content}
                      </span>
                    );

                    return (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {/* Standing — only show when there's something to flag, OR when no recent login signal exists.
                            Avoids duplicating "Good" alongside the "active X ago" chip. */}
                        {(strikes > 0 || !lastLogin) && chip(
                          "standing",
                          <>
                            <ShieldCheck className="w-3 h-3" />
                            {strikes === 0
                              ? "Good"
                              : strikes === 1
                                ? "1st Strike"
                                : strikes === 2
                                  ? "Final Warning"
                                  : "Banned"}
                          </>,
                          strikes === 0
                            ? "bg-primary/10 text-primary"
                            : strikes >= 3
                              ? "bg-destructive/15 text-destructive"
                              : strikes === 2
                                ? "bg-destructive/15 text-destructive"
                                : "bg-accent/20 text-accent-foreground"
                        )}

                        {/* Open reports/disputes — only show when present */}
                        {openReports > 0 && chip(
                          "reports",
                          <>
                            <Flag className="w-3 h-3" />
                            {openReports} open
                          </>,
                          "bg-destructive/15 text-destructive"
                        )}

                        {/* Rating + count (helpers especially, but show for anyone with reviews) */}
                        {rating && rating.count > 0 && chip(
                          "rating",
                          <>
                            <Star className="w-3 h-3 fill-current" />
                            {rating.avg.toFixed(1)} ({rating.count})
                          </>
                        )}

                        {/* Jobs completed */}
                        {jobsDone > 0 && chip(
                          "jobs",
                          <>
                            <Briefcase className="w-3 h-3" />
                            {jobsDone} job{jobsDone > 1 ? "s" : ""}
                          </>
                        )}

                        {/* Lifetime value (earned for helpers, spent for customers) */}
                        {ltv > 0 && chip(
                          "ltv",
                          <>
                            <DollarSign className="w-3 h-3" />
                            {ltv >= 1000 ? `${(ltv / 1000).toFixed(1)}k` : Math.round(ltv)}
                          </>
                        )}

                        {/* Parish — moderation/location signal */}
                        {parish && chip(
                          "parish",
                          <>
                            <MapPin className="w-3 h-3" />
                            {parish}
                          </>
                        )}

                        {/* Online / last seen */}
                        {neverLoggedIn ? chip(
                          "online",
                          <>
                            <Clock className="w-3 h-3" />
                            Never logged in
                          </>,
                          "bg-destructive/15 text-destructive font-semibold"
                        ) : lastLogin && chip(
                          "online",
                          <>
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(lastLogin), { addSuffix: true })}
                          </>
                        )}

                        {/* IDV verified — small icon-only chip for helpers */}
                        {isHelper && hasIdv && chip(
                          "idv",
                          <>
                            <ShieldCheck className="w-3 h-3" />
                            ID
                          </>,
                          "bg-primary/10 text-primary"
                        )}

                        {/* Stripe connected — icon-only chip for helpers */}
                        {isHelper && hasStripe && chip(
                          "stripe",
                          <>
                            <CreditCard className="w-3 h-3" />
                            Payout
                          </>,
                          "bg-primary/10 text-primary"
                        )}

                        {/* Follow-up reminder counter — shows how many nudge emails the system has sent */}
                        {(() => {
                          const status = p.approval_status;
                          let count = 0;
                          let lastAt: string | null = null;
                          let label = "";
                          if (status === "pending" && !isVerifiedEmail(p)) {
                            count = p.verification_email_count || 0;
                            lastAt = p.last_verification_email_at;
                            label = "Verify";
                          } else if (status === "approved") {
                            // Hide if user is already actively logged in — no need to track welcome nudges
                            if (lastLogin) return null;
                            count = p.approval_email_count || 0;
                            lastAt = p.last_approval_email_at;
                            label = "Welcome";
                          } else if (status === "denied") {
                            count = p.denial_email_count || 0;
                            lastAt = p.last_denial_email_at;
                            label = "Denial";
                          } else {
                            return null;
                          }
                          if (count === 0) return null;
                          const tone = count >= 3
                            ? "bg-destructive/15 text-destructive font-semibold"
                            : count >= 2
                            ? "bg-accent/20 text-accent-foreground"
                            : "bg-secondary/40 text-muted-foreground";
                          return chip(
                            "reminders",
                            <>
                              <MailIcon className="w-3 h-3" />
                              {label} {count}/3
                              {lastAt && <span className="opacity-70">· {formatDistanceToNow(new Date(lastAt), { addSuffix: true })}</span>}
                            </>,
                            tone
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              </div>
              {p.approval_status === "pending" && isVerifiedEmail(p) && wasFlaggedByStripe(p) && (
                <div className="flex gap-1.5 mt-2.5 flex-wrap items-center">
                  <Badge variant="outline" className="h-7 px-2 flex items-center gap-1 text-[10px] bg-accent/10 text-accent-foreground border-accent/30">
                    <ShieldAlert className="w-3 h-3" />
                    Flagged by Stripe
                  </Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}


      {/* Profile Detail Dialog (extracted to AdminUserDetailDialog) */}
      <AdminUserDetailDialog
        viewProfile={viewProfile}
        setViewProfile={setViewProfile}
        profileReviews={profileReviews}
        profileReviewsLeft={profileReviewsLeft}
        profileViolations={profileViolations}
        profileJobs={profileJobs}
        idDocSignedUrl={idDocSignedUrl}
        emailTracking={emailTracking}
        emailSendStats={emailSendStats}
        lastLoginSummary={lastLoginSummary}
        resending={resending}
        loadProfiles={loadProfiles}
        approveUser={approveUser}
        resendApprovalEmail={resendApprovalEmail}
        resendDenialEmail={resendDenialEmail}
        resendVerificationEmail={resendVerificationEmail}
        unbanUser={unbanUser}
        viewHistoryFor={viewHistoryFor}
        setEditEmailProfile={setEditEmailProfile}
        setDenyProfile={setDenyProfile}
        setBanProfile={setBanProfile}
        setDeleteProfile={setDeleteProfile}
        setManualVerifyProfile={setManualVerifyProfile}
        setWarningProfile={setWarningProfile}
        setResetPwProfile={setResetPwProfile}
      />

      {/* Deny Reason Dialog */}
      <DenyUserDialog
        profile={denyProfile}
        onClose={() => setDenyProfile(null)}
        onSuccess={() => {
          loadProfiles();
          setViewProfile(null);
        }}
      />

      {/* Ban / Warning Dialog */}
      <BanDialog
        profile={banProfile}
        onClose={() => setBanProfile(null)}
        onSuccess={() => {
          loadProfiles();
          setViewProfile(null);
        }}
      />

      {/* Edit Email + Delete dialogs — extracted into their own components. */}
      <EditEmailDialog
        profile={editEmailProfile}
        onClose={() => setEditEmailProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />
      <DeleteUserDialog
        profile={deleteProfile}
        onClose={() => setDeleteProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Manually Verify — extracted into ManualVerifyDialog. */}
      <ManualVerifyDialog
        profile={manualVerifyProfile}
        onClose={() => setManualVerifyProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* ID Re-upload — extracted into ReuploadIdDialog. */}
      <ReuploadIdDialog
        profile={reuploadProfile}
        onClose={() => setReuploadProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Reset Password — extracted into ResetPasswordDialog. */}
      <ResetPasswordDialog
        profile={resetPwProfile}
        onClose={() => setResetPwProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />

      {/* Formal Warning — extracted into FormalWarningDialog. */}
      <FormalWarningDialog
        profile={warningProfile}
        onClose={() => setWarningProfile(null)}
        onSuccess={() => { loadProfiles(); setViewProfile(null); }}
      />
    </div>
  );
};

export default AdminUsers;
