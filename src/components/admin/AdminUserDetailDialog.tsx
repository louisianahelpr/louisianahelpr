/**
 * The admin "User Profile" detail dialog — a 6-tab modal (Actions,
 * Overview, Jobs, Reviews, Docs, Emails) shown when a user is opened
 * from the admin Users screen.
 *
 * Extracted verbatim from AdminUsers.tsx (step 3 of splitting that file).
 * This is a faithful relocation: the JSX is unchanged, every value it
 * read from the parent is now a prop, and the Jobs-tab-local `jobsRole`/
 * `jobsSort` state moved in with it. `viewBanStatus` is re-derived here
 * from `viewProfile` exactly as the parent derived it.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CheckCircle2, XCircle, Star, FileText, AlertTriangle, ShieldAlert, Clock,
  MailIcon, RefreshCw, Eye, MousePointerClick, Pencil, Trash2, ShieldCheck,
  KeyRound, MessageSquareWarning, History,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";
import { toast } from "sonner";
import AdminUserNotes from "./AdminUserNotes";
import UserVerificationHistory from "./UserVerificationHistory";
import { type Profile, isVerifiedEmail, statusBadge, stripeBadge } from "./adminUserHelpers";
import { jobStatusColorClasses } from "@/lib/statusColors";

interface AdminUserDetailDialogProps {
  /** Profile being viewed — the dialog is open iff this is non-null. */
  viewProfile: Profile | null;
  setViewProfile: (profile: Profile | null) => void;
  /** Supplemental detail the parent loads when a profile is opened. */
  profileReviews: { rating: number; feedback: string | null; reviewer_name: string; created_at?: string; job_title?: string }[];
  profileReviewsLeft: { rating: number; feedback: string | null; reviewee_name: string; created_at?: string; job_title?: string }[];
  profileViolations: any[];
  profileJobs: any[];
  idDocSignedUrl: string | null;
  emailTracking: { event_type: string; email_type: string; created_at: string }[];
  emailSendStats: { template_name: string; count: number; last_sent: string }[];
  /** Per-user last-login map — tells whether an approved user is active yet. */
  lastLoginSummary: Record<string, string>;
  /** Profile id currently mid-resend, or null — drives the email spinners. */
  resending: string | null;
  /** Reloads the parent's profile list after an inline status change. */
  loadProfiles: () => void;
  /** Account lifecycle + support actions, all owned by the parent. */
  approveUser: (profile: Profile) => void;
  resendApprovalEmail: (profile: Profile) => void;
  resendDenialEmail: (profile: Profile) => void;
  resendVerificationEmail: (profile: Profile) => void;
  unbanUser: (profile: Profile) => void;
  viewHistoryFor: (profile: Profile) => void;
  /** Sub-dialog openers — set the target profile for each per-action dialog. */
  setEditEmailProfile: (profile: Profile | null) => void;
  setDenyProfile: (profile: Profile | null) => void;
  setBanProfile: (profile: Profile | null) => void;
  setDeleteProfile: (profile: Profile | null) => void;
  setManualVerifyProfile: (profile: Profile | null) => void;
  setWarningProfile: (profile: Profile | null) => void;
  setResetPwProfile: (profile: Profile | null) => void;
}

export function AdminUserDetailDialog({
  viewProfile,
  setViewProfile,
  profileReviews,
  profileReviewsLeft,
  profileViolations,
  profileJobs,
  idDocSignedUrl,
  emailTracking,
  emailSendStats,
  lastLoginSummary,
  resending,
  loadProfiles,
  approveUser,
  resendApprovalEmail,
  resendDenialEmail,
  resendVerificationEmail,
  unbanUser,
  viewHistoryFor,
  setEditEmailProfile,
  setDenyProfile,
  setBanProfile,
  setDeleteProfile,
  setManualVerifyProfile,
  setWarningProfile,
  setResetPwProfile,
}: AdminUserDetailDialogProps) {
  // Jobs-tab-local filters — moved in with the dialog. `jobsSort` is
  // currently fixed to "recent" (no UI control yet) but kept as state so
  // a sort control can be wired up later without re-threading props.
  const [jobsRole, setJobsRole] = useState<"all" | "worked" | "posted">("all");
  const [jobsSort] = useState<"recent" | "earnings_desc" | "earnings_asc">("recent");
  const viewBanStatus = viewProfile?.ban_status || "active";

  return (
    <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl h-[90vh] overflow-hidden p-3 sm:p-5 flex flex-col gap-0">
        <DialogHeader className="pb-2 mb-2 border-b border-border flex-shrink-0">
          <DialogTitle className="font-display text-ds-17 sm:text-ds-20">User Profile</DialogTitle>
        </DialogHeader>
        {viewProfile && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0 break-words gap-3">
            {/* Header: Avatar + Basic Info */}
            <div className="flex gap-3 sm:gap-4">
              {viewProfile.avatar_url ? (
                <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                  <img loading="lazy" decoding="async" src={viewProfile.avatar_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-ds-md object-cover border-2 border-border hover:border-primary transition-colors cursor-pointer" />
                </a>
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-ds-md bg-secondary flex items-center justify-center text-muted-foreground text-ds-24 font-medium flex-shrink-0">
                  {formatName(viewProfile.full_name, "?")[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="text-ds-15 sm:text-ds-17 font-bold text-foreground truncate">{formatName(viewProfile.full_name, "—")}</h3>
                  {statusBadge(viewProfile)}
                  {stripeBadge(viewProfile)}

                  {(viewProfile.application_count || 1) > 1 && (
                    <Badge variant="outline" className="text-ds-10 bg-accent/10 text-accent-foreground border-accent/30">
                      Applied {viewProfile.application_count}x
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-ds-11 sm:text-ds-11 text-muted-foreground truncate">{viewProfile.email || "No email"}</p>
                  <button
                    onClick={() => setEditEmailProfile(viewProfile)}
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
                        const currentCount = viewProfile.application_count || 1;
                        await supabase.from("profiles").update({
                          approval_status: "pending",
                          denial_reason: null,
                          application_count: currentCount + 1,
                        }).eq("id", viewProfile.id);
                        toast.success("User moved back to pending for re-review.");
                        loadProfiles();
                        setViewProfile(null);
                      }}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Move to Pending
                    </Button>
                    {(() => {
                      const sent = viewProfile.denial_email_count || 0;
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
                              setViewProfile({ ...viewProfile, denial_email_count: sent + 1, last_denial_email_at: new Date().toISOString() });
                            }}
                            title={maxReached ? "Max 3 reminder emails reached" : "Send denial reminder email"}
                          >
                            {resending === viewProfile.id
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <><MailIcon className="w-3.5 h-3.5 mr-1.5" /> Resend Email</>}
                          </Button>
                          <Badge variant="outline" className={`text-ds-10 ${maxReached ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-muted text-muted-foreground"}`}>
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
                <TabsTrigger value="actions" className="text-ds-10 sm:text-ds-13 px-1">Actions</TabsTrigger>
                <TabsTrigger value="overview" className="text-ds-10 sm:text-ds-13 px-1">Overview</TabsTrigger>
                <TabsTrigger value="jobs" className="text-ds-10 sm:text-ds-13 px-1">Jobs</TabsTrigger>
                <TabsTrigger value="reviews" className="text-ds-10 sm:text-ds-13 px-1">Reviews</TabsTrigger>
                <TabsTrigger value="documents" className="text-ds-10 sm:text-ds-13 px-1">Docs</TabsTrigger>
                <TabsTrigger value="emails" className="text-ds-10 sm:text-ds-13 px-1">Emails</TabsTrigger>
              </TabsList>

              {/* ===== OVERVIEW TAB ===== */}
              <TabsContent value="overview" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
                {/* Bio */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Bio</h4>
                  <p className={`text-ds-13 leading-relaxed ${viewProfile.bio ? "text-foreground" : "text-muted-foreground italic"}`}>
                    {viewProfile.bio || "Not provided"}
                  </p>
                </div>

                {/* Contact & Account */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Contact & Account</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 rounded-ds-md bg-secondary/30 border border-border p-4">
                    <div>
                      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Phone</p>
                      <p className={`text-ds-13 font-medium ${viewProfile.phone ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.phone || "Not provided"}</p>
                    </div>
                    <div>
                      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Location</p>
                      <p className={`text-ds-13 font-medium ${viewProfile.location ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.location || "Not provided"}</p>
                    </div>
                    <div>
                      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Date of Birth</p>
                      <p className={`text-ds-13 font-medium ${viewProfile.date_of_birth ? "text-foreground" : "text-muted-foreground italic"}`}>
                        {viewProfile.date_of_birth
                          ? new Date(viewProfile.date_of_birth).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                          : "Not provided"}
                      </p>
                    </div>
                    <div>
                      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Joined</p>
                      <p className="text-ds-13 font-medium text-foreground">{new Date(viewProfile.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                    </div>
                    <div>
                      <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Last Active</p>
                      <p className="text-ds-13 font-medium text-foreground">{formatDistanceToNow(new Date(viewProfile.updated_at), { addSuffix: true })}</p>
                    </div>
                  </div>
                </div>

                {/* Skills */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Skills</h4>
                  {viewProfile.skills ? (
                    <div className="flex flex-wrap gap-1.5">
                      {viewProfile.skills.split(",").map((skill, i) => (
                        <Badge key={i} variant="secondary" className="text-ds-11">{skill.trim()}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
                  )}
                </div>

                {/* Signup Answers */}
                {(() => {
                  const p = viewProfile;
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
                      <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Signup Answers</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 rounded-ds-md bg-secondary/30 border border-border p-4">
                        {fields.map((f, i) => (
                          <div key={i}>
                            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">{f.label}</p>
                            <p className={`text-ds-13 font-medium ${f.value ? "text-foreground" : "text-muted-foreground italic"}`}>{f.value || "Not provided"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Violations History */}
                {profileViolations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-destructive" /> Violations ({profileViolations.length})
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {profileViolations.map((v: any) => (
                        <div key={v.id} className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium ${
                              v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive" :
                              v.action_taken === "temp_ban" ? "bg-destructive/10 text-destructive" :
                              "bg-accent/20 text-accent-foreground"
                            }`}>
                              {v.action_taken === "permanent_ban" ? "Perm Ban" : v.action_taken === "temp_ban" ? "Temp Ban" : "Warning"}
                            </span>
                            <span className="text-ds-11 text-muted-foreground capitalize">{v.violation_type?.replace(/_/g, " ")}</span>
                            <span className="text-ds-11 text-muted-foreground ml-auto">{new Date(v.created_at).toLocaleDateString()}</span>
                          </div>
                          {v.description && <p className="text-ds-11 text-foreground">{v.description}</p>}
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
                      {/* Stripe payout connection status */}
                      {(() => {
                        const hasStripe = !!viewProfile.stripe_account_id;
                        return (
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-ds-11 font-medium ${
                            hasStripe
                              ? "bg-primary/5 border-primary/20 text-primary"
                              : "bg-muted/50 border-border text-muted-foreground"
                          }`}>
                            {hasStripe ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            {hasStripe ? "Stripe payout connected" : "Stripe payout not connected"}
                          </div>
                        );
                      })()}

                      {/* Summary */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-ds-md bg-secondary/30 border border-border p-3">
                          <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Earned (Worked)</p>
                          <p className="text-ds-17 font-semibold text-foreground">${totalEarned.toFixed(2)}</p>
                          <p className="text-muted-foreground text-ds-11">{workedCompleted.length} completed</p>
                        </div>
                        <div className="rounded-ds-md bg-secondary/30 border border-border p-3">
                          <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Spent (Posted)</p>
                          <p className="text-ds-17 font-semibold text-foreground">${totalSpent.toFixed(2)}</p>
                          <p className="text-muted-foreground text-ds-11">{postedCompleted.length} completed</p>
                        </div>
                      </div>


                      {/* Filters */}
                      <div className="w-full">
                        <Select value={jobsRole} onValueChange={(v: any) => setJobsRole(v)}>
                          <SelectTrigger className="h-9 text-ds-11 w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Jobs</SelectItem>
                            <SelectItem value="worked">Worked (Helpr)</SelectItem>
                            <SelectItem value="posted">Posted (Customer)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* List */}
                      {sorted.length === 0 ? (
                        <p className="text-ds-11 text-muted-foreground italic">No jobs found.</p>
                      ) : (
                        <div className="space-y-2">
                          {sorted.map((j: any) => {
                            const isHelper = j.helper_id === viewProfile.user_id;
                            const earning = calcEarning(j);
                            const dateRef = j.poster_completed_at || j.helper_completed_at || j.created_at;
                            return (
                              <div key={j.id} className="p-3 rounded-lg bg-secondary/30 border border-border">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="text-ds-13 font-medium text-foreground line-clamp-1">{j.title}</p>
                                  <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${jobStatusColorClasses(j.status)}`}>{j.status}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-ds-11 text-muted-foreground">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-ds-10 h-5">{isHelper ? "Worked" : "Posted"}</Badge>
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
                                  <span className="text-ds-13 font-semibold text-foreground">
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
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Star className="w-4 h-4" /> Reviews Received ({profileReviews.length})
                  </h4>
                  {profileReviews.length === 0 ? (
                    <p className="text-ds-11 text-muted-foreground italic">No reviews received yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileReviews.map((r, i) => (
                        <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="min-w-0">
                              <p className="text-ds-13 font-medium text-foreground">From {r.reviewer_name}</p>
                              {r.job_title && <p className="text-ds-11 text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                              ))}
                            </div>
                          </div>
                          {r.feedback && <p className="text-ds-11 text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                          {r.created_at && <p className="text-muted-foreground text-ds-11 mt-1">{new Date(r.created_at).toLocaleDateString()}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reviews Left */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Star className="w-4 h-4" /> Reviews Left ({profileReviewsLeft.length})
                  </h4>
                  {profileReviewsLeft.length === 0 ? (
                    <p className="text-ds-11 text-muted-foreground italic">Hasn't left any reviews yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileReviewsLeft.map((r, i) => (
                        <div key={i} className="p-3 rounded-lg bg-secondary/30 border border-border">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="min-w-0">
                              <p className="text-ds-13 font-medium text-foreground">For {r.reviewee_name}</p>
                              {r.job_title && <p className="text-ds-11 text-muted-foreground line-clamp-1">on "{r.job_title}"</p>}
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <Star key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                              ))}
                            </div>
                          </div>
                          {r.feedback && <p className="text-ds-11 text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>}
                          {r.created_at && <p className="text-muted-foreground text-ds-11 mt-1">{new Date(r.created_at).toLocaleDateString()}</p>}
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
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> ID Document
                  </h4>
                  {viewProfile.id_document_url ? (
                    <div className="rounded-ds-md border border-border overflow-hidden bg-secondary/20">
                      {idDocSignedUrl ? (
                        /\.(jpg|jpeg|png|gif|webp)$/i.test(viewProfile.id_document_url) ? (
                          <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer">
                            <img loading="lazy" decoding="async" src={idDocSignedUrl} alt="ID Document" className="max-h-64 w-auto mx-auto object-contain hover:opacity-90 transition-opacity" />
                          </a>
                        ) : (
                          <div className="p-4 flex items-center gap-3">
                            <FileText className="w-8 h-8 text-primary" />
                            <div>
                              <p className="text-ds-13 font-medium text-foreground break-all">{viewProfile.id_document_url.split("/").pop()}</p>
                              <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer" className="text-ds-11 text-primary underline">
                                Open document ↗
                              </a>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="p-4 text-center">
                          <p className="text-ds-11 text-muted-foreground">Loading document…</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
                  )}
                </div>

                {/* Profile Picture */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Profile Picture</h4>
                  {viewProfile.avatar_url ? (
                    <a href={viewProfile.avatar_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                      <img loading="lazy" decoding="async" src={viewProfile.avatar_url} alt="Profile" className="w-32 h-32 rounded-ds-md object-cover border-2 border-border hover:border-primary transition-colors" />
                    </a>
                  ) : (
                    <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
                  )}
                </div>

                {/* Portfolio */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> Portfolio & Documents ({(viewProfile.portfolio_urls || []).length})
                  </h4>
                  {(viewProfile.portfolio_urls || []).length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {(viewProfile.portfolio_urls || []).map((url: string, i: number) => {
                        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                        const fileName = url.split("/").pop() || "Document";
                        return isImage ? (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md overflow-hidden border border-border hover:border-primary transition-colors block group">
                            <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          </a>
                        ) : (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 hover:border-primary transition-colors">
                            <FileText className="w-6 h-6 text-muted-foreground mb-1" />
                            <p className="text-muted-foreground text-ds-11 text-center truncate w-full">{fileName}</p>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
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
                      : `Resend Verification${(viewProfile.verification_email_count || 0) > 0 ? ` (${viewProfile.verification_email_count}/3)` : ""}`}
                  </Button>
                )}
                {/* Resend Denial Email */}
                {viewProfile.approval_status === "denied" && (
                  <Button variant="outline" className="w-full" onClick={() => resendDenialEmail(viewProfile)} disabled={resending === viewProfile.id}>
                    <MailIcon className="w-4 h-4 mr-1" /> {resending === viewProfile.id ? "Sending…" : "Resend Denial Email"}
                  </Button>
                )}
                {/* Send approval follow-up (only when user hasn't shown activity yet) */}
                {viewProfile.approval_status === "approved" && !["permanently_banned", "temp_banned"].includes(viewBanStatus) && (() => {
                  const opens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
                  const clicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
                  const hasLoggedIn = !!lastLoginSummary[viewProfile.user_id];
                  const idvVerified = viewProfile.idv_status === 'verified';
                  const hasStripe = !!viewProfile.stripe_account_id;
                  const hasOpenedEmail = opens.length > 0 || clicks.length > 0;
                  const isActive = hasLoggedIn || idvVerified || hasStripe || hasOpenedEmail;
                  if (isActive) return null;
                  const sent = viewProfile.approval_email_count || 0;
                  const maxReached = sent >= 3;
                  return (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => resendApprovalEmail(viewProfile)}
                      disabled={resending === viewProfile.id || maxReached}
                      title={maxReached ? "Max 3 follow-up emails reached" : "Send a manual follow-up reminder (auto-reminders also run every 3 days)"}
                    >
                      <MailIcon className="w-4 h-4 mr-1" />
                      {resending === viewProfile.id ? "Sending…" : `Send Approval Follow-up (${sent}/3)`}
                    </Button>
                  );
                })()}
                {/* Approval email tracking */}
                {viewProfile.approval_status === "approved" && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
                    <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
                      <MailIcon className="w-3.5 h-3.5" /> Approval Email Status
                    </p>
                    <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
                      <span>Emails sent: {viewProfile.approval_email_count || 0} / 3</span>
                      {viewProfile.last_approval_email_at && (
                        <span>Last sent: {new Date(viewProfile.last_approval_email_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    {(() => {
                      const opens = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'open');
                      const clicks = emailTracking.filter(t => t.email_type === 'account_approved' && t.event_type === 'click');
                      return (opens.length > 0 || clicks.length > 0) ? (
                        <div className="flex gap-4 pt-1">
                          <span className="flex items-center gap-1 text-ds-11 text-primary">
                            <Eye className="w-3 h-3" /> {opens.length} open{opens.length !== 1 ? 's' : ''}
                            {opens[0] && <span className="text-muted-foreground ml-1">({new Date(opens[0].created_at).toLocaleDateString()})</span>}
                          </span>
                          <span className="flex items-center gap-1 text-ds-11 text-primary">
                            <MousePointerClick className="w-3 h-3" /> {clicks.length} click{clicks.length !== 1 ? 's' : ''}
                            {clicks[0] && <span className="text-muted-foreground ml-1">({new Date(clicks[0].created_at).toLocaleDateString()})</span>}
                          </span>
                        </div>
                      ) : (
                        <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
                      );
                    })()}
                  </div>
                )}

                {/* Verification email tracking — for unverified pending users */}
                {viewProfile.approval_status === "pending" && !isVerifiedEmail(viewProfile) && (
                  <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 space-y-2">
                    <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
                      <MailIcon className="w-3.5 h-3.5" /> Verification Email Status
                    </p>
                    <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
                      <span>Emails sent: {viewProfile.verification_email_count || 0} / 3</span>
                      {viewProfile.last_verification_email_at && (
                        <span>Last sent: {formatDistanceToNow(new Date(viewProfile.last_verification_email_at), { addSuffix: true })}</span>
                      )}
                    </div>
                    {(() => {
                      const opens = emailTracking.filter(t => t.email_type === 'email_verification' && t.event_type === 'open');
                      const clicks = emailTracking.filter(t => t.email_type === 'email_verification' && t.event_type === 'click');
                      return (opens.length > 0 || clicks.length > 0) ? (
                        <div className="flex gap-4 pt-1">
                          <span className="flex items-center gap-1 text-ds-11 text-accent-foreground">
                            <Eye className="w-3 h-3" /> {opens.length} open{opens.length !== 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1 text-ds-11 text-accent-foreground">
                            <MousePointerClick className="w-3 h-3" /> {clicks.length} click{clicks.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      ) : (
                        <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
                      );
                    })()}
                  </div>
                )}

                {/* Denial email tracking */}
                {viewProfile.approval_status === "denied" && (
                  <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 space-y-2">
                    <p className="text-ds-11 font-medium text-foreground flex items-center gap-1.5">
                      <MailIcon className="w-3.5 h-3.5" /> Denial Email Status
                    </p>
                    <div className="flex items-center justify-between text-ds-11 text-muted-foreground">
                      <span>Emails sent: {viewProfile.denial_email_count || 0} / 3</span>
                      {viewProfile.last_denial_email_at && (
                        <span>Last sent: {new Date(viewProfile.last_denial_email_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    {viewProfile.denial_reason && (
                      <p className="text-ds-11 text-muted-foreground">Reason: {viewProfile.denial_reason}</p>
                    )}
                    {(() => {
                      const opens = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'open');
                      const clicks = emailTracking.filter(t => t.email_type === 'account_denied' && t.event_type === 'click');
                      return (opens.length > 0 || clicks.length > 0) ? (
                        <div className="flex gap-4 pt-1">
                          <span className="flex items-center gap-1 text-ds-11 text-destructive">
                            <Eye className="w-3 h-3" /> {opens.length} open{opens.length !== 1 ? 's' : ''}
                            {opens[0] && <span className="text-muted-foreground ml-1">({new Date(opens[0].created_at).toLocaleDateString()})</span>}
                          </span>
                          <span className="flex items-center gap-1 text-ds-11 text-destructive">
                            <MousePointerClick className="w-3 h-3" /> {clicks.length} click{clicks.length !== 1 ? 's' : ''}
                            {clicks[0] && <span className="text-muted-foreground ml-1">({new Date(clicks[0].created_at).toLocaleDateString()})</span>}
                          </span>
                        </div>
                      ) : (
                        <p className="text-ds-11 text-muted-foreground italic">No opens or clicks tracked yet</p>
                      );
                    })()}
                  </div>
                )}

                {/* Email Send History */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <MailIcon className="w-4 h-4" /> Emails Sent
                    {emailSendStats.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-ds-10">
                        {emailSendStats.reduce((sum, s) => sum + s.count, 0)} total
                      </Badge>
                    )}
                  </h4>
                  {emailSendStats.length === 0 ? (
                    <p className="text-ds-11 text-muted-foreground italic">No emails on record</p>
                  ) : (
                    <div className="rounded-ds-md border border-border bg-secondary/30 divide-y divide-border overflow-hidden">
                      {emailSendStats.map((s) => (
                        <div key={s.template_name} className="flex items-center justify-between gap-3 p-3 text-ds-13">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground truncate capitalize">
                              {s.template_name.replace(/[-_]/g, " ")}
                            </p>
                            <p className="text-ds-11 text-muted-foreground">
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
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Account Actions</h4>
                  <div className="flex gap-2 flex-wrap">
                  {viewProfile.approval_status === "pending" && (
                    <>
                      <Button variant="outline" className="flex-1 min-w-[140px] text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => setDenyProfile(viewProfile)}>
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
                    const idvVerified = viewProfile.idv_status === 'verified';
                    const hasStripe = !!viewProfile.stripe_account_id;
                    const hasOpenedEmail = opens.length > 0 || clicks.length > 0;
                    const isActive = hasLoggedIn || idvVerified || hasStripe || hasOpenedEmail;
                    const activeLabel = idvVerified
                      ? "ID verified"
                      : hasLoggedIn
                      ? "Active — has logged in"
                      : hasStripe
                      ? "Stripe payout connected"
                      : "Has opened approval email";
                    return isActive ? (
                      <div className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-ds-11 text-primary font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {activeLabel}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-[160px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-muted/50 border border-border text-ds-11 text-muted-foreground font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        Awaiting first login
                      </div>
                    );
                  })()}
                  </div>
                </div>

                {/* Internal Admin Notes */}
                <AdminUserNotes userId={viewProfile.user_id} />

                {/* Verification audit trail (helper_verifications table) —
                    shows every change to approval_status, idv_status,
                    legacy_manual_review, etc., with actor + timestamp.
                    Surface BEFORE Admin Tools so reviewers can see the
                    decision history before taking another action. */}
                <UserVerificationHistory userId={viewProfile.user_id} />

                {/* Trust & Verification + Support actions */}
                <div className="space-y-2">
                  <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Admin Tools</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setManualVerifyProfile(viewProfile)}>
                      <ShieldCheck className="w-4 h-4 mr-1.5 text-primary" /> Manually Verify
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setWarningProfile(viewProfile)}>
                      <MessageSquareWarning className="w-4 h-4 mr-1.5 text-accent" /> Formal Warning
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => setResetPwProfile(viewProfile)}>
                      <KeyRound className="w-4 h-4 mr-1.5 text-primary" /> Reset Password
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => viewHistoryFor(viewProfile)}>
                      <History className="w-4 h-4 mr-1.5" /> View History
                    </Button>
                    {!["permanently_banned", "temp_banned"].includes(viewBanStatus) ? (
                      <Button variant="outline" size="sm" className="h-9 justify-center text-destructive border-destructive/30 hover:bg-destructive/10 col-span-2 sm:col-span-1" onClick={() => setBanProfile(viewProfile)}>
                        <ShieldAlert className="w-4 h-4 mr-1.5" /> Suspend / Ban
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="h-9 justify-start" onClick={() => unbanUser(viewProfile)}>
                        <CheckCircle2 className="w-4 h-4 mr-1.5 text-primary" /> Lift Ban
                      </Button>
                    )}
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
  );
}
