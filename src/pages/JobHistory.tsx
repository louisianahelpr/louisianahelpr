import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, DollarSign, Calendar, Filter } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Application = Database["public"]["Tables"]["applications"]["Row"];

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

type HistoryTab = "all" | "posted" | "worked";
type StatusFilter = "all" | "open" | "in_progress" | "completed" | "cancelled";

const JobHistory = () => {
  const navigate = useNavigate();
  const [postedJobs, setPostedJobs] = useState<Job[]>([]);
  const [workedJobs, setWorkedJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<HistoryTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { navigate("/login"); return; }

      const [posted, worked] = await Promise.all([
        supabase.from("jobs").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }),
        supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
      ]);

      if (posted.data) setPostedJobs(posted.data);
      if (worked.data) setWorkedJobs(worked.data);
      setLoading(false);
    };
    load();
  }, []);

  const getJobs = () => {
    let jobs: (Job & { _source: "posted" | "worked" })[] = [];
    if (tab === "all" || tab === "posted") {
      jobs = [...jobs, ...postedJobs.map((j) => ({ ...j, _source: "posted" as const }))];
    }
    if (tab === "all" || tab === "worked") {
      jobs = [...jobs, ...workedJobs.map((j) => ({ ...j, _source: "worked" as const }))];
    }
    // Deduplicate
    const seen = new Set<string>();
    jobs = jobs.filter((j) => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
    if (statusFilter !== "all") {
      jobs = jobs.filter((j) => j.status === statusFilter);
    }
    return jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  const jobs = getJobs();

  const tabs: { key: HistoryTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "posted", label: "Posted" },
    { key: "worked", label: "Worked" },
  ];

  const statuses: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-2xl font-display font-bold text-foreground">Job History</h1>

          {/* Tabs */}
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
              </button>
            ))}
          </div>

          {/* Status filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No jobs found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
              {jobs.map((job) => (
                <div key={`${job.id}-${job._source}`} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-foreground">{job.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                          {job.status.replace("_", " ")}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
                          {job._source === "posted" ? "Posted" : "Worked"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{job.description}</p>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(job.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default JobHistory;
