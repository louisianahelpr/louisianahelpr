import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface DisputedJob {
  id: string;
  title: string;
  budget: number;
  status: string;
  dispute_reason: string | null;
  dispute_evidence_urls: string[];
  disputed_at: string | null;
  disputed_by: string | null;
  customer_id: string;
  helper_id: string | null;
  stripe_payment_intent_id: string | null;
}

const AdminDisputes = () => {
  const [disputes, setDisputes] = useState<DisputedJob[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  useEffect(() => {
    loadDisputes();
  }, []);

  const loadDisputes = async () => {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, budget, status, customer_id, helper_id, stripe_payment_intent_id, dispute_reason, dispute_evidence_urls, disputed_at, disputed_by")
      .eq("status", "disputed" as any)
      .order("disputed_at" as any, { ascending: false });

    const jobs = (data || []) as unknown as DisputedJob[];

    // Load profile names and subscription tiers for priority sorting
    const userIds = [...new Set(jobs.flatMap(j => [j.customer_id, j.helper_id, j.disputed_by].filter(Boolean) as string[]))];
    const tierMap: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, subscription_tier").in("user_id", userIds);
      const map: Record<string, string> = {};
      const tMap: Record<string, string | null> = {};
      profs?.forEach(p => {
        map[p.user_id] = formatName(p.full_name);
        tMap[p.user_id] = p.subscription_tier;
      });
      setProfiles(map);
      setTiers(tMap);
      });
      setProfiles(map);
    }

    // Priority Dispute Resolution: Elite subscribers' disputes appear first
    const tierPriority = (uid: string | null) => {
      if (!uid) return 0;
      const t = tMap[uid];
      return t === "elite" ? 3 : t === "pro" ? 2 : t === "basic" ? 1 : 0;
    };
    const sorted = jobs.sort((a, b) => {
      const aMax = Math.max(tierOrder(a.customer_id), tierOrder(a.helper_id));
      const bMax = Math.max(tierOrder(b.customer_id), tierOrder(b.helper_id));
      return bMax - aMax;
    });

    setDisputes(sorted);
    setLoading(false);
  };

  const resolveDispute = async (job: DisputedJob, action: "release" | "refund") => {
    setResolving(job.id);
    try {
      if (action === "release") {
        // Release payment to helpr — invoke create-payment with release action
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_release_dispute", jobId: job.id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Payment released to helpr. Dispute resolved.");
      } else {
        // Refund to customer — cancel the payment intent
        const { data, error } = await supabase.functions.invoke("create-payment", {
          body: { action: "admin_refund_dispute", jobId: job.id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Payment refunded to customer. Dispute resolved.");
      }
      loadDisputes();
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve dispute");
    } finally {
      setResolving(null);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading disputes…</p>;

  if (disputes.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3 opacity-50" />
        <p className="text-muted-foreground">No active disputes</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      
      {disputes.map((job) => (
        <div key={job.id} className="rounded-xl border border-destructive/30 bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{job.title}</h3>
                {(() => {
                  const participants = [job.customer_id, job.helper_id].filter(Boolean) as string[];
                  const hasElite = participants.some(id => {
                    const { data: prof } = { data: null }; // already loaded
                    return false; // We use inline check below
                  });
                  return null;
                })()}
              </div>
              <p className="text-sm text-muted-foreground">${job.budget}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Customer: <span className="font-medium text-foreground">{profiles[job.customer_id] || "Unknown"}</span>
                {job.helper_id && <> · Helpr: <span className="font-medium text-foreground">{profiles[job.helper_id] || "Unknown"}</span></>}
              </p>
              {job.disputed_at && (
                <p className="text-xs text-muted-foreground">
                  Disputed {new Date(job.disputed_at).toLocaleDateString()} by {profiles[job.disputed_by || ""] || "Unknown"}
                </p>
              )}
            </div>
          </div>

          {job.dispute_reason && (
            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
              <p className="text-sm text-foreground font-medium">Reason:</p>
              <p className="text-sm text-muted-foreground">{job.dispute_reason}</p>
            </div>
          )}

          {job.dispute_evidence_urls && job.dispute_evidence_urls.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Evidence photos:</p>
              <div className="flex gap-2 flex-wrap">
                {job.dispute_evidence_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-border hover:border-primary transition-colors">
                    <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-border">
            <Button size="sm" onClick={() => resolveDispute(job, "release")} disabled={resolving === job.id}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Release to Helpr
            </Button>
            <Button size="sm" variant="destructive" onClick={() => resolveDispute(job, "refund")} disabled={resolving === job.id}>
              <XCircle className="w-4 h-4 mr-1" /> Refund Customer
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AdminDisputes;
