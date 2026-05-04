import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";

interface PendingBusiness {
  business_id: string;
  business_name: string;
  owner_id: string;
  owner_name: string | null;
  owner_email: string | null;
  document_url: string | null;
  document_type: "license" | "ein_letter" | "insurance" | null;
  submitted_at: string;
}

const docLabels: Record<string, string> = {
  license: "Business license",
  ein_letter: "EIN assignment letter",
  insurance: "Business insurance",
};

const AdminBusinessVerificationQueue = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-business-verification-queue"];
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: rows, isInitialLoading } = useInstantQuery<PendingBusiness[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase.rpc("get_pending_business_verifications");
      if (error) {
        toast.error(error.message);
        return [];
      }
      return (data as PendingBusiness[]) || [];
    },
  });

  const decide = async (
    businessId: string,
    decision: "verified" | "rejected",
    reason?: string
  ) => {
    setBusy(businessId);
    const { error } = await supabase.rpc("review_business_verification", {
      _business_id: businessId,
      _decision: decision,
      _rejection_reason: reason ?? undefined,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(decision === "verified" ? "Business verified" : "Rejected");
    qc.invalidateQueries({ queryKey });
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">
            Business verification queue
          </h2>
          <p className="text-xs text-muted-foreground">
            Approve to grant the Verified Business badge to the owner and every active team member.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl liquid-glass p-10 text-center text-xs text-muted-foreground">
          No pending business verifications. 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.business_id} className="rounded-2xl liquid-glass p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {r.business_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Owner: {r.owner_name || "Unnamed"} · {r.owner_email}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(r.submitted_at).toLocaleDateString()}
                </p>
              </div>

              {r.document_url && (
                <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {r.document_type ? docLabels[r.document_type] : "Document"}
                    </p>
                    <a
                      href={r.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <DocPreview url={r.document_url} />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === r.business_id}
                      onClick={() => decide(r.business_id, "verified")}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={busy === r.business_id}
                      onClick={() => {
                        setRejectTarget(r.business_id);
                        setRejectReason("");
                      }}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject business verification</AlertDialogTitle>
            <AlertDialogDescription>
              The owner will be notified and can re-upload. Add a short reason so they know what to fix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="e.g. Document is illegible, please upload a clearer scan"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectTarget) {
                  decide(rejectTarget, "rejected", rejectReason.trim() || undefined);
                  setRejectTarget(null);
                }
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function DocPreview({ url }: { url: string }) {
  const isPdf = /\.pdf(\?|$)/i.test(url);
  if (isPdf) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
        <FileText className="w-4 h-4" /> PDF document — open to review
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={url}
        alt="Business verification document"
        className="w-full max-h-48 object-contain rounded-lg bg-background/60"
      />
    </a>
  );
}

export default AdminBusinessVerificationQueue;
