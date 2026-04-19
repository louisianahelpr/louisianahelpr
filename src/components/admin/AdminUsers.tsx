import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Star, FileText, Ban, AlertTriangle, ShieldAlert, Clock, MailIcon, RefreshCw, Eye, MousePointerClick, Pencil, Trash2, ShieldCheck, Camera, KeyRound, MessageSquareWarning, History, MessageCircle, User as UserIcon, Briefcase } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { logAdminAction } from "@/lib/adminAudit";
import AdminUserNotes from "./AdminUserNotes";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type Tab = "pending" | "awaiting_email" | "approved" | "denied" | "banned" | "all";

const AdminUsers = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

  // Profile detail view
  const [viewProfile, setViewProfile] = useState<Profile | null>(null);
  const [profileReviews, setProfileReviews] = useState<{ rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileReviewsLeft, setProfileReviewsLeft] = useState<{ rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[]>([]);
  const [profileViolations, setProfileViolations] = useState<any[]>([]);
  const [profileBans, setProfileBans] = useState<any[]>([]);
  const [idDocSignedUrl, setIdDocSignedUrl] = useState<string | null>(null);
  const [emailTracking, setEmailTracking] = useState<{ event_type: string; email_type: string; created_at: string }[]>([]);
  const [emailSendStats, setEmailSendStats] = useState<{ template_name: string; count: number; last_sent: string }[]>([]);
  // Jobs history (worked as helper + posted as customer)
  const [profileJobs, setProfileJobs] = useState<any[]>([]);
  const [jobsRole, setJobsRole] = useState<"all" | "worked" | "posted">("all");
  const [jobsSort, setJobsSort] = useState<"recent" | "earnings_desc" | "earnings_asc">("recent");

  // Deny dialog
  const [denyProfile, setDenyProfile] = useState<Profile | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denying, setDenying] = useState(false);

  // Ban dialog
  const [banProfile, setBanProfile] = useState<Profile | null>(null);
  const [banType, setBanType] = useState<"warning" | "temporary" | "permanent">("warning");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("7"); // days — presets 2 / 7 / 30
  const [banning, setBanning] = useState(false);

  // Edit email dialog
  const [editEmailProfile, setEditEmailProfile] = useState<Profile | null>(null);
  const [newEmail1, setNewEmail1] = useState("");
  const [newEmail2, setNewEmail2] = useState("");
  const [adminPass1] = useState(""); // kept for compat, unused
  const [adminPass2] = useState(""); // kept for compat, unused
  const [updatingEmail, setUpdatingEmail] = useState(false);

  // Delete denied account
  const [deleteProfile, setDeleteProfile] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Re-upload ID dialog
  const [reuploadProfile, setReuploadProfile] = useState<Profile | null>(null);
  const [reuploadNote, setReuploadNote] = useState("");
  // Formal warning dialog
  const [warningProfile, setWarningProfile] = useState<Profile | null>(null);
  const [warningNote, setWarningNote] = useState("");
  const [warningCategory, setWarningCategory] = useState<string>("conduct");
  const [warningBypass, setWarningBypass] = useState(false);
  // Manual verify confirm
  const [manualVerifyProfile, setManualVerifyProfile] = useState<Profile | null>(null);
  // Reset password confirm
  const [resetPwProfile, setResetPwProfile] = useState<Profile | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Per-user admin notes summary: { [user_id]: { count, recent: [{note, created_at, category}] } }
  const [notesSummary, setNotesSummary] = useState<Record<string, { count: number; recent: { note: string; created_at: string; category: string }[] }>>({});
  // Per-user strike counts (from user_violations)
  const [strikesSummary, setStrikesSummary] = useState<Record<string, number>>({});
  // Per-user last activity { [user_id]: { label, at } }
  const [activitySummary, setActivitySummary] = useState<Record<string, { label: string; at: string }>>({});
  // Per-user last login time
  const [lastLoginSummary, setLastLoginSummary] = useState<Record<string, string>>({});
  // Per-user pay totals: earned (as helper) + spent (as poster)
  const [paySummary, setPaySummary] = useState<Record<string, number>>({});

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc" | "alpha" | "standing_worst" | "standing_best" | "pay_high" | "pay_low" | "joined_new" | "joined_old">("desc");

  // Track which user IDs the admin has already seen (per tab category) — persisted in localStorage
  const SEEN_KEY = "admin_seen_user_ids_v1";
  const [seenUserIds, setSeenUserIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
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
          localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(next)));
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
      const ids = data.map((p) => p.user_id);
      // Load supplemental data in parallel (non-blocking)
      loadNotesSummary(ids);
      loadStrikesSummary(ids);
      loadActivitySummary(ids);
      loadPaySummary(ids);
    }
    setLoading(false);
  };

  const loadPaySummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    // Pull only completed/escrowed jobs for pay totals
    const { data } = await supabase
      .from("jobs")
      .select("helper_id, customer_id, budget, helper_fee_percent, customer_fee_amount, sales_tax_amount, status, payment_status")
      .or(userIds.map((id) => `helper_id.eq.${id},customer_id.eq.${id}`).join(","))
      .in("payment_status", ["escrow", "payout_pending", "released"]);
    if (!data) return;
    const totals: Record<string, number> = {};
    for (const j of data as any[]) {
      const budget = Number(j.budget) || 0;
      if (j.helper_id && userIds.includes(j.helper_id)) {
        const fee = (Number(j.helper_fee_percent) || 10) / 100;
        totals[j.helper_id] = (totals[j.helper_id] || 0) + budget * (1 - fee);
      }
      if (j.customer_id && userIds.includes(j.customer_id)) {
        totals[j.customer_id] = (totals[j.customer_id] || 0)
          + budget + (Number(j.customer_fee_amount) || 0) + (Number(j.sales_tax_amount) || 0);
      }
    }
    setPaySummary(totals);
  };

  const loadStrikesSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const { data } = await (supabase.from("user_violations" as any) as any)
      .select("user_id")
      .in("user_id", userIds);
    if (!data) return;
    const counts: Record<string, number> = {};
    for (const row of data as any[]) {
      counts[row.user_id] = (counts[row.user_id] || 0) + 1;
    }
    setStrikesSummary(counts);
  };

  const loadActivitySummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const summary: Record<string, { label: string; at: string }> = {};
    // Fetch recent jobs (posted), applications (helper), and login history in parallel
    const [jobsRes, appsRes, loginRes] = await Promise.all([
      supabase.from("jobs").select("customer_id, created_at, title").in("customer_id", userIds).order("created_at", { ascending: false }).limit(500),
      supabase.from("applications").select("helper_id, created_at").in("helper_id", userIds).order("created_at", { ascending: false }).limit(500),
      (supabase.from("login_history" as any) as any).select("user_id, created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(500),
    ]);
    const consider = (uid: string, label: string, at?: string | null) => {
      if (!at) return;
      const cur = summary[uid];
      if (!cur || new Date(at) > new Date(cur.at)) summary[uid] = { label, at };
    };
    (jobsRes.data as any[] | null)?.forEach((j) => consider(j.customer_id, "Posted Job", j.created_at));
    (appsRes.data as any[] | null)?.forEach((a) => consider(a.helper_id, "Applied to Job", a.created_at));
    (loginRes.data as any[] | null)?.forEach((l: any) => consider(l.user_id, "Logged In", l.created_at));
    // Track most-recent login separately for the user list row
    const logins: Record<string, string> = {};
    (loginRes.data as any[] | null)?.forEach((l: any) => {
      if (!logins[l.user_id] || new Date(l.created_at) > new Date(logins[l.user_id])) {
        logins[l.user_id] = l.created_at;
      }
    });
    setLastLoginSummary(logins);
    // Also surface failed ID upload from profiles
    profiles.forEach((p) => {
      if ((p as any).idv_status === "failed" && (p as any).idv_attempted_at) {
        consider(p.user_id, "Failed ID Upload", (p as any).idv_attempted_at);
      }
    });
    setActivitySummary(summary);
  };

  const loadNotesSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const { data } = await (supabase.from("admin_user_notes" as any) as any)
      .select("user_id, note, created_at, category")
      .in("user_id", userIds)
      .order("created_at", { ascending: false });
    if (!data) return;
    const summary: Record<string, { count: number; recent: { note: string; created_at: string; category: string }[] }> = {};
    for (const row of data as any[]) {
      if (!summary[row.user_id]) summary[row.user_id] = { count: 0, recent: [] };
      summary[row.user_id].count += 1;
      if (summary[row.user_id].recent.length < 2) {
        summary[row.user_id].recent.push({ note: row.note, created_at: row.created_at, category: row.category });
      }
    }
    setNotesSummary(summary);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const openProfile = async (profile: Profile) => {
    setViewProfile(profile);
    setIdDocSignedUrl(null);
    setEmailTracking([]);
    setEmailSendStats([]);
    setProfileJobs([]);

    const [reviewsRes, reviewsLeftRes, violationsRes, bansRes, trackingRes, sendLogRes, jobsRes] = await Promise.all([
      supabase.from("reviews").select("rating, feedback, reviewer_id, created_at, job_id").eq("reviewee_id", profile.user_id).order("created_at", { ascending: false }),
      supabase.from("reviews").select("rating, feedback, reviewee_id, created_at, job_id").eq("reviewer_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("user_violations" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("user_bans" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("email_tracking" as any) as any).select("event_type, email_type, created_at").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      profile.email
        ? (supabase.from("email_send_log" as any) as any)
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
    } as any).eq("id", profile.id);
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
      }).catch((err) => console.error("Failed to send approval email:", err));
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
        approval_email_count: ((profile as any).approval_email_count || 0) + 1,
        last_approval_email_at: new Date().toISOString(),
      } as any).eq("id", profile.id);

      toast.success("Approval email resent");
      loadProfiles();
    } catch (err: any) {
      toast.error("Failed to resend email");
      console.error(err);
    } finally {
      setResending(null);
    }
  };

  const denyUser = async () => {
    if (!denyProfile) return;
    setDenying(true);
    const { error } = await supabase.from("profiles").update({
      approval_status: "denied",
      denial_reason: denyReason.trim() || null,
      denial_email_count: 1,
      last_denial_email_at: new Date().toISOString(),
    } as any).eq("id", denyProfile.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${formatName(denyProfile.full_name)} denied.`);
      await logAdminAction("deny_user", "user", denyProfile.user_id, { name: denyProfile.full_name, reason: denyReason.trim() });
      await createNotification({
        user_id: denyProfile.user_id, title: "Account not approved",
        message: denyReason.trim()
          ? `Your account was not approved. Reason: ${denyReason.trim()}`
          : "Your account was not approved. Please contact support for details.",
        type: "warning", link: "/profile",
      });
      // Send denial email
      supabase.functions.invoke("send-account-status-email", {
        body: { userId: denyProfile.user_id, status: "denied", reason: denyReason.trim() },
      }).catch((err) => console.error("Failed to send denial email:", err));
      loadProfiles();
      setDenyProfile(null);
      setDenyReason("");
      setViewProfile(null);
    }
    setDenying(false);
  };

  const deleteDeniedUser = async () => {
    if (!deleteProfile) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId: deleteProfile.user_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${formatName(deleteProfile.full_name)}'s account has been deleted.`);
      setDeleteProfile(null);
      setViewProfile(null);
      loadProfiles();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  const [resending, setResending] = useState<string | null>(null);

  const resendDenialEmail = async (profile: Profile) => {
    setResending(profile.id);
    try {
      const { error } = await supabase.functions.invoke("send-account-status-email", {
        body: { userId: profile.user_id, status: "denied", reason: (profile as any).denial_reason || "" },
      });
      if (error) throw error;

      // Update count
      await supabase.from("profiles").update({
        denial_email_count: ((profile as any).denial_email_count || 0) + 1,
        last_denial_email_at: new Date().toISOString(),
      } as any).eq("id", profile.id);

      toast.success("Denial email resent");
      loadProfiles();
    } catch (err: any) {
      toast.error("Failed to resend email");
      console.error(err);
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
      console.error(err);
    } finally {
      setResending(null);
    }
  };

  const handleBanAction = async () => {
    if (!banProfile) return;
    setBanning(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBanning(false); return; }

    try {
      if (banType === "warning") {
        // Issue warning
        await (supabase.from("user_violations" as any) as any).insert({
          user_id: banProfile.user_id,
          violation_type: "admin_warning",
          description: banReason.trim(),
          action_taken: "warning",
          reported_by: user.id,
        });
        await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", banProfile.user_id);
        await createNotification({
          user_id: banProfile.user_id, title: "⚠️ Warning from Admin",
          message: banReason.trim() || "You have received a warning for violating platform rules. Another violation may result in a ban.",
          type: "warning", link: "/profile",
        });
        toast.success("Warning issued.");
        await logAdminAction("ban_user", "user", banProfile.user_id, { type: "warning", reason: banReason.trim() });
      } else if (banType === "temporary") {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(banDuration));
        await (supabase.from("user_bans" as any) as any).insert({
          user_id: banProfile.user_id,
          ban_type: "temporary",
          reason: banReason.trim(),
          banned_by: user.id,
          expires_at: expiresAt.toISOString(),
        });
        await (supabase.from("user_violations" as any) as any).insert({
          user_id: banProfile.user_id,
          violation_type: "admin_action",
          description: banReason.trim(),
          action_taken: "temp_ban",
          reported_by: user.id,
        });
        await supabase.from("profiles").update({ ban_status: "temp_banned" } as any).eq("user_id", banProfile.user_id);
        await createNotification({
          user_id: banProfile.user_id, title: "🚫 Temporary Ban",
          message: `Your account has been temporarily banned for ${banDuration} days. Reason: ${banReason.trim() || "Platform rule violation."}`,
          type: "warning", link: "/profile",
        });
        toast.success(`User temporarily banned for ${banDuration} days.`);
      } else {
        await (supabase.from("user_bans" as any) as any).insert({
          user_id: banProfile.user_id,
          ban_type: "permanent",
          reason: banReason.trim(),
          banned_by: user.id,
        });
        await (supabase.from("user_violations" as any) as any).insert({
          user_id: banProfile.user_id,
          violation_type: "admin_action",
          description: banReason.trim(),
          action_taken: "permanent_ban",
          reported_by: user.id,
        });
        await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", banProfile.user_id);
        await createNotification({
          user_id: banProfile.user_id, title: "⛔ Account Permanently Banned",
          message: `Your account has been permanently banned. Reason: ${banReason.trim() || "Severe platform rule violation."}`,
          type: "warning", link: "/profile",
        });
        toast.success("User permanently banned.");
      }

      loadProfiles();
      setBanProfile(null);
      setBanReason("");
      setViewProfile(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to take action");
    } finally {
      setBanning(false);
    }
  };

  const unbanUser = async (profile: Profile) => {
    await (supabase.from("user_bans" as any) as any).update({ is_active: false }).eq("user_id", profile.user_id).eq("is_active", true);
    await supabase.from("profiles").update({ ban_status: "active" } as any).eq("user_id", profile.user_id);
    await supabase.from("notifications").insert({
      user_id: profile.user_id, title: "✅ Ban lifted",
      message: "Your account ban has been lifted. Please follow community guidelines going forward.",
      type: "success", link: "/dashboard",
    });
    toast.success("User unbanned.");
    loadProfiles();
    setViewProfile(null);
  };

  const handleUpdateEmail = async () => {
    if (!editEmailProfile) return;
    if (newEmail1 !== newEmail2) { toast.error("Emails don't match"); return; }
    if (!newEmail1.trim()) { toast.error("New email is required"); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail1)) { toast.error("Invalid email format"); return; }

    setUpdatingEmail(true);
    try {
      const { error } = await supabase.functions.invoke("admin-update-email", {
        body: { userId: editEmailProfile.user_id, newEmail: newEmail1.trim() },
      });
      if (error) throw error;
      toast.success(`Email updated to ${newEmail1.trim()}`);
      setEditEmailProfile(null);
      setNewEmail1(""); setNewEmail2("");
      loadProfiles();
      setViewProfile(null);
    } catch (err: any) {
      let message = err?.message || "Failed to update email";
      if (err?.context && typeof err.context?.json === "function") {
        try {
          const body = await err.context.json();
          if (body?.error) message = body.error;
        } catch {
          // keep fallback message
        }
      }
      toast.error(message);
    } finally {
      setUpdatingEmail(false);
    }
  };

  const callAdminAction = async (
    action: "manual_verify" | "request_id_reupload" | "reset_password" | "formal_warning",
    profile: Profile,
    note?: string,
    extras?: { reasonCategory?: string; bypassStrike?: boolean },
  ) => {
    setActionBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: {
          action,
          userId: profile.user_id,
          note: note || "",
          reasonCategory: extras?.reasonCategory || "",
          bypassStrike: extras?.bypassStrike === true,
        },
      });
      if (error) throw error;
      const labels: Record<string, string> = {
        manual_verify: "User manually verified.",
        request_id_reupload: "ID re-upload request sent.",
        reset_password: "Password reset email sent.",
        formal_warning: "Formal warning issued.",
      };
      toast.success(labels[action]);
      loadProfiles();
      setReuploadProfile(null); setReuploadNote("");
      setWarningProfile(null); setWarningNote(""); setWarningCategory("conduct"); setWarningBypass(false);
      setManualVerifyProfile(null);
      setResetPwProfile(null);
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    } finally {
      setActionBusy(false);
    }
  };

  const viewHistoryFor = (profile: Profile) => {
    // Notify the Admin page to switch to notification logs filtered for this user
    window.dispatchEvent(new CustomEvent("admin:view-user-history", {
      detail: { userId: profile.user_id, email: (profile as any).email },
    }));
    setViewProfile(null);
  };

  // A user only counts as "Pending Review" once their email is verified.
  // Unverified-email users sit in a separate "Awaiting Email" bucket so admins
  // aren't bothered until the user has actually confirmed their email.
  const isVerifiedEmail = (p: Profile) => !!(p as any).email_verified;
  const isPendingReview = (p: Profile) => p.approval_status === "pending" && isVerifiedEmail(p);
  const isAwaitingEmail = (p: Profile) => p.approval_status === "pending" && !isVerifiedEmail(p);

  // A pending user was "flagged by Stripe" if Stripe Identity returned a
  // non-verified outcome (manual_review / failed) — these are the ones that
  // need an explicit Override & Approve.
  const wasFlaggedByStripe = (p: Profile) => {
    const s = (p as any).idv_status;
    return s === "manual_review" || s === "failed";
  };

  const filtered = profiles.filter((p) => {
    // Tab filter
    if (tab === "pending" && !isPendingReview(p)) return false;
    else if (tab === "awaiting_email" && !isAwaitingEmail(p)) return false;
    else if (tab === "approved" && !(p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes((p as any).ban_status || ""))) return false;
    else if (tab === "denied" && (p.approval_status !== "denied" || p.role === "customer")) return false;
    else if (tab === "banned" && !["temp_banned", "permanently_banned"].includes((p as any).ban_status || "")) return false;

    // Search by name (also matches email for convenience)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${p.full_name || ""} ${(p as any).email || ""}`.toLowerCase();
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
    const aLogin = lastLoginSummary[a.user_id];
    const bLogin = lastLoginSummary[b.user_id];
    if (!aLogin && !bLogin) return 0;
    if (!aLogin) return 1;
    if (!bLogin) return -1;
    const diff = new Date(bLogin).getTime() - new Date(aLogin).getTime();
    return sortDir === "desc" ? diff : -diff;
  });

  const isUnseen = (p: Profile) => !seenUserIds.has(p.user_id);
  const pendingCount = profiles.filter((p) => isPendingReview(p) && isUnseen(p)).length;
  const awaitingEmailCount = profiles.filter((p) => isAwaitingEmail(p) && isUnseen(p)).length;
  const bannedCount = profiles.filter(
    (p) => ["temp_banned", "permanently_banned"].includes((p as any).ban_status || "") && isUnseen(p),
  ).length;

  const statusBadge = (profile: Profile) => {
    const banStatus = (profile as any).ban_status || "active";
    if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Permanently Banned</Badge>;
    if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Temp Banned</Badge>;
    if (banStatus === "warned") return <Badge className="bg-accent/20 text-accent-foreground text-xs">Warned</Badge>;
    // Email not yet verified — applies to all roles
    if (!isVerifiedEmail(profile)) return <Badge className="bg-accent/20 text-accent-foreground text-xs">Pending Email Verification</Badge>;
    // Customers: just show Active once email is verified
    if (profile.role === "customer") return <Badge className="bg-primary/10 text-primary text-xs">Active</Badge>;
    if (profile.approval_status === "approved") return <Badge className="bg-primary/10 text-primary text-xs">Active</Badge>;
    if (profile.approval_status === "denied") return <Badge className="bg-destructive/10 text-destructive text-xs">Denied</Badge>;
    return <Badge className="bg-accent/20 text-accent-foreground text-xs">Pending Review</Badge>;
  };

  // Stripe Identity verification badge — green / yellow / gray.
  // Hidden for customer-only users (they don't go through helper IDV).
  const stripeBadge = (profile: Profile) => {
    if (profile.role === "customer") return null;
    const s = (profile as any).idv_status;
    if (s === "verified" || s === "approved" || (profile as any).legacy_manual_review) {
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] gap-0.5"><ShieldCheck className="w-2.5 h-2.5" />Stripe Verified</Badge>;
    }
    if (s === "manual_review" || s === "failed" || s === "requires_input" || s === "action_needed") {
      return <Badge className="bg-accent/20 text-accent-foreground border-accent/30 text-[10px] gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />Stripe Flagged</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground text-[10px] gap-0.5"><ShieldAlert className="w-2.5 h-2.5" />ID Not Submitted</Badge>;
  };

  // Role badge — Helper / Poster (Customer)
  const roleBadge = (profile: Profile) => {
    if (profile.role === "admin") return <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Admin</Badge>;
    if (profile.role === "customer") return <Badge variant="outline" className="text-[10px] gap-0.5"><UserIcon className="w-2.5 h-2.5" />Poster</Badge>;
    // helpers / dual-role default
    return <Badge variant="outline" className="text-[10px] gap-0.5"><Briefcase className="w-2.5 h-2.5" />Helper</Badge>;
  };

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
            <div key={i} className="text-xs space-y-0.5 border-l-2 border-accent/40 pl-2">
              <p className="text-foreground line-clamp-3">{n.note}</p>
              <p className="text-[10px] text-muted-foreground">
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
    (p) => p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes((p as any).ban_status || ""),
  ).length;
  const deniedCount = profiles.filter((p) => p.approval_status === "denied" && p.role !== "customer").length;
  const allCount = profiles.length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "awaiting_email", label: "Email", count: awaitingEmailCount },
    { key: "approved", label: "Active", count: approvedCount },
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "denied", label: "Denied", count: deniedCount },
    { key: "all", label: "All", count: allCount },
  ];

  const activeTab = tabs.find((t) => t.key === tab);
  const tabCountLabel: Record<Tab, string> = {
    pending: "pending",
    awaiting_email: "pending email verification",
    approved: "active",
    banned: "banned",
    denied: "denied",
    all: "total",
  };

  const viewBanStatus = (viewProfile as any)?.ban_status || "active";

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5 w-full">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-0 px-1 py-1.5 rounded-md text-[10px] sm:text-sm font-medium transition-colors flex items-center justify-center gap-0.5 ${
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

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search by name…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 text-sm flex-1"
        />
        <Select value={sortDir} onValueChange={(v) => setSortDir(v as typeof sortDir)}>
          <SelectTrigger className="h-9 text-sm sm:w-[220px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Most Recent</SelectItem>
            <SelectItem value="asc">Longest Inactive</SelectItem>
            <SelectItem value="alpha">Alphabetical (A–Z)</SelectItem>
            <SelectItem value="joined_new">Joined: Newest First</SelectItem>
            <SelectItem value="joined_old">Joined: Oldest First</SelectItem>
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
        <p className="text-xs text-muted-foreground">
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
        <p className="text-sm text-muted-foreground text-center py-8">No users in this category.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={() => openProfile(p)}>
              <div className="flex items-start gap-3">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-border flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground text-sm font-medium flex-shrink-0">
                    {formatName(p.full_name, "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-foreground text-sm truncate">{formatName(p.full_name, "—")}</p>
                    {statusBadge(p)}
                    {stripeBadge(p)}
                    <NotesIndicator userId={p.user_id} />
                  </div>
                  {/* Pending wait-time countdown — only shown in Pending tab */}
                  {tab === "pending" && isPendingReview(p) && (() => {
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
                  {/* Standing + Last login row */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mt-1">
                    {(() => {
                      // Denied users show denial reason instead of standing
                      if (p.approval_status === "denied") {
                        const reason = (p as any).denial_reason;
                        return (
                          <span className="font-medium text-destructive truncate max-w-full">
                            Denied: {reason ? reason : "No reason on file"}
                          </span>
                        );
                      }
                      // No standing for users who haven't verified their email — they're not active
                      if (!isVerifiedEmail(p)) {
                        return null;
                      }
                      const strikes = strikesSummary[p.user_id] || 0;
                      const standingClass = strikes === 0
                        ? "text-primary"
                        : strikes >= 3 ? "text-destructive" : "text-accent-foreground";
                      const standingLabel = strikes === 0
                        ? "Good"
                        : `${strikes} Strike${strikes > 1 ? "s" : ""}`;
                      return (
                        <span className={`font-medium ${standingClass}`}>
                          Standing: {standingLabel}
                        </span>
                      );
                    })()}
                    {(() => {
                      // Skip last-login entirely for unverified users — they can't log in yet
                      if (!isVerifiedEmail(p)) {
                        return null;
                      }
                      const lastLogin = lastLoginSummary[p.user_id];
                      const isApproved = p.approval_status === "approved";
                      if (isApproved && !lastLogin) {
                        return (
                          <span className="font-semibold text-destructive">
                            Never logged in since approval
                          </span>
                        );
                      }
                      return (
                        <span className="text-muted-foreground">
                          Last login: {lastLogin
                            ? formatDistanceToNow(new Date(lastLogin), { addSuffix: true })
                            : "never"}
                        </span>
                      );
                    })()}
                    <span className="text-muted-foreground">
                      Joined: {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>
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


      {/* Profile Detail Dialog */}
      <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl h-[90vh] overflow-hidden p-3 sm:p-5 flex flex-col gap-0">
          <DialogHeader className="pb-2 mb-2 border-b border-border flex-shrink-0">
            <DialogTitle className="font-display text-lg sm:text-xl">User Profile</DialogTitle>
          </DialogHeader>
          {viewProfile && (
            <div className="flex flex-col flex-1 min-h-0 min-w-0 break-words gap-3">
              {/* Header: Avatar + Basic Info */}
              <div className="flex gap-3 sm:gap-4">
                {viewProfile.avatar_url ? (
                  <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img src={viewProfile.avatar_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border-2 border-border hover:border-primary transition-colors cursor-pointer" />
                  </a>
                ) : (
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground text-2xl font-medium flex-shrink-0">
                    {formatName(viewProfile.full_name, "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-foreground truncate">{formatName(viewProfile.full_name, "—")}</h3>
                    {statusBadge(viewProfile)}
                    {stripeBadge(viewProfile)}

                    {((viewProfile as any).application_count || 1) > 1 && (
                      <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent-foreground border-accent/30">
                        Applied {(viewProfile as any).application_count}x
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">{(viewProfile as any).email || "No email"}</p>
                    <button
                      onClick={() => { setEditEmailProfile(viewProfile); setNewEmail1(""); setNewEmail2(""); }}
                      className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                      title="Edit email"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                  {viewProfile.approval_status === "denied" && (
                    <div className="flex flex-wrap gap-2 items-center pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={async () => {
                          const currentCount = (viewProfile as any).application_count || 1;
                          await supabase.from("profiles").update({
                            approval_status: "pending",
                            denial_reason: null,
                            application_count: currentCount + 1,
                          } as any).eq("id", viewProfile.id);
                          toast.success("User moved back to pending for re-review.");
                          loadProfiles();
                          setViewProfile(null);
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Move to Pending
                      </Button>
                      {(() => {
                        const sent = (viewProfile as any).denial_email_count || 0;
                        const maxReached = sent >= 3;
                        return (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={resending === viewProfile.id || maxReached}
                              onClick={async () => {
                                await resendDenialEmail(viewProfile);
                                // refresh local view state count
                                setViewProfile({ ...(viewProfile as any), denial_email_count: sent + 1, last_denial_email_at: new Date().toISOString() } as any);
                              }}
                              title={maxReached ? "Max 3 reminder emails reached" : "Send denial reminder email"}
                            >
                              {resending === viewProfile.id
                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                : <><MailIcon className="w-3.5 h-3.5 mr-1.5" /> Resend Email</>}
                            </Button>
                            <Badge variant="outline" className={`text-[10px] ${maxReached ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-muted text-muted-foreground"}`}>
                              Sent {sent}/3
                            </Badge>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>



              <Tabs defaultValue="actions" className="w-full flex flex-col flex-1 min-h-0">
                <TabsList className="grid grid-cols-6 w-full flex-shrink-0">
                  <TabsTrigger value="actions" className="text-[10px] sm:text-sm px-1">Actions</TabsTrigger>
                  <TabsTrigger value="overview" className="text-[10px] sm:text-sm px-1">Overview</TabsTrigger>
                  <TabsTrigger value="jobs" className="text-[10px] sm:text-sm px-1">Jobs</TabsTrigger>
                  <TabsTrigger value="reviews" className="text-[10px] sm:text-sm px-1">Reviews</TabsTrigger>
                  <TabsTrigger value="documents" className="text-[10px] sm:text-sm px-1">Docs</TabsTrigger>
                  <TabsTrigger value="emails" className="text-[10px] sm:text-sm px-1">Emails</TabsTrigger>
                </TabsList>

                {/* ===== OVERVIEW TAB ===== */}
                <TabsContent value="overview" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Bio */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Bio</h4>
                    <p className={`text-sm leading-relaxed ${viewProfile.bio ? "text-foreground" : "text-muted-foreground italic"}`}>
                      {viewProfile.bio || "Not provided"}
                    </p>
                  </div>

                  {/* Contact & Account */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Contact & Account</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 rounded-xl bg-secondary/30 border border-border p-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Phone</p>
                        <p className={`text-sm font-medium ${viewProfile.phone ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.phone || "Not provided"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Location</p>
                        <p className={`text-sm font-medium ${viewProfile.location ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.location || "Not provided"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Date of Birth</p>
                        <p className={`text-sm font-medium ${(viewProfile as any).date_of_birth ? "text-foreground" : "text-muted-foreground italic"}`}>
                          {(viewProfile as any).date_of_birth
                            ? new Date((viewProfile as any).date_of_birth).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                            : "Not provided"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Joined</p>
                        <p className="text-sm font-medium text-foreground">{new Date(viewProfile.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Last Active</p>
                        <p className="text-sm font-medium text-foreground">{formatDistanceToNow(new Date(viewProfile.updated_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                  </div>

                  {/* Skills */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Skills</h4>
                    {viewProfile.skills ? (
                      <div className="flex flex-wrap gap-1.5">
                        {viewProfile.skills.split(",").map((skill, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{skill.trim()}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Not provided</p>
                    )}
                  </div>

                  {/* Signup Answers */}
                  {(() => {
                    const p = viewProfile as any;
                    const fields = [
                      { label: "Experience Level", value: p.experience_level },
                      { label: "Availability", value: p.availability },
                      { label: "Transportation", value: p.transportation },
                      { label: "Tools / Equipment", value: p.tools_equipment },
                      { label: "Preferred Job Radius", value: p.job_radius },
                      { label: "How They Heard About Us", value: p.hear_about_us },
                      { label: "Emergency Contact", value: p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_phone ? ` — ${p.emergency_contact_phone}` : ""}` : null },
                      { label: "Extra Comments", value: p.extra_comments },
                    ];
                    return (
                      <div className="space-y-2">
                        <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Signup Answers</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 rounded-xl bg-secondary/30 border border-border p-4">
                          {fields.map((f, i) => (
                            <div key={i}>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">{f.label}</p>
                              <p className={`text-sm font-medium ${f.value ? "text-foreground" : "text-muted-foreground italic"}`}>{f.value || "Not provided"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Violations History */}
                  {profileViolations.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-destructive" /> Violations ({profileViolations.length})
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {profileViolations.map((v: any) => (
                          <div key={v.id} className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive" :
                                v.action_taken === "temp_ban" ? "bg-destructive/10 text-destructive" :
                                "bg-accent/20 text-accent-foreground"
                              }`}>
                                {v.action_taken === "permanent_ban" ? "Perm Ban" : v.action_taken === "temp_ban" ? "Temp Ban" : "Warning"}
                              </span>
                              <span className="text-xs text-muted-foreground capitalize">{v.violation_type?.replace(/_/g, " ")}</span>
                              <span className="text-xs text-muted-foreground ml-auto">{new Date(v.created_at).toLocaleDateString()}</span>
                            </div>
                            {v.description && <p className="text-xs text-foreground">{v.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ===== JOBS TAB ===== */}
                <TabsContent value="jobs" className="space-y-4 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {(() => {
                    const calcEarning = (j: any) => {
                      const isHelper = j.helper_id === viewProfile.user_id;
                      const isCustomer = j.customer_id === viewProfile.user_id;
                      const budget = Number(j.budget) || 0;
                      if (isHelper) {
                        const fee = (Number(j.helper_fee_percent) || 10) / 100;
                        return budget * (1 - fee); // net payout to helper
                      }
                      if (isCustomer) {
                        // total paid by poster
                        return budget + (Number(j.customer_fee_amount) || 0) + (Number(j.sales_tax_amount) || 0);
                      }
                      return 0;
                    };

                    const filtered = profileJobs.filter((j: any) => {
                      if (jobsRole === "worked") return j.helper_id === viewProfile.user_id;
                      if (jobsRole === "posted") return j.customer_id === viewProfile.user_id;
                      return true;
                    });

                    const sorted = [...filtered].sort((a: any, b: any) => {
                      if (jobsSort === "earnings_desc") return calcEarning(b) - calcEarning(a);
                      if (jobsSort === "earnings_asc") return calcEarning(a) - calcEarning(b);
                      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                    });

                    const workedCompleted = profileJobs.filter((j: any) => j.helper_id === viewProfile.user_id && j.status === "completed");
                    const postedCompleted = profileJobs.filter((j: any) => j.customer_id === viewProfile.user_id && j.status === "completed");
                    const totalEarned = workedCompleted.reduce((s, j) => s + calcEarning(j), 0);
                    const totalSpent = postedCompleted.reduce((s, j) => s + calcEarning(j), 0);

                    return (
                      <>
                        {/* Summary */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-secondary/30 border border-border p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Earned (Worked)</p>
                            <p className="text-lg font-semibold text-foreground">${totalEarned.toFixed(2)}</p>
                            <p className="text-[10px] text-muted-foreground">{workedCompleted.length} completed</p>
                          </div>
                          <div className="rounded-xl bg-secondary/30 border border-border p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Spent (Posted)</p>
                            <p className="text-lg font-semibold text-foreground">${totalSpent.toFixed(2)}</p>
                            <p className="text-[10px] text-muted-foreground">{postedCompleted.length} completed</p>
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="flex justify-center">
                          <Select value={jobsRole} onValueChange={(v: any) => setJobsRole(v)}>
                            <SelectTrigger className="h-9 text-xs w-[200px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Jobs</SelectItem>
                              <SelectItem value="worked">Worked (Helper)</SelectItem>
                              <SelectItem value="posted">Posted (Customer)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* List */}
                        {sorted.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic">No jobs found.</p>
                        ) : (
                          <div className="space-y-2">
                            {sorted.map((j: any) => {
                              const isHelper = j.helper_id === viewProfile.user_id;
                              const earning = calcEarning(j);
                              const dateRef = j.poster_completed_at || j.helper_completed_at || j.created_at;
                              return (
                                <div key={j.id} className="p-3 rounded-lg bg-secondary/30 border border-border">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <p className="text-sm font-medium text-foreground line-clamp-1">{j.title}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                      j.status === "completed" ? "bg-primary/10 text-primary" :
                                      j.status === "cancelled" ? "bg-destructive/10 text-destructive" :
                                      "bg-muted text-muted-foreground"
                                    }`}>{j.status}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Badge variant="outline" className="text-[10px] h-5">{isHelper ? "Worked" : "Posted"}</Badge>
                                      {j.parish && <span>{j.parish}</span>}
                                      <span>·</span>
                                      <span>{new Date(dateRef).toLocaleDateString()}</span>
                                      {j.payment_status && (
                                        <>
                                          <span>·</span>
                                          <span className="capitalize">{j.payment_status}</span>
                                        </>
                                      )}
                                    </div>
                                    <span className="text-sm font-semibold text-foreground">
                                      {isHelper ? "+" : "-"}${earning.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </TabsContent>

                {/* ===== REVIEWS TAB ===== */}
                <TabsContent value="reviews" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Reviews Received */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Star className="w-4 h-4" /> Reviews Received ({profileReviews.length})
                    </h4>
                    {profileReviews.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No reviews received yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profileReviews.map((r, i) => (
                          <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">From {r.reviewer_name}</p>
                                {r.job_title && <p className="text-[11px] text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                              </div>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {Array.from({ length: 5 }).map((_, idx) => (
                                  <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                                ))}
                              </div>
                            </div>
                            {r.feedback && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                            {r.created_at && <p className="text-[10px] text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString()}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Reviews Left */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Star className="w-4 h-4" /> Reviews Left ({profileReviewsLeft.length})
                    </h4>
                    {profileReviewsLeft.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">Hasn't left any reviews yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profileReviewsLeft.map((r, i) => (
                          <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">For {r.reviewee_name}</p>
                                {r.job_title && <p className="text-[11px] text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                              </div>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {Array.from({ length: 5 }).map((_, idx) => (
                                  <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                                ))}
                              </div>
                            </div>
                            {r.feedback && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                            {r.created_at && <p className="text-[10px] text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString()}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ===== DOCUMENTS TAB ===== */}
                <TabsContent value="documents" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* ID Document */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <FileText className="w-4 h-4" /> ID Document
                    </h4>
                    {viewProfile.id_document_url ? (
                      <div className="rounded-xl border border-border overflow-hidden bg-secondary/20">
                        {idDocSignedUrl ? (
                          /\.(jpg|jpeg|png|gif|webp)$/i.test(viewProfile.id_document_url) ? (
                            <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer">
                              <img src={idDocSignedUrl} alt="ID Document" className="max-h-64 w-auto mx-auto object-contain hover:opacity-90 transition-opacity" />
                            </a>
                          ) : (
                            <div className="p-4 flex items-center gap-3">
                              <FileText className="w-8 h-8 text-primary" />
                              <div>
                                <p className="text-sm font-medium text-foreground break-all">{viewProfile.id_document_url.split("/").pop()}</p>
                                <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                                  Open document ↗
                                </a>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="p-4 text-center">
                            <p className="text-sm text-muted-foreground">Loading document…</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Not provided</p>
                    )}
                  </div>

                  {/* Profile Picture */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Profile Picture</h4>
                    {viewProfile.avatar_url ? (
                      <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                        <img src={viewProfile.avatar_url} alt="Profile" className="w-32 h-32 rounded-xl object-cover border-2 border-border hover:border-primary transition-colors" />
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Not provided</p>
                    )}
                  </div>

                  {/* Portfolio */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <FileText className="w-4 h-4" /> Portfolio & Documents ({((viewProfile as any).portfolio_urls as string[] || []).length})
                    </h4>
                    {((viewProfile as any).portfolio_urls as string[] || []).length > 0 ? (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {((viewProfile as any).portfolio_urls as string[]).map((url: string, i: number) => {
                          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                          const fileName = url.split("/").pop() || "Document";
                          return isImage ? (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl overflow-hidden border border-border hover:border-primary transition-colors block group">
                              <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                            </a>
                          ) : (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 hover:border-primary transition-colors">
                              <FileText className="w-6 h-6 text-muted-foreground mb-1" />
                              <p className="text-[10px] text-muted-foreground text-center truncate w-full">{fileName}</p>
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Not provided</p>
                    )}
                  </div>
                </TabsContent>

                {/* ===== EMAILS TAB ===== */}
                <TabsContent value="emails" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Resend Verification Email */}
                  {viewProfile.approval_status === "pending" && !isVerifiedEmail(viewProfile) && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => resendVerificationEmail(viewProfile)}
                      disabled={resending === viewProfile.id}
                    >
                      <MailIcon className="w-4 h-4 mr-1" />
                      {resending === viewProfile.id
                        ? "Sending…"
                        : `Resend Verification${((viewProfile as any).verification_email_count || 0) > 0 ? ` (${(viewProfile as any).verification_email_count}/3)` : ""}`}
                    </Button>
                  )}
                  {/* Resend Denial Email */}
                  {viewProfile.approval_status === "denied" && (
                    <Button variant="outline" className="w-full" onClick={() => resendDenialEmail(viewProfile)} disabled={resending === viewProfile.id}>
                      <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Denial Email"}
                    </Button>
                  )}
                  {/* Approval email tracking */}
                  {viewProfile.approval_status === "approved" && (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <MailIcon className="w-3.5 h-3.5" /> Approval Email Status
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Emails sent: {(viewProfile as any).approval_email_count || 0} / 3</span>
                        {(viewProfile as any).last_approval_email_at && (
                          <span>Last sent: {new Date((viewProfile as any).last_approval_email_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      {(() => {
                        const opens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
                        const clicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
                        return (opens.length > 0 || clicks.length > 0) ? (
                          <div className="flex gap-4 pt-1">
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <Eye className="w-3 h-3" /> {opens.length} open{opens.length !== 1 ? 's' : ''}
                              {opens[0] && <span className="text-muted-foreground ml-1">({new Date(opens[0].created_at).toLocaleDateString()})</span>}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <MousePointerClick className="w-3 h-3" /> {clicks.length} click{clicks.length !== 1 ? 's' : ''}
                              {clicks[0] && <span className="text-muted-foreground ml-1">({new Date(clicks[0].created_at).toLocaleDateString()})</span>}
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No opens or clicks tracked yet</p>
                        );
                      })()}
                    </div>
                  )}

                  {/* Denial email tracking */}
                  {viewProfile.approval_status === "denied" && (
                    <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        <MailIcon className="w-3.5 h-3.5" /> Denial Email Status
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Emails sent: {(viewProfile as any).denial_email_count || 0} / 3</span>
                        {(viewProfile as any).last_denial_email_at && (
                          <span>Last sent: {new Date((viewProfile as any).last_denial_email_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      {(viewProfile as any).denial_reason && (
                        <p className="text-xs text-muted-foreground">Reason: {(viewProfile as any).denial_reason}</p>
                      )}
                      {(() => {
                        const opens = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'open');
                        const clicks = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'click');
                        return (opens.length > 0 || clicks.length > 0) ? (
                          <div className="flex gap-4 pt-1">
                            <span className="flex items-center gap-1 text-xs text-destructive">
                              <Eye className="w-3 h-3" /> {opens.length} open{opens.length !== 1 ? 's' : ''}
                              {opens[0] && <span className="text-muted-foreground ml-1">({new Date(opens[0].created_at).toLocaleDateString()})</span>}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-destructive">
                              <MousePointerClick className="w-3 h-3" /> {clicks.length} click{clicks.length !== 1 ? 's' : ''}
                              {clicks[0] && <span className="text-muted-foreground ml-1">({new Date(clicks[0].created_at).toLocaleDateString()})</span>}
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No opens or clicks tracked yet</p>
                        );
                      })()}
                    </div>
                  )}

                  {/* Email Send History */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <MailIcon className="w-4 h-4" /> Emails Sent
                      {emailSendStats.length > 0 && (
                        <Badge variant="secondary" className="ml-1 text-[10px]">
                          {emailSendStats.reduce((sum, s) => sum + s.count, 0)} total
                        </Badge>
                      )}
                    </h4>
                    {emailSendStats.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No emails on record</p>
                    ) : (
                      <div className="rounded-xl border border-border bg-secondary/30 divide-y divide-border overflow-hidden">
                        {emailSendStats.map((s) => (
                          <div key={s.template_name} className="flex items-center justify-between gap-3 p-3 text-sm">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-foreground truncate capitalize">
                                {s.template_name.replace(/[-_]/g, " ")}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Last sent {formatDistanceToNow(new Date(s.last_sent), { addSuffix: true })}
                              </p>
                            </div>
                            <Badge variant="outline" className="font-semibold shrink-0">
                              ×{s.count}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ===== ACTIONS TAB ===== */}
                <TabsContent value="actions" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                  {/* Primary lifecycle actions */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Account Actions</h4>
                    <div className="flex gap-2 flex-wrap">
                    {viewProfile.approval_status === "pending" && (
                      <>
                        <Button variant="outline" className="flex-1 min-w-[140px] text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => { setDenyProfile(viewProfile); setDenyReason(""); }}>
                          <XCircle className="w-4 h-4 mr-1" /> Deny
                        </Button>
                        <Button className="flex-1 min-w-[140px]" onClick={() => approveUser(viewProfile)}>
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                        </Button>
                      </>
                    )}
                    {viewProfile.approval_status === "approved" && !["permanently_banned", "temp_banned"].includes(viewBanStatus) && (() => {
                      const opens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
                      const clicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
                      const hasLoggedIn = !!lastLoginSummary[viewProfile.user_id];
                      const idvVerified = (viewProfile as any).idv_status === 'verified';
                      const hasStripe = !!(viewProfile as any).stripe_account_id;
                      const hasOpenedEmail = opens.length > 0 || clicks.length > 0;
                      const isActive = hasLoggedIn || idvVerified || hasStripe || hasOpenedEmail;
                      const sent = (viewProfile as any).approval_email_count || 0;
                      const maxReached = sent >= 3;
                      const activeLabel = idvVerified
                        ? "ID verified"
                        : hasStripe
                        ? "Stripe payout connected"
                        : hasLoggedIn
                        ? "Active — has logged in"
                        : "Has opened approval email";
                      return (
                        <>
                          {!isActive && (
                            <Button
                              variant="outline"
                              className="flex-1 min-w-[160px]"
                              onClick={() => resendApprovalEmail(viewProfile)}
                              disabled={resending === viewProfile.id || maxReached}
                              title={maxReached ? "Max 3 follow-up emails reached" : "Send a manual follow-up reminder (auto-reminders also run every 3 days)"}
                            >
                              <MailIcon className="w-4 h-4 mr-1" />
                              {resending === viewProfile.id ? "Sending…" : `Send Follow-up (${sent}/3)`}
                            </Button>
                          )}
                          {isActive && (
                            <div className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-xs text-primary font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {activeLabel}
                            </div>
                          )}
                          <Button variant="outline" className="flex-1 min-w-[140px] text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => { setBanProfile(viewProfile); setBanReason(""); setBanType("warning"); }}>
                            <ShieldAlert className="w-4 h-4 mr-1" /> Suspend / Ban
                          </Button>
                        </>
                      );
                    })()}
                    {["permanently_banned", "temp_banned"].includes(viewBanStatus) && (
                      <Button variant="outline" className="flex-1 min-w-[140px]" onClick={() => unbanUser(viewProfile)}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Lift Ban
                      </Button>
                    )}
                    </div>
                  </div>

                  {/* Internal Admin Notes */}
                  <AdminUserNotes userId={viewProfile.user_id} />

                  {/* Trust & Verification + Support actions */}
                  <div className="space-y-2">
                    <h4 className="text-xs sm:text-sm font-semibold text-foreground uppercase tracking-wide">Admin Tools</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setManualVerifyProfile(viewProfile)}>
                        <ShieldCheck className="w-4 h-4 mr-1.5 text-primary" /> Manually Verify
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => { setWarningProfile(viewProfile); setWarningNote(""); }}>
                        <MessageSquareWarning className="w-4 h-4 mr-1.5 text-accent" /> Formal Warning
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setResetPwProfile(viewProfile)}>
                        <KeyRound className="w-4 h-4 mr-1.5 text-primary" /> Reset Password
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => viewHistoryFor(viewProfile)}>
                        <History className="w-4 h-4 mr-1.5" /> View History
                      </Button>
                      <Button variant="outline" size="sm" className="h-9 justify-center text-destructive border-destructive/30 hover:bg-destructive/10 col-span-2 sm:col-span-1" onClick={() => setDeleteProfile(viewProfile)}>
                        <Trash2 className="w-4 h-4 mr-1.5" /> Delete Account
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deny Reason Dialog */}
      <Dialog open={!!denyProfile} onOpenChange={() => setDenyProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Deny {formatName(denyProfile?.full_name)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Provide a reason for denying this application.</p>
            <Textarea value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="Reason for denial (optional)…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDenyProfile(null)}>Cancel</Button>
            <Button variant="destructive" onClick={denyUser} disabled={denying}>{denying ? "Denying…" : "Deny User"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban / Warning Dialog */}
      <Dialog open={!!banProfile} onOpenChange={() => setBanProfile(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-5 sm:p-6 gap-5">
          <DialogHeader className="pr-8 space-y-1">
            <DialogTitle className="font-display flex items-center gap-2 text-base sm:text-lg">
              <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
              <span className="truncate">Take Action: {banProfile?.full_name || "User"}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action type</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "warning", label: "Warning", icon: <AlertTriangle className="w-4 h-4" />, color: "border-accent/40 bg-accent/10" },
                  { key: "temporary", label: "Temp Ban", icon: <Clock className="w-4 h-4" />, color: "border-destructive/40 bg-destructive/10" },
                  { key: "permanent", label: "Perm Ban", icon: <Ban className="w-4 h-4" />, color: "border-destructive/60 bg-destructive/20" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setBanType(opt.key)}
                    className={`p-2.5 rounded-xl border text-center space-y-1 transition-colors ${
                      banType === opt.key ? opt.color : "border-border bg-card hover:bg-secondary/30"
                    }`}
                  >
                    <div className="flex justify-center">{opt.icon}</div>
                    <p className="text-xs font-medium">{opt.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {banType === "temporary" && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration (days)</p>
                <Select value={banDuration} onValueChange={setBanDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">48 hours (2 days)</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</p>
              <Textarea value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="Describe the reason for this action…" rows={3} />
            </div>

            {banType === "permanent" && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
                <p className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>This action is severe. The user will lose access permanently.</span>
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-border/40 -mx-5 sm:-mx-6 px-5 sm:px-6">

            <Button variant="ghost" onClick={() => setBanProfile(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button
              variant={banType === "warning" ? "default" : "destructive"}
              onClick={handleBanAction}
              disabled={banning || !banReason.trim()}
              className="w-full sm:w-auto"
            >
              {banning ? "Processing…" : banType === "warning" ? "Issue Warning" : banType === "temporary" ? `Ban for ${banDuration} days` : "Permanently Ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Email Dialog */}
      <Dialog open={!!editEmailProfile} onOpenChange={() => setEditEmailProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" /> Change Email for {editEmailProfile?.full_name || "User"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border border-border p-3">
              <p className="text-xs text-muted-foreground">Current email: <strong className="text-foreground">{(editEmailProfile as any)?.email || "—"}</strong></p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Email</p>
              <Input type="email" value={newEmail1} onChange={(e) => setNewEmail1(e.target.value)} placeholder="Enter new email" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirm New Email</p>
              <Input type="email" value={newEmail2} onChange={(e) => setNewEmail2(e.target.value)} placeholder="Re-enter new email" />
              {newEmail2 && newEmail1 !== newEmail2 && (
                <p className="text-xs text-destructive">Emails don't match</p>
              )}
              {newEmail2 && newEmail1 === newEmail2 && newEmail1.length > 0 && (
                <p className="text-xs text-primary">✓ Emails match</p>
              )}
            </div>

            <div className="rounded-lg bg-accent/10 border border-accent/20 p-3">
              <p className="text-xs text-muted-foreground">
                ⚠️ This will immediately update the user's login email. They'll be notified of the change.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditEmailProfile(null)}>Cancel</Button>
            <Button
              onClick={handleUpdateEmail}
              disabled={updatingEmail || !newEmail1 || newEmail1 !== newEmail2}
            >
              {updatingEmail ? "Updating…" : "Update Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Denied Account Dialog */}
      <Dialog open={!!deleteProfile} onOpenChange={() => setDeleteProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Delete Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete <strong className="text-foreground">{formatName(deleteProfile?.full_name)}</strong>'s account?
            </p>
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> This action is permanent and cannot be undone. All user data will be removed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteProfile(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteDeniedUser} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manually Verify Confirm */}
      <Dialog open={!!manualVerifyProfile} onOpenChange={() => !actionBusy && setManualVerifyProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Manually Verify {formatName(manualVerifyProfile?.full_name)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this for someone you know personally, or whose ID is valid but our system couldn't read it.
              Their identity status will be set to <strong className="text-foreground">verified</strong> and approval will be set to <strong className="text-foreground">approved</strong>, bypassing automated checks.
            </p>
            <div className="rounded-lg bg-accent/10 border border-accent/20 p-3">
              <p className="text-xs text-muted-foreground">This action is logged in the admin audit log.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualVerifyProfile(null)} disabled={actionBusy}>Cancel</Button>
            <Button onClick={() => manualVerifyProfile && callAdminAction("manual_verify", manualVerifyProfile)} disabled={actionBusy}>
              {actionBusy ? "Verifying…" : "Manually Verify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request ID Re-upload */}
      <Dialog open={!!reuploadProfile} onOpenChange={() => !actionBusy && setReuploadProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Camera className="w-5 h-5 text-accent" /> Request ID Re-upload
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send {formatName(reuploadProfile?.full_name)} a friendly email asking for a clearer ID photo. Their IDV status will be set to <strong className="text-foreground">action needed</strong>.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Note (optional)</p>
              <Textarea value={reuploadNote} onChange={(e) => setReuploadNote(e.target.value)} placeholder="e.g. Photo was too blurry — please retake in good lighting." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReuploadProfile(null)} disabled={actionBusy}>Cancel</Button>
            <Button onClick={() => reuploadProfile && callAdminAction("request_id_reupload", reuploadProfile, reuploadNote)} disabled={actionBusy}>
              {actionBusy ? "Sending…" : "Send Re-upload Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Confirm */}
      <Dialog open={!!resetPwProfile} onOpenChange={() => !actionBusy && setResetPwProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Send Password Reset Link
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Email a one-time password reset link to <strong className="text-foreground">{(resetPwProfile as any)?.email || "this user"}</strong>. The link expires in 1 hour.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetPwProfile(null)} disabled={actionBusy}>Cancel</Button>
            <Button onClick={() => resetPwProfile && callAdminAction("reset_password", resetPwProfile)} disabled={actionBusy}>
              {actionBusy ? "Sending…" : "Send Reset Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formal Warning */}
      <Dialog open={!!warningProfile} onOpenChange={() => !actionBusy && setWarningProfile(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-5 sm:p-6 gap-5">
          <DialogHeader className="pr-8 space-y-1">
            <DialogTitle className="font-display flex items-center gap-2 text-base sm:text-lg">
              <MessageSquareWarning className="w-5 h-5 text-accent shrink-0" />
              <span className="truncate">Issue Manual Strike</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Per the Repeat Offender Policy: <strong>1st</strong> = warning, <strong>2nd</strong> = final warning banner, <strong>3rd</strong> = 7-day suspension. This logs a strike, emails {formatName(warningProfile?.full_name)}, and adds it to their violation history.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason category</p>
              <Select value={warningCategory} onValueChange={setWarningCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conduct">Conduct (rude / disrespectful)</SelectItem>
                  <SelectItem value="no_show">No-show / late cancellation</SelectItem>
                  <SelectItem value="payment_policy">Payment policy (off-platform)</SelectItem>
                  <SelectItem value="inappropriate_content">Inappropriate content</SelectItem>
                  <SelectItem value="quality">Poor work quality</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Internal note (sent to user)</p>
              <Textarea
                value={warningNote}
                onChange={(e) => setWarningNote(e.target.value)}
                placeholder="e.g. Customer complaint: helper left gate open. Verified via phone call."
                rows={3}
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/30 p-3 cursor-pointer hover:bg-secondary/50 transition-colors">
              <Checkbox
                checked={warningBypass}
                onCheckedChange={(v) => setWarningBypass(v === true)}
                className="mt-0.5 shrink-0"
              />
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-medium text-foreground">Bypass next strike (one-time courtesy)</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Logs the warning but does NOT escalate to the next tier. Use when you've spoken to them and decided this is a genuine one-time mistake.</p>
              </div>
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-border/40 -mx-5 sm:-mx-6 px-5 sm:px-6">
            <Button variant="ghost" onClick={() => setWarningProfile(null)} disabled={actionBusy} className="w-full sm:w-auto">Cancel</Button>
            <Button
              onClick={() => warningProfile && callAdminAction("formal_warning", warningProfile, warningNote, { reasonCategory: warningCategory, bypassStrike: warningBypass })}
              disabled={actionBusy || !warningNote.trim()}
              className="w-full sm:w-auto"
            >
              {actionBusy ? "Issuing…" : warningBypass ? "Issue (no escalation)" : "Issue Strike"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
