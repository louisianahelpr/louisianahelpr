import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DollarSign, Briefcase, Gift, TrendingUp, Zap } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import InstantPayoutDialog from "@/components/InstantPayoutDialog";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const Earnings = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tips, setTips] = useState<{ amount: number; job_id: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [instantAvailable, setInstantAvailable] = useState<number>(0);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);

  const loadBalance = async () => {
    const { data } = await supabase.functions.invoke("stripe-payouts", { body: {} });
    const usd = data?.instant_available?.find((b: any) => b.currency === "usd");
    setInstantAvailable(usd?.amount ?? 0);
  };

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { navigate("/login"); return; }

      const [jobsRes, tipsRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("*")
          .eq("helper_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tips")
          .select("amount, job_id, created_at")
          .eq("helper_id", user.id),
      ]);

      if (jobsRes.data) setJobs(jobsRes.data);
      if (tipsRes.data) setTips(tipsRes.data);
      await loadBalance();
      setLoading(false);
    };
    load();
  }, []);

  const completedJobs = jobs.filter((j) => j.status === "completed");
  const inProgressJobs = jobs.filter((j) => j.status === "in_progress");
  const totalEarnings = completedJobs.reduce(
    (sum, j) => sum + (j.budget - (j.platform_fee_amount || 0) + (j.urgent_fee || 0)),
    0
  );
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="min-h-screen bg-background pb-20">
      <PageHeader title="My Earnings" />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-8">

          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              {/* Instant payout card */}
              {instantAvailable > 0 && (
                <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Instant cash out available</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">${(instantAvailable / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">To your debit card in ~30 min · 3% + $1 fee</p>
                  </div>
                  <Button onClick={() => setPayoutDialogOpen(true)} className="gap-2 shrink-0">
                    <Zap className="w-4 h-4" /> Cash out
                  </Button>
                </div>
              )}

              {/* Summary cards */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Total Earnings</span>
                    <TrendingUp className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{completedJobs.length} completed jobs</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Tips Received</span>
                    <Gift className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">${totalTips.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tips.length} tips</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">In Progress</span>
                    <Briefcase className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{inProgressJobs.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">active jobs</p>
                </div>
              </div>

              {/* Job history */}
              <div>
                <h2 className="text-xl font-display font-semibold text-foreground mb-4">Job History</h2>
                {jobs.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-4">No jobs yet. Start browsing tasks!</p>
                    <Button onClick={() => navigate("/browse-jobs")}>Browse tasks</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobs.map((job) => {
                      const payout = job.status === "completed"
                        ? job.budget - (job.platform_fee_amount || 0) + (job.urgent_fee || 0)
                        : null;
                      const jobTips = tips.filter((t) => t.job_id === job.id);
                      const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);

                      return (
                        <div key={job.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-foreground">{job.title}</h3>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                                    job.status === "completed"
                                      ? "bg-primary/10 text-primary"
                                      : job.status === "in_progress"
                                      ? "bg-accent/20 text-accent-foreground"
                                      : "bg-secondary text-secondary-foreground"
                                  }`}
                                >
                                  {job.status.replace("_", " ")}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {job.location} · {new Date(job.date_needed).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              {payout !== null && (
                                <p className="font-bold text-foreground">${payout.toFixed(2)}</p>
                              )}
                              {tipTotal > 0 && (
                                <p className="text-xs text-primary flex items-center gap-1 justify-end">
                                  <Gift className="w-3 h-3" /> +${tipTotal.toFixed(2)} tip
                                </p>
                              )}
                              {job.status === "in_progress" && (
                                <p className="text-sm text-muted-foreground">${job.budget} budget</p>
                              )}
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
      </main>

      <InstantPayoutDialog
        open={payoutDialogOpen}
        onOpenChange={setPayoutDialogOpen}
        onSuccess={loadBalance}
      />
    </div>
  );
};

export default Earnings;
