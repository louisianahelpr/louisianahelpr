import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Star, FileText, Ban, AlertTriangle, ShieldAlert, Clock, MailIcon, RefreshCw, Eye, MousePointerClick } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type Tab = "pending" | "approved" | "denied" | "banned" | "all";

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

  // Deny dialog
  const [denyProfile, setDenyProfile] = useState<Profile | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denying, setDenying] = useState(false);

  // Ban dialog
  const [banProfile, setBanProfile] = useState<Profile | null>(null);
  const [banType, setBanType] = useState<"warning" | "temporary" | "permanent">("warning");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("7"); // days
  const [banning, setBanning] = useState(false);

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

    const [reviewsRes, violationsRes, bansRes] = await Promise.all([
      supabase.from("reviews").select("rating, feedback, reviewer_id").eq("reviewee_id", profile.user_id),
      (supabase.from("user_violations" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
      (supabase.from("user_bans" as any) as any).select("*").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
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
      const nameMap = new Map(reviewerProfiles?.map((p) => [p.user_id, p.full_name || "User"]) || []);
      setProfileReviews(reviewsRes.data.map((r: any) => ({
        rating: r.rating, feedback: r.feedback, reviewer_name: nameMap.get(r.reviewer_id) || "User",
      })));
    } else {
      setProfileReviews([]);
    }

    setProfileViolations(violationsRes.data || []);
    setProfileBans(bansRes.data || []);
  };

  const approveUser = async (profile: Profile) => {
    const { error } = await supabase.from("profiles").update({
      approval_status: "approved",
      approval_email_count: 1,
      last_approval_email_at: new Date().toISOString(),
    } as any).eq("id", profile.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`${profile.full_name || "User"} approved!`);
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
      toast.success(`${denyProfile.full_name || "User"} denied.`);
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

  const filtered = profiles.filter((p) => {
    if (tab === "pending") return p.approval_status === "pending";
    if (tab === "approved") return p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes((p as any).ban_status || "");
    if (tab === "denied") return p.approval_status === "denied";
    if (tab === "banned") return ["temp_banned", "permanently_banned"].includes((p as any).ban_status || "");
    return true;
  });

  const pendingCount = profiles.filter((p) => p.approval_status === "pending").length;
  const bannedCount = profiles.filter((p) => ["temp_banned", "permanently_banned"].includes((p as any).ban_status || "")).length;

  const statusBadge = (profile: Profile) => {
    const banStatus = (profile as any).ban_status || "active";
    if (banStatus === "permanently_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Permanently Banned</Badge>;
    if (banStatus === "temp_banned") return <Badge className="bg-destructive/10 text-destructive text-xs">Temp Banned</Badge>;
    if (banStatus === "warned") return <Badge className="bg-accent/20 text-accent-foreground text-xs">Warned</Badge>;
    if (profile.approval_status === "approved") return <Badge className="bg-primary/10 text-primary text-xs">Approved</Badge>;
    if (profile.approval_status === "denied") return <Badge className="bg-destructive/10 text-destructive text-xs">Denied</Badge>;
    return <Badge className="bg-accent/20 text-accent-foreground text-xs">Pending</Badge>;
  };

  if (loading) return <p className="text-muted-foreground">Loading users…</p>;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "approved", label: "Active" },
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "denied", label: "Denied" },
    { key: "all", label: "All" },
  ];

  const viewBanStatus = (viewProfile as any)?.ban_status || "active";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <span className="text-sm text-muted-foreground">{profiles.length} total</span>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No users in this category.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-4 space-y-2 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={() => openProfile(p)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3 flex-1 min-w-0">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border border-border flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground text-sm font-medium flex-shrink-0">
                      {(p.full_name || "?")[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-foreground">{p.full_name || "—"}</p>
                      {statusBadge(p)}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                       {(p as any).email && <span>{(p as any).email}</span>}
                       {p.location && <span>{p.location}</span>}
                       {p.phone && <span>{p.phone}</span>}
                       <span>Joined {new Date(p.created_at).toLocaleDateString()}</span>
                       <span className="flex items-center gap-0.5">
                         <Clock className="w-3 h-3" />
                         Active {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                       </span>
                    </div>
                    {p.skills && <p className="text-xs text-muted-foreground mt-1">Skills: {p.skills}</p>}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {p.approval_status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => approveUser(p)}><CheckCircle2 className="w-4 h-4" /></Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => { setDenyProfile(p); setDenyReason(""); }}><XCircle className="w-4 h-4" /></Button>
                    </>
                  )}
                  {p.approval_status === "approved" && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => resendApprovalEmail(p)} disabled={resending === p.id}>
                        <MailIcon className="w-4 h-4 mr-1" /> {resending === p.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Resend"}
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => { setBanProfile(p); setBanReason(""); setBanType("warning"); }}>
                        <ShieldAlert className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  {p.approval_status === "denied" && (
                    <Button size="sm" variant="outline" onClick={() => resendDenialEmail(p)} disabled={resending === p.id}>
                      <MailIcon className="w-4 h-4 mr-1" /> {resending === p.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Resend"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profile Detail Dialog */}
      <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{viewProfile?.full_name || "User Profile"}</DialogTitle>
          </DialogHeader>
          {viewProfile && (
            <div className="space-y-6">
              {/* Header: Avatar + Basic Info */}
              <div className="flex gap-5">
                {viewProfile.avatar_url ? (
                  <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img src={viewProfile.avatar_url} alt="" className="w-28 h-28 rounded-xl object-cover border-2 border-border hover:border-primary transition-colors cursor-pointer" />
                  </a>
                ) : (
                  <div className="w-28 h-28 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground text-3xl font-medium flex-shrink-0">
                    {(viewProfile.full_name || "?")[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-foreground">{viewProfile.full_name || "—"}</h3>
                    {statusBadge(viewProfile)}
                    <Badge variant="outline" className="text-xs capitalize">{viewProfile.role}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{(viewProfile as any).email || "No email"}</p>
                  {viewProfile.bio && <p className="text-sm text-foreground leading-relaxed">{viewProfile.bio}</p>}
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-xl bg-secondary/30 border border-border p-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Phone</p>
                  <p className="text-sm font-medium text-foreground">{viewProfile.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Location</p>
                  <p className="text-sm font-medium text-foreground">{viewProfile.location || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Date of Birth</p>
                  <p className="text-sm font-medium text-foreground">
                    {(viewProfile as any).date_of_birth
                      ? new Date((viewProfile as any).date_of_birth).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Hourly Rate</p>
                  <p className="text-sm font-medium text-foreground">{viewProfile.hourly_rate ? `$${viewProfile.hourly_rate}/hr` : "—"}</p>
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

              {/* Skills */}
              {viewProfile.skills && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewProfile.skills.split(",").map((skill, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{skill.trim()}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Signup Answers */}
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
                ].filter(f => f.value);
                return fields.length > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Signup Answers</p>
                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-secondary/30 border border-border p-4">
                      {fields.map((f, i) => (
                        <div key={i}>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">{f.label}</p>
                          <p className="text-sm font-medium text-foreground">{f.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* ID Document */}
              {viewProfile.id_document_url && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> ID Document
                  </p>
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
                </div>
              )}

              {/* Portfolio */}
              {((viewProfile as any).portfolio_urls as string[] || []).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Portfolio & Documents ({((viewProfile as any).portfolio_urls as string[]).length})
                  </p>
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
                </div>
              )}

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

              {/* Reviews */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" /> Reviews ({profileReviews.length})
                </p>
                {profileReviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviews yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {profileReviews.map((r, i) => (
                      <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} className={`w-3 h-3 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">by {r.reviewer_name}</span>
                        </div>
                        {r.feedback && <p className="text-xs text-foreground">{r.feedback}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
                {viewProfile.approval_status === "pending" && (
                  <>
                    <Button className="flex-1" onClick={() => approveUser(viewProfile)}>
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setDenyProfile(viewProfile); setDenyReason(""); }}>
                      <XCircle className="w-4 h-4 mr-1" /> Deny
                    </Button>
                  </>
                )}
                {viewProfile.approval_status === "denied" && (
                  <Button variant="outline" className="flex-1" onClick={() => resendDenialEmail(viewProfile)} disabled={resending === viewProfile.id}>
                    <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Denial Email"}
                  </Button>
                )}
                {viewProfile.approval_status === "approved" && !["permanently_banned", "temp_banned"].includes(viewBanStatus) && (
                  <>
                    <Button variant="outline" className="flex-1" onClick={() => resendApprovalEmail(viewProfile)} disabled={resending === viewProfile.id}>
                      <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Approval Email"}
                    </Button>
                    <Button variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setBanProfile(viewProfile); setBanReason(""); setBanType("warning"); }}>
                      <ShieldAlert className="w-4 h-4 mr-1" /> Take Action
                    </Button>
                  </>
                )}
                {["permanently_banned", "temp_banned"].includes(viewBanStatus) && (
                  <Button variant="outline" className="flex-1" onClick={() => unbanUser(viewProfile)}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Lift Ban
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deny Reason Dialog */}
      <Dialog open={!!denyProfile} onOpenChange={() => setDenyProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Deny {denyProfile?.full_name || "User"}</DialogTitle>
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
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
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
    </div>
  );
};

export default AdminUsers;
