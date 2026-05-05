import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ShieldCheck, FileText, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
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

interface PendingRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  is_licensed: boolean;
  is_insured: boolean;
  submitted_at: string;
}

const AdminCredentialQueue = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-credential-queue"];
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ userId: string; credential: "license" | "insurance" } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: rows, isInitialLoading } = useInstantQuery<PendingRow[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase.rpc("get_pending_credentials");
      if (error) {
        toast.error(error.message);
        return [];
      }
      return (data as PendingRow[]) || [];
    },
  });

  const decide = async (
    userId: string,
    credential: "license" | "insurance",
    decision: "verified" | "rejected",
    reason?: string
  ) => {
    setBusy(`${userId}:${credential}`);
    const { error } = await supabase.rpc("review_credential", {
      _user_id: userId,
      _credential: credential,
      _decision: decision,
      _reason: reason ?? undefined,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(decision === "verified" ? "Approved" : "Rejected");
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
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Credential verification queue</h2>
          <p className="text-xs text-muted-foreground">
            Review uploaded license and insurance documents. Approving turns the badge live on the user's profile.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl liquid-glass p-10 text-center text-xs text-muted-foreground">
          No pending credentials. 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.user_id} className="rounded-2xl liquid-glass p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center overflow-hidden text-sm font-bold">
                  {r.avatar_url ? (
                    <img src={r.avatar_url} alt={r.full_name || ""} className="w-full h-full object-cover" />
                  ) : (
                    (r.full_name || r.email || "?").slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{r.full_name || "Unnamed"}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                </div>
                <p className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(r.submitted_at).toLocaleDateString()}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {/* License */}
                {r.license_status === "pending" && r.license_url && (
                  <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">License</p>
                      <SignedOpenLink path={r.license_url} />
                    </div>
                    <DocPreview path={r.license_url} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === `${r.user_id}:license`}
                        onClick={() => decide(r.user_id, "license", "verified")}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={busy === `${r.user_id}:license`}
                        onClick={() => {
                          setRejectTarget({ userId: r.user_id, credential: "license" });
                          setRejectReason("");
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Insurance */}
                {r.insurance_status === "pending" && r.insurance_url && (
                  <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Insurance</p>
                      <SignedOpenLink path={r.insurance_url} />
                    </div>
                    <DocPreview path={r.insurance_url} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === `${r.user_id}:insurance`}
                        onClick={() => decide(r.user_id, "insurance", "verified")}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={busy === `${r.user_id}:insurance`}
                        onClick={() => {
                          setRejectTarget({ userId: r.user_id, credential: "insurance" });
                          setRejectReason("");
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject credential</AlertDialogTitle>
            <AlertDialogDescription>
              The user will be notified and can re-upload. Add a short reason so they know what to fix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="e.g. Document is blurry, please re-upload a clearer photo"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectTarget) {
                  decide(rejectTarget.userId, rejectTarget.credential, "rejected", rejectReason.trim() || undefined);
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

// Resolve a 5-minute signed URL on demand and open in a new tab.
// user-documents bucket is private as of 2026-05-05 — admins authorize
// via has_role('admin') in the bucket SELECT policy.
function SignedOpenLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300);
    setBusy(false);
    if (error || !data) {
      toast.error("Couldn't generate a view link");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <>Open <ExternalLink className="w-3 h-3" /></>}
    </button>
  );
}

// Inline preview — fetches a 5-minute signed URL when the row mounts so
// the admin sees the document immediately. Path is the storage path
// within user-documents (private bucket).
function DocPreview({ path }: { path: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setSignedUrl(null);
    supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setError(true);
        else setSignedUrl(data.signedUrl);
      });
    return () => { cancelled = true; };
  }, [path]);

  const isPdf = /\.pdf(\?|$)/i.test(path);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
        <FileText className="w-4 h-4" /> Couldn't load preview — open via the link above.
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
        <FileText className="w-4 h-4" /> PDF document — open to review
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-background/60 p-6 text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={signedUrl}
        alt="Credential document"
        className="w-full max-h-48 object-contain rounded-lg bg-background/60"
      />
    </a>
  );
}

export default AdminCredentialQueue;
