import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Calendar, Clock, DollarSign, ImageIcon, User } from "lucide-react";
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

const AdminJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [posterName, setPosterName] = useState("");
  const [helperName, setHelperName] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setJobs(data);
      setLoading(false);
    };
    load();
  }, []);

  const openJob = async (job: Job) => {
    setDetailJob(job);
    setPosterName("");
    setHelperName("");
    const ids = [job.customer_id, job.helper_id].filter(Boolean) as string[];
    if (ids.length > 0) {
      const { data } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
      if (data) {
        const map = new Map(data.map((p) => [p.user_id, p.full_name || "User"]));
        setPosterName(map.get(job.customer_id) || "Unknown");
        if (job.helper_id) setHelperName(map.get(job.helper_id) || "Unknown");
      }
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  const photos = detailJob?.photos || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold text-foreground">Jobs</h2>
        <span className="text-sm text-muted-foreground">{jobs.length} total</span>
      </div>

      {/* Mobile-friendly card list */}
      <div className="space-y-3">
        {jobs.map((job) => (
          <div
            key={job.id}
            onClick={() => openJob(job)}
            className="rounded-xl border border-border bg-card p-4 cursor-pointer hover:bg-secondary/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-foreground truncate">{job.title}</p>
                  <Badge variant="secondary" className="text-xs capitalize">{categoryLabels[job.category] || job.category}</Badge>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                  <span className="font-medium text-foreground">${job.budget}</span>
                </div>
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
        ))}
      </div>

      {/* Job Detail Dialog */}
      <Dialog open={!!detailJob} onOpenChange={() => setDetailJob(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{detailJob?.title}</DialogTitle>
          </DialogHeader>
          {detailJob && (
            <div className="space-y-4">
              {photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {photos.map((url, i) => (
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminJobs;
