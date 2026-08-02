// Approvals tab — list of pending_approval jobs for this business.
//
// Approver / admin / owner can approve or reject. Approve calls the
// `approve_pending_job` RPC (flips status → open); reject calls
// `reject_pending_job` with an optional reason. Both RPCs ship in the
// 20260609170000 migration and have PGRST202 fallbacks here so the tab
// degrades to "rolling out" before the manual db push.

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Check, X, Loader2, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface PendingJob {
  id: string;
  title: string;
  description: string | null;
  budget: number;
  department: string | null;
  customer_id: string;
  created_at: string;
  customer_name?: string | null;
}

interface ApprovalsTabProps {
  businessId: string;
  canApprove: boolean;
}

export function ApprovalsTab({ businessId, canApprove }: ApprovalsTabProps) {
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);
  // Reject flow: target the job being rejected + the optional reason
  // typed into the brand dialog (empty is allowed — reason is optional).
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["business-pending-approvals", businessId],
    queryFn: async (): Promise<PendingJob[]> => {
      // Status filter handles the case where the new pending_approval
      // enum value doesn't exist yet (migration unapplied on prod).
      const { data: rows, error } = await supabase
        .from("jobs")
        .select("id, title, description, budget, department, customer_id, created_at" as any)
        .eq("business_id", businessId)
        .eq("status", "pending_approval" as any)
        .order("created_at", { ascending: false });

      if (error) {
        // 22P02 = invalid enum value (pending_approval doesn't exist
        // yet); 42703 = column missing. Either way, treat as empty.
        const code = (error as { code?: string }).code;
        if (code === "22P02" || code === "42703" || code === "PGRST204") return [];
        // Surface unexpected failures to the error logger before
        // re-throwing into React Query — without this the error path
        // would flip the query to its error state but never get
        // recorded for follow-up triage.
        report(error, {
          tags: { source: "ApprovalsTab.fetchPending" },
          context: { businessId, code: code ?? null },
        });
        throw error;
      }
      const list = ((rows as unknown) as PendingJob[] | null) ?? [];

      // Attach customer names so the row reads like a sentence.
      const ids = Array.from(new Set(list.map((j) => j.customer_id)));
      if (ids.length === 0) return list;
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      const map = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return list.map((j) => ({ ...j, customer_name: map.get(j.customer_id) ?? null }));
    },
    enabled: !!businessId,
    // Hold prior approvals during a background refetch (after
    // approving/rejecting we invalidate) so the list doesn't collapse
    // to a skeleton mid-review.
    placeholderData: keepPreviousData,
  });

  const approve = async (jobId: string) => {
    setActing(jobId);
    const { error } = await supabase.rpc("approve_pending_job" as any, { p_job_id: jobId } as any);
    setActing(null);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST202") {
        setRpcMissing(true);
        toast.error("Approval API isn't live yet — try again in a few minutes.");
        return;
      }
      hapticError();
      toast.error(error.message || "Couldn't approve — try again.");
      return;
    }
    hapticSuccess();
    toast.success("Post approved — it's live now.");
    queryClient.invalidateQueries({ queryKey: ["business-pending-approvals", businessId] });
  };

  const reject = async (jobId: string, reason: string) => {
    // Preserve the optional semantics: an empty box sends null, just
    // like the old window.prompt cancel/blank path.
    const trimmed = reason.trim();
    setActing(jobId);
    const { error } = await supabase.rpc("reject_pending_job" as any, {
      p_job_id: jobId,
      p_reason: trimmed.length > 0 ? trimmed : null,
    } as any);
    setActing(null);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST202") {
        setRpcMissing(true);
        toast.error("Approval API isn't live yet — try again in a few minutes.");
        return;
      }
      hapticError();
      toast.error(error.message || "Couldn't reject — try again.");
      return;
    }
    toast.success("Post rejected.");
    queryClient.invalidateQueries({ queryKey: ["business-pending-approvals", businessId] });
  };

  if (!canApprove) {
    return (
      <Card className="p-5">
        <p className="font-medium">Approver access required</p>
        <p className="text-ds-11 text-muted-foreground mt-1">
          Only owners, admins, and approvers can review pending posts.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    // Content-shaped skeleton: a couple of pending-job rows matching
    // the eventual Card layout (title + meta line + badge + amount,
    // with two action buttons). Replaces a bare centered spinner.
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Card key={i} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3.5 w-full" />
              </div>
              <Skeleton className="h-6 w-14 shrink-0" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (rpcMissing) {
    return (
      <Card className="p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <div>
          <p className="font-medium">Approvals rolling out</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            The approval workflow finishes deploying shortly.
          </p>
        </div>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyStateIllustration variant="posts" />
        <p className="font-display italic font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
          Nothing pending.
        </p>
        <p className="text-ds-13 text-muted-foreground mt-1.5 max-w-sm mx-auto">
          When a teammate posts a job above your approval threshold, it'll show up here for review.
        </p>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-3">
      {data.map((j) => (
        <Card key={j.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{j.title}</p>
              <p className="text-ds-11 text-muted-foreground">
                {j.customer_name || "A teammate"} · {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
              </p>
              {j.department && (
                <Badge variant="sienna" className="text-ds-10 mt-1.5">
                  {j.department}
                </Badge>
              )}
              {j.description && (
                <p className="text-ds-13 mt-2 line-clamp-2">{j.description}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="font-display text-ds-17">${Number(j.budget).toFixed(0)}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setRejectReason(""); setRejectTarget(j.id); }}
              disabled={acting === j.id}
            >
              {acting === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (<><X className="w-3.5 h-3.5 mr-1" /> Reject</>)}
            </Button>
            <Button
              size="sm"
              onClick={() => approve(j.id)}
              disabled={acting === j.id}
            >
              {acting === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (<><Check className="w-3.5 h-3.5 mr-1" /> Approve</>)}
            </Button>
          </div>
        </Card>
      ))}
    </div>

      <BrandConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) setRejectTarget(null); }}
        title="Reject this post?"
        description="The poster is notified it won't go live. You can add a short reason — it's optional and shown to them."
        primaryLabel="Reject post"
        primaryTone="sienna"
        primaryHaptic="error"
        primaryDisabled={!!acting}
        onPrimary={(e) => {
          e.preventDefault();
          if (!rejectTarget) return;
          const jobId = rejectTarget;
          const reason = rejectReason;
          setRejectTarget(null);
          void reject(jobId, reason);
        }}
        secondaryLabel="Cancel"
      >
        <div className="space-y-1.5">
          <Textarea
            aria-label="Rejection reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (optional, shown to the poster)…"
            rows={3}
          />
        </div>
      </BrandConfirmDialog>
    </>
  );
}

export default ApprovalsTab;
