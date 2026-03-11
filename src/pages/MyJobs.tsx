import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users } from "lucide-react";
import { toast } from "sonner";
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/login");
      return;
    }
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
    // Fetch applications separately, then fetch profiles
    const { data: apps } = await supabase
      .from("applications")
      .select("*")
      .eq("job_id", job.id);

    if (apps && apps.length > 0) {
      // Fetch profiles for each helper
      const helperIds = apps.map(a => a.helper_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, skills, hourly_rate")
        .in("user_id", helperIds);

      const enriched = apps.map(app => ({
        ...app,
        profiles: profiles?.find(p => p.user_id === app.helper_id) || null,
      }));
      setApplications(enriched);
    } else {
      setApplications([]);
    }
  };

  const acceptApplication = async (app: Application) => {
    // Update application status
    await supabase.from("applications").update({ status: "accepted" }).eq("id", app.id);
    // Update job status and assign helper
    await supabase.from("jobs").update({ status: "accepted", helper_id: app.helper_id }).eq("id", selectedJob!.id);
    // Reject other applications
    await supabase
      .from("applications")
      .update({ status: "rejected" })
      .eq("job_id", selectedJob!.id)
      .neq("id", app.id);

    toast.success("Helper accepted! Redirecting to payment…");

    // Create Stripe checkout for this job
    const { data, error } = await supabase.functions.invoke("create-payment", {
      body: { jobId: selectedJob!.id },
    });

    if (error || !data?.url) {
      toast.error("Payment setup failed. You can pay later from your dashboard.");
    } else {
      window.open(data.url, "_blank");
    }

    loadJobs();
    setSelectedJob(null);
    setApplications([]);
  };

  return (
    <div className="min-h-screen bg-background">
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
                <div key={job.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                          {job.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">${job.budget} · {job.location}</p>
                    </div>
                    {job.status === "open" && (
                      <Button size="sm" variant="outline" onClick={() => loadApplications(job)}>
                        <Users className="w-4 h-4 mr-1" /> View applicants
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Applicants modal-like section */}
          {selectedJob && (
            <div className="border border-border rounded-xl bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-foreground">
                  Applicants for "{selectedJob.title}"
                </h2>
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
                        {app.profiles?.skills && (
                          <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>
                        )}
                        {app.proposed_rate && (
                          <p className="text-xs text-muted-foreground">Proposed: ${app.proposed_rate}/hr</p>
                        )}
                        {app.message && <p className="text-sm text-muted-foreground mt-1">{app.message}</p>}
                      </div>
                      {app.status === "pending" && (
                        <Button size="sm" onClick={() => acceptApplication(app)}>Accept</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default MyJobs;
