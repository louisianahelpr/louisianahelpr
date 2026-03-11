import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Users, CheckCircle2, Gift, XCircle, RotateCcw, Star, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { ReviewForm } from "@/components/ReviewPanel";
import { ScopeAgreement } from "@/components/ScopeAgreement";
import { AddonRequests } from "@/components/AddonRequests";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobMilestones } from "@/components/JobMilestones";
import { JobCheckins } from "@/components/JobCheckins";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Application = Database["public"]["Tables"]["applications"]["Row"] & {
  profiles?: { full_name: string | null; skills: string | null; hourly_rate: number | null } | null;
};

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

const MyJobs = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [tipJobId, setTipJobId] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [tipping, setTipping] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);

  useEffect(() => {
    if (searchParams.get("tip") === "success") {
      toast.success("Tip sent successfully! Your helper will appreciate it.");
    }
    loadJobs();
  }, []);

  const loadJobs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/login"); return; }
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setJobs(data);
    setLoading(false);
  };

  const loadApplications = async (job: Job) => {
    setSelectedJob(job);
    const { data: apps } = await supabase.from("applications").select("*").eq("job_id", job.id);
    if (apps && apps.length > 0) {
      const helperIds = apps.map(a => a.helper_id);
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, skills, hourly_rate").in("user_id", helperIds);
      setApplications(apps.map(app => ({ ...app, profiles: profiles?.find(p => p.user_id === app.helper_id) || null })));
    } else {
      setApplications([]);
    }
  };

  const acceptApplication = async (app: Application) => {
    await supabase.from("applications").update({ status: "accepted" }).eq("id", app.id);
    await supabase.from("jobs").update({ status: "in_progress", helper_id: app.helper_id }).eq("id", selectedJob!.id);
    await supabase.from("applications").update({ status: "rejected" }).eq("job_id", selectedJob!.id).neq("id", app.id);
    toast.success("Helper accepted! Task is now in progress.");
    loadJobs();
    setSelectedJob(null);
    setApplications([]);
  };

  const cancelJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "cancelled" }).eq("id", jobId);
    if (error) toast.error("Failed to cancel job");
    else { toast.success("Job cancelled"); loadJobs(); }
  };

  const repostJob = async (jobId: string) => {
    const { error } = await supabase.from("jobs").update({ status: "open", helper_id: null }).eq("id", jobId);
    if (error) toast.error("Failed to repost job");
    else { toast.success("Job reposted!"); loadJobs(); }
  };

  const completeJob = async (jobId: string) => {
    setCompletingJobId(jobId);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Job completed! Helper receives $${data.helperPayout.toFixed(2)} (platform fee: $${data.platformFee.toFixed(2)})`);
      loadJobs();
    } catch (err: any) {
      toast.error(err.message || "Failed to complete job");
    } finally {
      setCompletingJobId(null);
    }
  };

  const sendTip = async (jobId: string) => {
    const amount = parseFloat(tipAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Please enter a valid tip amount"); return; }
    setTipping(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "tip", jobId, amount } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to create tip");
    } finally {
      setTipping(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          <h1 className="text-3xl font-display font-bold text-foreground">My posted tasks</h1>

          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : jobs.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-4">You haven't posted any tasks yet.</p>
              <Button onClick={() => navigate("/post-job")}>Post your first task</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                          {job.status.replace("_", " ")}
                        </span>
                        {job.payment_status === "released" && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Paid</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">${job.budget} · {job.location}</p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {job.status === "open" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => loadApplications(job)}>
                            <Users className="w-4 h-4 mr-1" /> Applicants
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => cancelJob(job.id)}>
                            <XCircle className="w-4 h-4 mr-1" /> Cancel
                          </Button>
                        </>
                      )}
                      {job.status === "in_progress" && (
                        <>
                          <Button size="sm" onClick={() => completeJob(job.id)} disabled={completingJobId === job.id}>
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            {completingJobId === job.id ? "Completing…" : "Complete"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/messages`)}>
                            <MessageSquare className="w-4 h-4 mr-1" /> Message
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => cancelJob(job.id)}>
                            <XCircle className="w-4 h-4 mr-1" /> Cancel
                          </Button>
                        </>
                      )}
                      {job.status === "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => repostJob(job.id)}>
                          <RotateCcw className="w-4 h-4 mr-1" /> Repost
                        </Button>
                      )}
                      {job.status === "completed" && job.helper_id && (
                        <Button size="sm" variant="outline" onClick={() => setReviewJob(job)}>
                          <Star className="w-4 h-4 mr-1" /> Review
                        </Button>
                      )}
                    </div>
                  </div>

                  {job.status === "completed" && job.payment_status === "released" && (
                    <div className="border-t border-border pt-3">
                      {tipJobId === job.id ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm text-muted-foreground">Tip ($):</span>
                          <Input type="number" min="1" step="1" placeholder="5" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} className="max-w-[100px]" />
                          <Button size="sm" onClick={() => sendTip(job.id)} disabled={tipping}>{tipping ? "Processing…" : "Send"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setTipJobId(null); setTipAmount(""); }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setTipJobId(job.id); setTipAmount(""); }}>
                          <Gift className="w-4 h-4 mr-1" /> Tip helper
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedJob && (
            <div className="border border-border rounded-xl bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-foreground">Applicants for "{selectedJob.title}"</h2>
                <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}>Close</Button>
              </div>
              {applications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No applications yet.</p>
              ) : (
                <div className="space-y-3">
                  {applications.map((app) => (
                    <div key={app.id} className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div>
                        <p className="font-medium text-foreground">{app.profiles?.full_name || "Helper"}</p>
                        {app.profiles?.skills && <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>}
                        {app.proposed_rate && <p className="text-xs text-muted-foreground">Proposed: ${app.proposed_rate}/hr</p>}
                        {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
                      </div>
                      {app.status === "pending" && <Button size="sm" onClick={() => acceptApplication(app)}>Accept</Button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {reviewJob && reviewJob.helper_id && (
        <ReviewForm
          open={!!reviewJob}
          onClose={() => { setReviewJob(null); }}
          jobId={reviewJob.id}
          revieweeId={reviewJob.helper_id}
          revieweeName="Helper"
        />
      )}
    </div>
  );
};

export default MyJobs;
