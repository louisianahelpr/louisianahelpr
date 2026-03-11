import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

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

  if (loading) return <p className="text-muted-foreground">Loading jobs…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold text-foreground">Jobs</h2>
        <span className="text-sm text-muted-foreground">{jobs.length} total</span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-secondary/50 text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Budget</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Payment</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Fee</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground truncate max-w-[200px]">{job.title}</p>
                  <p className="text-xs text-muted-foreground">{job.location}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground capitalize">{job.category.replace("_", " ")}</td>
                <td className="px-4 py-3 font-medium text-foreground">${job.budget}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>
                    {job.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${paymentColors[job.payment_status || "unpaid"] || ""}`}>
                    {job.payment_status || "unpaid"}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {job.platform_fee_amount ? `$${job.platform_fee_amount}` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(job.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminJobs;
