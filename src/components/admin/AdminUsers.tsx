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
import { toast } from "sonner";
import { CheckCircle2, XCircle, Star, FileText, Ban, AlertTriangle, ShieldAlert, Clock, MailIcon, RefreshCw, Eye, MousePointerClick, Pencil, Trash2, ShieldCheck, Camera, KeyRound, MessageSquareWarning, History } from "lucide-react";
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
  const [profileReviews, setProfileReviews] = useState<{ rating: number; feedback: string | null; reviewer_name: string }[]>([]);
  const [profileViolations, setProfileViolations] = useState<any[]>([]);
  const [profileBans, setProfileBans] = useState<any[]>([]);
  const [idDocSignedUrl, setIdDocSignedUrl] = useState<string | null>(null);
  const [emailTracking, setEmailTracking] = useState<{ event_type: string; email_type: string; created_at: string }[]>([]);

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
  // Manual verify confirm
  const [manualVerifyProfile, setManualVerifyProfile] = useState<Profile | null>(null);
  // Reset password confirm
  const [resetPwProfile, setResetPwProfile] = useState<Profile | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProfiles(data);
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const openProfile = async (profile: Profile) => {
    setViewProfile(profile);
    setIdDocSignedUrl(null);
    setEmailTracking([]);

    const [reviewsRes, violationsRes, bansRes, trackingRes] = await Promise.all([
      supabase.from("reviews").select("rating, feedback, reviewer_id").eq("reviewee_id", profile.user_id),
      (supabase.from("user_violations" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("user_bans" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("email_tracking" as any) as any).select("event_type, email_type, created_at").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
    ]);

    // Generate signed URL for private ID document
    if (profile.id_document_url) {
      const { data: signedData } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(profile.id_document_url, 3600); // 1 hour
      if (signedData?.signedUrl) {
        setIdDocSignedUrl(signedData.signedUrl);
      }
    }

    if (reviewsRes.data && reviewsRes.data.length > 0) {
      const reviewerIds = [...new Set(reviewsRes.data.map((r: any) => r.reviewer_id))];
      const { data: reviewerProfiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", reviewerIds);
      const nameMap = new Map(reviewerProfiles?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
      setProfileReviews(reviewsRes.data.map((r: any) => ({
        rating: r.rating, feedback: r.feedback, reviewer_name: nameMap.get(r.reviewer_id) || "User",
      })));
    } else {
      setProfileReviews([]);
    }

    setProfileViolations(violationsRes.data || []);
    setProfileBans(bansRes.data || []);
    setEmailTracking(trackingRes.data || []);
  };

  const approveUser = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({
      approval_status: "approved",
      approval_email_count: 1,
      last_approval_email_at: new Date().toISOString(),
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
  ) => {
    setActionBusy(true);
    try {
      const { error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action, userId: profile.user_id, note: note || "" },
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
      setWarningProfile(null); setWarningNote("");
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
    if (tab === "pending") return isPendingReview(p);
    if (tab === "awaiting_email") return isAwaitingEmail(p);
    if (tab === "approved") return p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes((p as any).ban_status || "");
    if (tab === "denied") return p.approval_status === "denied";
    if (tab === "banned") return ["temp_banned", "permanently_banned"].includes((p as any).ban_status || "");
    return true;
  });

  const pendingCount = profiles.filter(isPendingReview).length;
  const awaitingEmailCount = profiles.filter(isAwaitingEmail).length;
  const bannedCount = profiles.filter((p) => ["temp_banned", "permanently_banned"].includes((p as any).ban_status || "")).length;

  const statusBadge = (profile: Profile) => {
    const banStatus = (profile as any).ban_status || "active";
    if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Permanently Banned</Badge>;
    if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Temp Banned</Badge>;
    if (banStatus === "warned") return <Badge className="bg-accent/20 text-accent-foreground text-xs">Warned</Badge>;
    // Customers don't go through approval — skip approval/pending/denied badges
    if (profile.role === "customer") return null;
    if (profile.approval_status === "approved") return <Badge className="bg-primary/10 text-primary text-xs">Approved</Badge>;
    if (profile.approval_status === "denied") return <Badge className="bg-destructive/10 text-destructive text-xs">Denied</Badge>;
    return <Badge className="bg-accent/20 text-accent-foreground text-xs">Pending</Badge>;
  };

  if (loading) return <p className="text-muted-foreground">Loading users…</p>;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "awaiting_email", label: "Awaiting Email", count: awaitingEmailCount },
    { key: "approved", label: "Active" },
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "denied", label: "Denied" },
    { key: "all", label: "All" },
  ];

  const viewBanStatus = (viewProfile as any)?.ban_status || "active";

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-fit px-2.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground px-1">{filtered.length} {filtered.length === 1 ? "user" : "users"}</p>

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
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-sm truncate">{formatName(p.full_name, "—")}</p>
                    {statusBadge(p)}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                    {(p as any).email && <span className="truncate max-w-full">{(p as any).email}</span>}
                    {p.location && <span>{p.location}</span>}
                    {p.phone && <span>{p.phone}</span>}
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5 mt-2.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {p.approval_status === "pending" && isVerifiedEmail(p) && (
                  <>
                    <Button size="sm" className="h-8 px-3" onClick={() => approveUser(p)}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      {wasFlaggedByStripe(p) ? "Override & Approve" : "Approve"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setDenyProfile(p); setDenyReason(""); }}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Deny
                    </Button>
                    {wasFlaggedByStripe(p) && (
                      <Badge variant="outline" className="h-8 px-2 flex items-center gap-1 text-[10px] bg-accent/10 text-accent-foreground border-accent/30">
                        <ShieldAlert className="w-3 h-3" />
                        Flagged by Stripe
                      </Badge>
                    )}
                  </>
                )}
                {p.approval_status === "pending" && !isVerifiedEmail(p) && (
                  <Badge variant="outline" className="h-8 px-2 flex items-center gap-1 text-[10px] bg-muted text-muted-foreground border-border">
                    <MailIcon className="w-3 h-3" />
                    Awaiting email verification
                  </Badge>
                )}
                {p.approval_status === "approved" && (
                  <>
                    <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => resendApprovalEmail(p)} disabled={resending === p.id}>
                      {resending === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <><MailIcon className="w-3.5 h-3.5 mr-1" /> Resend</>}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setBanProfile(p); setBanReason(""); setBanType("warning"); }}>
                      <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Ban
                    </Button>
                  </>
                )}
                {p.approval_status === "denied" && (
                  <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => resendDenialEmail(p)} disabled={resending === p.id}>
                    {resending === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <><MailIcon className="w-3.5 h-3.5 mr-1" /> Resend</>}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}


      {/* Profile Detail Dialog */}
      <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
        <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] sm:w-full max-h-[92vh] overflow-y-auto p-3 sm:p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-base sm:text-xl pr-6">User Profile</DialogTitle>
          </DialogHeader>
          {viewProfile && (
            <div className="space-y-4">
              {/* Header: Avatar + Basic Info */}
              <div className="flex gap-3 sm:gap-4">
                {viewProfile.avatar_url ? (
                  <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img src={viewProfile.avatar_url} alt="" className="w-16 h-16 sm:w-24 sm:h-24 rounded-xl object-cover border-2 border-border hover:border-primary transition-colors cursor-pointer" />
                  </a>
                ) : (
                  <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground text-xl sm:text-2xl font-medium flex-shrink-0">
                    {formatName(viewProfile.full_name, "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-sm sm:text-lg font-bold text-foreground break-words leading-tight w-full sm:w-auto sm:truncate">{formatName(viewProfile.full_name, "—")}</h3>
                    {statusBadge(viewProfile)}

                    {((viewProfile as any).application_count || 1) > 1 && (
                      <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent-foreground border-accent/30">
                        Applied {(viewProfile as any).application_count}x
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-[11px] sm:text-sm text-muted-foreground truncate break-all">{(viewProfile as any).email || "No email"}</p>
                    <button
                      onClick={() => { setEditEmailProfile(viewProfile); setNewEmail1(""); setNewEmail2(""); }}
                      className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0 p-1 -m-1"
                      title="Edit email"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                  {viewProfile.approval_status === "denied" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-full sm:w-auto"
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
                  )}
                </div>
              </div>

              {/* Bio — full width below header */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Bio</p>
                <p className={`text-sm leading-relaxed ${viewProfile.bio ? "text-foreground" : "text-muted-foreground italic"}`}>
                  {viewProfile.bio || "Not provided"}
                </p>
              </div>

              {/* Info Grid — always show all fields */}
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-secondary/30 border border-border p-3">
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

              {/* Skills — always show */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Skills</p>
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

              {/* Signup Answers — always show all fields */}
              {(() => {
                const p = viewProfile as any;
                const fields = [
                  { label: "Availability", value: p.availability },
                  { label: "Transportation", value: p.transportation },
                  { label: "Experience Level", value: p.experience_level },
                  { label: "Tools / Equipment", value: p.tools_equipment },
                  { label: "Preferred Job Radius", value: p.job_radius },
                  { label: "How They Heard About Us", value: p.hear_about_us },
                  { label: "Emergency Contact", value: p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_phone ? ` — ${p.emergency_contact_phone}` : ""}` : null },
                  { label: "Extra Comments", value: p.extra_comments },
                ];
                return (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Signup Answers</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-secondary/30 border border-border p-3 sm:p-4">
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

              {/* ID Document — always show */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> ID Document
                </p>
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
                            <p className="text-sm font-medium text-foreground">{viewProfile.id_document_url.split("/").pop()}</p>
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

              {/* Profile Picture — always show */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Profile Picture</p>
                {viewProfile.avatar_url ? (
                  <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                    <img src={viewProfile.avatar_url} alt="Profile" className="w-32 h-32 rounded-xl object-cover border-2 border-border hover:border-primary transition-colors" />
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Not provided</p>
                )}
              </div>

              {/* Portfolio — always show */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Portfolio & Documents ({((viewProfile as any).portfolio_urls as string[] || []).length})
                </p>
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

              {/* Violations History */}
              {profileViolations.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Violations ({profileViolations.length})
                  </p>
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

              {/* Action buttons — primary lifecycle */}
              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border sm:flex-wrap">
                {viewProfile.approval_status === "pending" && (
                  <>
                    <Button className="w-full sm:flex-1 sm:min-w-[140px] h-10" onClick={() => approveUser(viewProfile)}>
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button variant="outline" className="w-full sm:flex-1 sm:min-w-[140px] h-10 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setDenyProfile(viewProfile); setDenyReason(""); }}>
                      <XCircle className="w-4 h-4 mr-1" /> Deny
                    </Button>
                  </>
                )}
                {viewProfile.approval_status === "denied" && (
                  <Button variant="outline" className="w-full sm:flex-1 sm:min-w-[160px] h-10" onClick={() => resendDenialEmail(viewProfile)} disabled={resending === viewProfile.id}>
                    <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Denial Email"}
                  </Button>
                )}
                {viewProfile.approval_status === "approved" && !["permanently_banned", "temp_banned"].includes(viewBanStatus) && (
                  <>
                    <Button variant="outline" className="w-full sm:flex-1 sm:min-w-[160px] h-10" onClick={() => resendApprovalEmail(viewProfile)} disabled={resending === viewProfile.id}>
                      <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Approval Email"}
                    </Button>
                    <Button variant="outline" className="w-full sm:flex-1 sm:min-w-[140px] h-10 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setBanProfile(viewProfile); setBanReason(""); setBanType("warning"); }}>
                      <ShieldAlert className="w-4 h-4 mr-1" /> Suspend / Ban
                    </Button>
                  </>
                )}
                {["permanently_banned", "temp_banned"].includes(viewBanStatus) && (
                  <Button variant="outline" className="w-full sm:flex-1 sm:min-w-[140px] h-10" onClick={() => unbanUser(viewProfile)}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Lift Ban
                  </Button>
                )}
              </div>

              {/* Internal Admin Notes — private notes about this user, admin-only */}
              <AdminUserNotes userId={viewProfile.user_id} />

              {/* Trust & Verification + Support actions */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Admin Tools</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm" onClick={() => setManualVerifyProfile(viewProfile)}>
                    <ShieldCheck className="w-4 h-4 mr-1.5 text-primary shrink-0" /> Manually Verify
                  </Button>
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm" onClick={() => { setReuploadProfile(viewProfile); setReuploadNote(""); }}>
                    <Camera className="w-4 h-4 mr-1.5 text-accent shrink-0" /> Request ID Re-upload
                  </Button>
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm" onClick={() => { setWarningProfile(viewProfile); setWarningNote(""); }}>
                    <MessageSquareWarning className="w-4 h-4 mr-1.5 text-accent shrink-0" /> Formal Warning
                  </Button>
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm" onClick={() => setResetPwProfile(viewProfile)}>
                    <KeyRound className="w-4 h-4 mr-1.5 text-primary shrink-0" /> Reset Password
                  </Button>
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm" onClick={() => viewHistoryFor(viewProfile)}>
                    <History className="w-4 h-4 mr-1.5 shrink-0" /> View History
                  </Button>
                  <Button variant="outline" size="sm" className="h-10 justify-start text-xs sm:text-sm text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteProfile(viewProfile)}>
                    <Trash2 className="w-4 h-4 mr-1.5 shrink-0" /> Delete Account
                  </Button>
                </div>
              </div>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" /> Take Action: {banProfile?.full_name || "User"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
                    className={`p-3 rounded-xl border text-center space-y-1 transition-colors ${
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
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> This action is severe. The user will lose access permanently.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBanProfile(null)}>Cancel</Button>
            <Button
              variant={banType === "warning" ? "default" : "destructive"}
              onClick={handleBanAction}
              disabled={banning || !banReason.trim()}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <MessageSquareWarning className="w-5 h-5 text-accent" /> Issue Formal Warning
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Per the Repeat Offender Policy: <strong>1st</strong> violation = warning, <strong>2nd</strong> = 7-day suspension, <strong>3rd</strong> = permanent ban. This adds a note to {formatName(warningProfile?.full_name)}'s file and sends them an email.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Specific policy violation</p>
              <Textarea
                value={warningNote}
                onChange={(e) => setWarningNote(e.target.value)}
                placeholder="e.g. Late cancellation under 2 hours before scheduled job."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWarningProfile(null)} disabled={actionBusy}>Cancel</Button>
            <Button
              onClick={() => warningProfile && callAdminAction("formal_warning", warningProfile, warningNote)}
              disabled={actionBusy || !warningNote.trim()}
            >
              {actionBusy ? "Issuing…" : "Issue Warning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
