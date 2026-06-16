import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Users, XCircle } from "lucide-react";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

interface PartnerApplication {
  id: string;
  business_name: string;
  contact_name: string;
  contact_email: string;
  service_category: string | null;
  team_size: number | null;
  status: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-accent/15 text-accent" },
  approved: { label: "Approved", classes: "bg-primary/10 text-primary" },
  rejected: { label: "Rejected", classes: "bg-destructive/10 text-destructive" },
};

const AdminPartnerApplications = () => {
  const queryKey = ["admin-partner-applications"];
  const [busy, setBusy] = useState<string | null>(null);

  // unwrap() throws into React Query so a failed select flips isError on
  // (and surfaces a recoverable retry) instead of silently degrading to
  // "no applications". See CLAUDE.md "Never drop the Supabase `error`".
  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<PartnerApplication[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () =>
      (unwrap(
        await (supabase as any)
          .from("partner_applications")
          .select("id, business_name, contact_name, contact_email, service_category, team_size, status, created_at")
          .order("created_at", { ascending: false }),
      ) ?? []) as PartnerApplication[],
  });

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    setBusy(id);
    const { error } = await (supabase as any)
      .from("partner_applications")
      .update({ status })
      .eq("id", id);
    setBusy(null);
    if (error) {
      report(error, { tags: { source: "AdminPartnerApplications.updateStatus", status } });
      toast.error(error.message);
      return;
    }
    toast.success(status === "approved" ? "Application approved" : "Application rejected");
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-ds-20 font-display font-bold text-foreground">
            Partner applications
          </h2>
          <p className="text-ds-11 text-muted-foreground">
            Review and approve or reject incoming partnership requests.
          </p>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl liquid-glass p-4 flex items-start gap-3">
              <Skeleton className="w-10 h-10 rounded-ds-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load partner applications."
          body="Tap Try again. Submissions are safe — they're queued server-side."
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Users}
          eyebrow="No applications"
          title="No partner applications yet."
          body="Incoming partnership requests will land here for review."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const statusMeta = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
            const isBusy = busy === r.id;
            return (
              <div key={r.id} className="rounded-2xl liquid-glass p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-ds-md bg-secondary/60 text-muted-foreground flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-ds-13 text-foreground truncate">
                        {r.business_name}
                      </p>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${statusMeta.classes}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                    <p className="text-ds-11 text-muted-foreground truncate">
                      {r.contact_name} · {r.contact_email}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap pt-0.5">
                      {r.service_category && (
                        <span className="text-ds-11 text-muted-foreground">
                          Category: <span className="text-foreground font-medium">{r.service_category}</span>
                        </span>
                      )}
                      {r.team_size != null && (
                        <span className="text-ds-11 text-muted-foreground">
                          Team: <span className="text-foreground font-medium">{r.team_size}</span>
                        </span>
                      )}
                      <span className="text-ds-11 text-muted-foreground ml-auto shrink-0">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {r.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={isBusy}
                      onClick={() => updateStatus(r.id, "approved")}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={isBusy}
                      onClick={() => updateStatus(r.id, "rejected")}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminPartnerApplications;
