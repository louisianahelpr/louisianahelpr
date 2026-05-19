import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Calendar, Clock, DollarSign, User, Trash2, AlertTriangle, Shield, Flag, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { safeStorage } from "@/lib/safeStorage";

const RESOLVED_FLAGS_KEY = "admin_resolved_job_flags";
const getResolvedFlags = (): Set<string> => {
  try { return new Set(JSON.parse(safeStorage.getItem(RESOLVED_FLAGS_KEY) || "[]")); }
  catch { return new Set(); }
};
const saveResolvedFlags = (set: Set<string>) => {
  safeStorage.setItem(RESOLVED_FLAGS_KEY, JSON.stringify([...set]));
};
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

const paymentColors: Record<string, string> = {
  unpaid: "bg-muted text-muted-foreground",
  escrow: "bg-primary/10 text-primary",
  released: "bg-secondary text-secondary-foreground",
  refunded: "bg-destructive/10 text-destructive",
};

// ─── Auto-flag logic ──────────────────────────────────────
function detectFlags(job: Job): string[] {
  const flags: string[] = [];
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const combined = `${title} ${desc}`;

  // Unreasonably high budget for the category
  if (job.budget > 5000) flags.push("Very high budget ($" + job.budget + ")");

  // Suspiciously low budget with long hours
  if (job.budget <= 10 && (job.estimated_hours || 0) >= 4) flags.push("Very low pay for estimated hours");

  // Spam / scam keywords
  const spamWords = ["cashapp", "venmo", "zelle", "wire transfer", "western union", "crypto", "bitcoin", "pay outside", "off platform", "cash only", "gift card", "send money", "wire me", "advance payment"];
  for (const word of spamWords) {
    if (combined.includes(word)) {
      flags.push("Contains suspicious payment keyword: \"" + word + "\"");
      break;
    }
  }

  // Personal info patterns
  const phoneRegex = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (phoneRegex.test(combined)) flags.push("Contains phone number in description");
  if (emailRegex.test(combined)) flags.push("Contains email in description");

  // Very short/empty description
  if (desc.trim().length < 10) flags.push("Description too short or vague");

  // Excessive caps (yelling)
  const upperCount = (job.description || "").replace(/[^A-Z]/g, "").length;
  const totalAlpha = (job.description || "").replace(/[^a-zA-Z]/g, "").length;
  if (totalAlpha > 20 && upperCount / totalAlpha > 0.7) flags.push("Excessive caps (possible spam)");

  // Date in the past
  if (job.date_needed && new Date(job.date_needed) < new Date(new Date().toDateString())) {
    flags.push("Date needed is in the past");
  }

  return flags;
}

const AdminJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [posterName, setPosterName] = useState("");
  const [helperName, setHelperName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(""); // empty = full refund; otherwise partial $
  const [refunding, setRefunding] = useState(false);
  const [filter, setFilter] = useState<"all" | "flagged" | "resolved">("flagged");
  const [jobFlags, setJobFlags] = useState<Map<string, string[]>>(new Map());
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(getResolvedFlags());

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[AdminJobs] load:", error);
        toast.error("Failed to load jobs");
      } else if (data) {
        setJobs(data);
        const flagMap = new Map<string, string[]>();
        for (const job of data) {
          const existingFlags = job.flag_reasons || [];
          const detected = detectFlags(job);
          const allFlags = [...new Set([...existingFlags, ...detected])];
          if (allFlags.length > 0) flagMap.set(job.id, allFlags);
        }
        setJobFlags(flagMap);
      }
      setLoading(false);
    };
    load();
  }, []);

  const markFlagResolved = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.add(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
    toast.success("Flag marked as resolved");
  };

  const reopenFlag = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.delete(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
  };

  const openJob = async (job: Job) => {
    setDetailJob(job);
    setPosterName("");
    setHelperName("");
    const ids = [job.customer_id, job.helper_id].filter(Boolean) as string[];
    if (ids.length > 0) {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      if (error) {
        console.error("[AdminJobs] openJob profiles:", error);
      } else if (data) {
        const map = new Map(data.map((p) => [p.user_id, formatName(p.full_name)]));
        setPosterName(map.get(job.customer_id) || "Unknown");
        if (job.helper_id) setHelperName(map.get(job.helper_id) || "Unknown");
      }
    }
  };

  const handleDelete = async () => {
    if (!detailJob || !deleteReason.trim()) return;
    setDeleting(true);

    try {
      // Soft-delete: mark as cancelled with removal reason
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("jobs")
        .update({
          status: "cancelled",
          cancellation_reason: `[Admin removed] ${deleteReason}`,
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id || null,
          removal_reason: deleteReason,
          removed_at: new Date().toISOString(),
          removed_by: user?.id || null,
        })
        .eq("id", detailJob.id);

      if (error) throw error;

      // Notify the job poster
      await supabase.from("notifications").insert({
        user_id: detailJob.customer_id,
        title: "Job removed by admin",
        message: `Your job "${detailJob.title}" was removed. Reason: ${deleteReason}`,
        type: "warning",
        link: "/my-jobs",
      });

      // Also notify the helper if assigned
      if (detailJob.helper_id) {
        await supabase.from("notifications").insert({
          user_id: detailJob.helper_id,
          title: "Job removed by admin",
          message: `The job "${detailJob.title}" you were assigned to was removed by an admin.`,
          type: "warning",
          link: "/dashboard",
        });
      }

      // Update local state
      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, status: "cancelled", cancellation_reason: `[Admin removed] ${deleteReason}` } : j));
      toast.success("Job removed and poster notified");
      setDeleteOpen(false);
      setDeleteReason("");
      setDetailJob(null);
    } catch (err: any) {
      toast.error("Failed to remove job: " + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRefund = async () => {
    if (!detailJob) return;
    // Parse the partial-amount input. Empty/0/NaN → full refund (no
    // amountCents sent). Validation against job total happens server-side.
    const parsedDollars = Number(refundAmount.trim());
    const totalCents = Math.round(Number(detailJob.budget || 0) * 100);
    const partialCents = refundAmount.trim() && parsedDollars > 0
      ? Math.round(parsedDollars * 100)
      : null;
    if (partialCents !== null && partialCents > totalCents) {
      toast.error(`Partial amount $${parsedDollars.toFixed(2)} exceeds job total $${Number(detailJob.budget).toFixed(2)}`);
      return;
    }
    const isPartial = partialCents !== null && partialCents < totalCents;

    setRefunding(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          action: "admin_refund_general",
          jobId: detailJob.id,
          reason: refundReason.trim() || undefined,
          ...(isPartial ? { amountCents: partialCents } : {}),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      if (!isPartial) {
        // Full refund cancels the job — reflect locally. Partial refund
        // leaves job state intact server-side, so don't mutate either.
        setJobs((prev) => prev.map((j) => j.id === detailJob.id
          ? { ...j, status: "cancelled" as Job["status"], payment_status: "refunded" as Job["payment_status"] }
          : j));
      }
      toast.success(isPartial
        ? `Partial refund of $${parsedDollars.toFixed(2)} issued`
        : "Refund issued and parties notified");
      setRefundOpen(false);
      setRefundReason("");
      setRefundAmount("");
      setDetailJob(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to issue refund";
      toast.error(msg);
    } finally {
      setRefunding(false);
    }
  };

  const flaggedIds = [...jobFlags.keys()].filter((id) => !resolvedFlags.has(id));
  const flaggedCount = flaggedIds.length;
  const resolvedCount = [...jobFlags.keys()].filter((id) => resolvedFlags.has(id)).length;
  const filteredJobs =
    filter === "flagged"
      ? jobs.filter((j) => jobFlags.has(j.id) && !resolvedFlags.has(j.id))
      : filter === "resolved"
      ? jobs.filter((j) => jobFlags.has(j.id) && resolvedFlags.has(j.id))
      : jobs;

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  return (
    <div className="space-y-6">
      {jobFlags.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === "flagged" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("flagged")}
              className="gap-1.5"
            >
              <Flag className="w-3.5 h-3.5" />
              Flagged ({flaggedCount})
            </Button>
            <Button
              variant={filter === "resolved" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("resolved")}
              className="gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Resolved ({resolvedCount})
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">

        {filteredJobs.map((job) => {
          const flags = jobFlags.get(job.id);
          const isResolved = resolvedFlags.has(job.id);
          const showFlagStyle = flags && !isResolved;
          const isRemoved = !!job.removal_reason;
          return (
            <div
              key={job.id}
              onClick={() => openJob(job)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openJob(job);
                }
              }}
              className={`rounded-ds-md border bg-card p-4 cursor-pointer hover:bg-secondary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                showFlagStyle ? "border-destructive/30" : "border-border"
              } ${isRemoved ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {showFlagStyle && <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />}
                    {flags && isResolved && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                    <p className="font-semibold text-foreground truncate">{job.title}</p>
                    <Badge variant="secondary" className="text-ds-11 capitalize">{categoryLabels[job.category] || job.category}</Badge>
                    {isRemoved && <Badge variant="destructive" className="text-ds-11">Removed</Badge>}
                    {flags && isResolved && <Badge variant="outline" className="text-ds-11 gap-1"><CheckCircle2 className="w-3 h-3" />Resolved</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-ds-11 text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                    <span className="font-medium text-foreground">${job.budget}</span>
                  </div>
                  {showFlagStyle && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {flags!.slice(0, 2).map((f, i) => (
                        <span key={i} className="text-ds-10 bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{f}</span>
                      ))}
                      {flags!.length > 2 && <span className="text-ds-10 text-destructive">+{flags!.length - 2} more</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end flex-shrink-0">
                  <StatusBadge status={job.status} className="text-ds-11" />
                  <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium capitalize ${paymentColors[job.payment_status || "unpaid"] || ""}`}>
                    {job.payment_status || "unpaid"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {filteredJobs.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            {filter === "flagged" ? "No flagged jobs found 🎉" : "No jobs found"}
          </p>
        )}
      </div>

      {/* Job Detail Dialog */}
      <Dialog open={!!detailJob && !deleteOpen} onOpenChange={() => setDetailJob(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{detailJob?.title}</DialogTitle>
          </DialogHeader>
          {detailJob && (
            <div className="space-y-4">
              {/* Flags banner */}
              {jobFlags.has(detailJob.id) && (
                resolvedFlags.has(detailJob.id) ? (
                  <div className="rounded-ds-sm bg-primary/5 border border-primary/20 p-3 flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <p className="text-ds-11 font-semibold text-primary flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Flags marked as resolved
                      </p>
                      <p className="text-ds-11 text-muted-foreground pl-5">An admin reviewed this job and confirmed it's fine.</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => reopenFlag(detailJob.id)}>
                      Reopen
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-ds-11 font-semibold text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Auto-flagged Issues
                      </p>
                      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => markFlagResolved(detailJob.id)}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved
                      </Button>
                    </div>
                    {jobFlags.get(detailJob.id)!.map((flag, i) => (
                      <p key={i} className="text-ds-11 text-destructive/80 pl-5">• {flag}</p>
                    ))}
                  </div>
                )
              )}

              {/* Removal info */}
              {detailJob.removal_reason && (
                <div className="rounded-ds-sm bg-destructive/10 border border-destructive/30 p-3">
                  <p className="text-ds-11 font-semibold text-destructive flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Removed by Admin
                  </p>
                  <p className="text-ds-13 text-foreground mt-1">{detailJob.removal_reason}</p>
                  {detailJob.removed_at && (
                    <p className="text-ds-11 text-muted-foreground mt-1">
                      Removed on {new Date(detailJob.removed_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {(detailJob.photos || []).length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {(detailJob.photos || []).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                      <img loading="lazy" decoding="async" src={url} alt={`Photo ${i + 1}`} className="w-32 h-24 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="capitalize">{categoryLabels[detailJob.category] || detailJob.category}</Badge>
                <StatusBadge status={detailJob.status} className="text-ds-11" />
                <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium capitalize ${paymentColors[detailJob.payment_status || "unpaid"]}`}>
                  {detailJob.payment_status || "unpaid"}
                </span>
              </div>

              <p className="text-ds-13 text-foreground">{detailJob.description}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Budget</p>
                  <p className="font-semibold text-foreground">${detailJob.budget}</p>
                </div>
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
                  <p className="font-semibold text-foreground">{detailJob.location}</p>
                </div>
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Date Needed</p>
                  <p className="font-semibold text-foreground">{new Date(detailJob.date_needed).toLocaleDateString()}</p>
                </div>
                {detailJob.start_time && (
                  <div className="rounded-ds-sm bg-secondary/30 p-3">
                    <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Start Time</p>
                    <p className="font-semibold text-foreground">{detailJob.start_time}</p>
                  </div>
                )}
                {detailJob.estimated_hours && (
                  <div className="rounded-ds-sm bg-secondary/30 p-3">
                    <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                    <p className="font-semibold text-foreground">{detailJob.estimated_hours}h</p>
                  </div>
                )}
                {detailJob.platform_fee_amount && (
                  <div className="rounded-ds-sm bg-secondary/30 p-3">
                    <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Platform Fee</p>
                    <p className="font-semibold text-foreground">${detailJob.platform_fee_amount} ({detailJob.platform_fee_percent}%)</p>
                  </div>
                )}
              </div>

              {detailJob.special_requirements && (
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground mb-1">Special Requirements</p>
                  <p className="text-ds-13 text-foreground">{detailJob.special_requirements}</p>
                </div>
              )}

              {detailJob.revision_note && (
                <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
                  <p className="text-ds-11 text-destructive mb-1">Revision Note</p>
                  <p className="text-ds-13 text-foreground">{detailJob.revision_note}</p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2 text-ds-13">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Posted by</span>
                  <span className="font-medium text-foreground">{posterName || "Loading…"}</span>
                </div>
                {detailJob.helper_id && (
                  <div className="flex items-center gap-2 text-ds-13">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Assigned to</span>
                    <span className="font-medium text-foreground">{helperName || "Loading…"}</span>
                  </div>
                )}
                <p className="text-ds-11 text-muted-foreground">
                  Created {new Date(detailJob.created_at).toLocaleString()}
                </p>
              </div>

              {/* Admin actions */}
              {!(detailJob as { removal_reason?: string }).removal_reason && (
                <div className="pt-3 border-t border-border flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                    className="gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove Job
                  </Button>
                  {/* Refund only relevant when money has actually changed
                      hands. payment_status='escrow' = captured but held.
                      payment_status='released' = transferred to helper. */}
                  {(detailJob.payment_status === "escrow" || detailJob.payment_status === "released") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRefundOpen(true)}
                      className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5"
                    >
                      <DollarSign className="w-3.5 h-3.5" /> Refund Customer
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Remove Job
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              This will cancel the job and notify the poster{detailJob?.helper_id ? " and assigned helper" : ""}. Please provide a reason:
            </p>
            <Textarea
              aria-label="Reason for cancelling job"
              placeholder="e.g. This listing violates our community guidelines…"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
            />
            {detailJob && (
              <div className="rounded-ds-sm bg-secondary/30 p-3">
                <p className="text-ds-11 text-muted-foreground">Job being removed</p>
                <p className="text-ds-13 font-medium text-foreground">{detailJob.title}</p>
                <p className="text-ds-11 text-muted-foreground">${detailJob.budget} · {detailJob.location}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!deleteReason.trim() || deleting}
            >
              {deleting ? "Removing…" : "Remove & Notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund confirmation dialog */}
      <Dialog open={refundOpen} onOpenChange={(o) => { if (!o) { setRefundOpen(false); setRefundReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-destructive flex items-center gap-2">
              <DollarSign className="w-5 h-5" /> Refund Customer
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-ds-11 text-muted-foreground">
              Issues a Stripe refund for the captured payment. Leave the
              amount field blank for a full refund (cancels the job +
              notifies both parties); enter a smaller dollar amount to issue
              a partial refund (job state stays intact). Logged to admin_audit_log.
            </p>
            {detailJob && (
              <div className="rounded-ds-sm bg-secondary/30 p-3 space-y-1">
                <p className="text-ds-11 text-muted-foreground">Refunding</p>
                <p className="text-ds-13 font-medium text-foreground">{detailJob.title}</p>
                <p className="text-ds-11 text-muted-foreground">
                  ${detailJob.budget} · payment_status: {detailJob.payment_status}
                  {detailJob.helper_id && " · helper assigned"}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-ds-11 font-medium text-foreground">
                Refund amount <span className="text-muted-foreground font-normal">(blank = full refund)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-13 text-muted-foreground pointer-events-none">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max={detailJob?.budget || undefined}
                  placeholder={detailJob ? `${Number(detailJob.budget).toFixed(2)}` : "0.00"}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-ds-13 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {refundAmount.trim() && Number(refundAmount) > 0 && detailJob && Number(refundAmount) < Number(detailJob.budget) && (
                <p className="text-ds-11 text-muted-foreground">
                  Partial refund of ${Number(refundAmount).toFixed(2)} of ${Number(detailJob.budget).toFixed(2)} —
                  job stays open, helper not notified.
                </p>
              )}
            </div>
            <Textarea
              aria-label="Refund reason (optional)"
              placeholder="Reason (optional, included in customer notification and audit log)"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              rows={3}
            />
            {detailJob?.payment_status === "released" && (
              <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
                <p className="text-ds-11 text-destructive font-medium mb-1">⚠️ Money already paid out</p>
                <p className="text-ds-11 text-foreground">
                  This payment has already been transferred to the helper.
                  Refunding the customer means the platform absorbs the loss
                  unless you separately reverse the transfer in Stripe.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRefundOpen(false); setRefundReason(""); setRefundAmount(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRefund}
              disabled={refunding}
            >
              {refunding ? "Refunding…" : "Issue Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminJobs;
