import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DollarSign, TrendingUp, Gift, Briefcase, MapPin } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

interface EarningsTabProps {
  earningsJobs: Job[];
  tips: { amount: number; job_id: string; created_at: string }[];
  loading: boolean;
  onBack: () => void;
}

export function EarningsTab({ earningsJobs, tips, loading, onBack }: EarningsTabProps) {
  const navigate = useNavigate();
  const completedJobs = earningsJobs.filter((j) => j.status === "completed");
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.budget - (j.platform_fee_amount || 0) + (j.urgent_fee || 0)), 0);
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">My Earnings</h1>
      </div>
      {loading ? (
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
                  const payout = job.status === "completed" ? job.budget - (job.platform_fee_amount || 0) + (job.urgent_fee || 0) : null;
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
  );
}
