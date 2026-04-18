import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Calendar, Clock, DollarSign, User, Trash2, AlertTriangle, Shield, Flag, CheckCircle2 } from "lucide-react";

const RESOLVED_FLAGS_KEY = "admin_resolved_job_flags";
const getResolvedFlags = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(RESOLVED_FLAGS_KEY) || "[]")); }
  catch { return new Set(); }
};
const saveResolvedFlags = (set: Set<string>) => {
  localStorage.setItem(RESOLVED_FLAGS_KEY, JSON.stringify([...set]));
};
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
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
  const [filter, setFilter] = useState<"all" | "flagged">("all");
  const [jobFlags, setJobFlags] = useState<Map<string, string[]>>(new Map());
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(getResolvedFlags());

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) {
        setJobs(data);
        const flagMap = new Map<string, string[]>();
        for (const job of data) {
          const existingFlags = (job as any).flag_reasons || [];
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
      const { data } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      if (data) {
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
          status: "cancelled" as any,
          cancellation_reason: `[Admin removed] ${deleteReason}`,
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id || null,
          removal_reason: deleteReason,
          removed_at: new Date().toISOString(),
          removed_by: user?.id || null,
        } as any)
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
      setJobs((prev) => prev.map((j) => j.id === detailJob.id ? { ...j, status: "cancelled" as any, cancellation_reason: `[Admin removed] ${deleteReason}` } : j));
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

  const flaggedCount = [...jobFlags.keys()].filter((id) => !resolvedFlags.has(id)).length;
  const filteredJobs = filter === "flagged" ? jobs.filter((j) => jobFlags.has(j.id) && !resolvedFlags.has(j.id)) : jobs;

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  return (
    <div className="space-y-6">
      {flaggedCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant={filter === "flagged" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(filter === "flagged" ? "all" : "flagged")}
            className="gap-1.5"
          >
            <Flag className="w-3.5 h-3.5" />
            {flaggedCount} flagged
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {filteredJobs.map((job) => {
          const flags = jobFlags.get(job.id);
          const isRemoved = !!(job as any).removal_reason;
          return (
            <div
              key={job.id}
              onClick={() => openJob(job)}
              className={`rounded-xl border bg-card p-4 cursor-pointer hover:bg-secondary/20 transition-colors ${
                flags ? "border-destructive/30" : "border-border"
              } ${isRemoved ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {flags && <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />}
                    <p className="font-semibold text-foreground truncate">{job.title}</p>
                    <Badge variant="secondary" className="text-xs capitalize">{categoryLabels[job.category] || job.category}</Badge>
                    {isRemoved && <Badge variant="destructive" className="text-xs">Removed</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                    <span className="font-medium text-foreground">${job.budget}</span>
                  </div>
                  {flags && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {flags.slice(0, 2).map((f, i) => (
                        <span key={i} className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">{f}</span>
                      ))}
                      {flags.length > 2 && <span className="text-[10px] text-destructive">+{flags.length - 2} more</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                    {job.status.replace("_", " ")}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${paymentColors[job.payment_status || "unpaid"] || ""}`}>
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
                <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Auto-flagged Issues
                  </p>
                  {jobFlags.get(detailJob.id)!.map((flag, i) => (
                    <p key={i} className="text-xs text-destructive/80 pl-5">• {flag}</p>
                  ))}
                </div>
              )}

              {/* Removal info */}
              {(detailJob as any).removal_reason && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Removed by Admin
                  </p>
                  <p className="text-sm text-foreground mt-1">{(detailJob as any).removal_reason}</p>
                  {(detailJob as any).removed_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Removed on {new Date((detailJob as any).removed_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {(detailJob.photos || []).length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {(detailJob.photos || []).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-32 h-24 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="capitalize">{categoryLabels[detailJob.category] || detailJob.category}</Badge>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[detailJob.status]}`}>
                  {detailJob.status.replace("_", " ")}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${paymentColors[detailJob.payment_status || "unpaid"]}`}>
                  {detailJob.payment_status || "unpaid"}
                </span>
              </div>

              <p className="text-sm text-foreground">{detailJob.description}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Budget</p>
                  <p className="font-semibold text-foreground">${detailJob.budget}</p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
                  <p className="font-semibold text-foreground">{detailJob.location}</p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Date Needed</p>
                  <p className="font-semibold text-foreground">{new Date(detailJob.date_needed).toLocaleDateString()}</p>
                </div>
                {detailJob.start_time && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Start Time</p>
                    <p className="font-semibold text-foreground">{detailJob.start_time}</p>
                  </div>
                )}
                {detailJob.estimated_hours && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                    <p className="font-semibold text-foreground">{detailJob.estimated_hours}h</p>
                  </div>
                )}
                {detailJob.platform_fee_amount && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Platform Fee</p>
                    <p className="font-semibold text-foreground">${detailJob.platform_fee_amount} ({detailJob.platform_fee_percent}%)</p>
                  </div>
                )}
              </div>

              {detailJob.special_requirements && (
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Special Requirements</p>
                  <p className="text-sm text-foreground">{detailJob.special_requirements}</p>
                </div>
              )}

              {detailJob.revision_note && (
                <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
                  <p className="text-xs text-destructive mb-1">Revision Note</p>
                  <p className="text-sm text-foreground">{detailJob.revision_note}</p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Posted by</span>
                  <span className="font-medium text-foreground">{posterName || "Loading…"}</span>
                </div>
                {detailJob.helper_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Assigned to</span>
                    <span className="font-medium text-foreground">{helperName || "Loading…"}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Created {new Date(detailJob.created_at).toLocaleString()}
                </p>
              </div>

              {/* Admin actions */}
              {!(detailJob as any).removal_reason && (
                <div className="pt-3 border-t border-border">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                    className="gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove Job
                  </Button>
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
            <p className="text-sm text-muted-foreground">
              This will cancel the job and notify the poster{detailJob?.helper_id ? " and assigned helper" : ""}. Please provide a reason:
            </p>
            <Textarea
              placeholder="e.g. This listing violates our community guidelines…"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
            />
            {detailJob && (
              <div className="rounded-lg bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">Job being removed</p>
                <p className="text-sm font-medium text-foreground">{detailJob.title}</p>
                <p className="text-xs text-muted-foreground">${detailJob.budget} · {detailJob.location}</p>
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
    </div>
  );
};

export default AdminJobs;
