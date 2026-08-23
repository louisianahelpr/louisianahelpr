import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { formatShortDate } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import SectionBoundary from "@/components/SectionBoundary";
import { toneBadgeClasses, toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import { report } from "@/lib/errorLogger";

// Maps DB exception_type values to human-readable labels
const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  name_mismatch: "Name mismatch",
  board_no_api: "Board has no API",
  adverse_action: "Adverse action",
  document_unclear: "Document unclear",
  other: "Other",
};

interface ExceptionRow {
  id: string;
  check_id: string | null;
  credential_id: string | null;
  user_id: string;
  exception_type: string;
  notes: string | null;
  assigned_to: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  // joined from profiles
  full_name?: string | null;
  email?: string | null;
  credential_type?: string | null;
}

const ExceptionQueueInner = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-exception-queue"];
  const [busy, setBusy] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ExceptionRow | null>(null);
  const [resolution, setResolution] = useState("");

  const { data: rows, isInitialLoading } = useInstantQuery<ExceptionRow[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => {
      // NOTE: `user_id` has NO foreign key to profiles (only check_id and
      // credential_id are FKs — see types.ts verification_exceptions
      // Relationships), so a `profiles:user_id(...)` embed errors with PGRST200
      // and — because the guard below only caught PGRST202 — silently blanked
      // the whole compliance queue to "No open exceptions". Fetch flat and
      // hydrate the poster names in a second query. The credential_id embed is
      // a real FK, so it stays.
      const { data, error } = await supabase
        .from("verification_exceptions")
        .select(`
          id, check_id, credential_id, user_id, exception_type,
          notes, assigned_to, status, resolution, created_at, resolved_at,
          helper_credentials:credential_id ( credential_type )
        `)
        .eq("status", "open")
        .order("created_at", { ascending: true });

      if (error) {
        // PGRST202 = function/table not found — migration not yet deployed
        if ((error as any).code === "PGRST202" || error.message?.includes("does not exist")) {
          return [];
        }
        toast.error(error.message);
        return [];
      }

      const baseRows = (data ?? []) as any[];

      // Hydrate poster names/emails via an explicit profiles lookup keyed on
      // user_id, since there's no FK to piggyback an embed on.
      const userIds = [...new Set(baseRows.map((r) => r.user_id).filter(Boolean))];
      const nameById = new Map<string, { full_name: string | null; email: string | null }>();
      if (userIds.length > 0) {
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
        const { data: profs, error: profsError } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
      if (profsError) report(profsError, { severity: "warning", tags: { source: "AdminExceptionQueue.hydrateNames" } });
        (profs ?? []).forEach((p: any) =>
          nameById.set(p.user_id, { full_name: p.full_name ?? null, email: p.email ?? null }),
        );
      }

      return baseRows.map((r) => ({
        ...r,
        full_name: nameById.get(r.user_id)?.full_name ?? null,
        email: nameById.get(r.user_id)?.email ?? null,
        credential_type: r.helper_credentials?.credential_type ?? null,
      }));
    },
  });

  const resolve = async (row: ExceptionRow, res: string) => {
    setBusy(row.id);
    const { error } = await supabase
      .from("verification_exceptions")
      .update({
        status: "resolved",
        resolution: res.trim() || null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Exception resolved");
    qc.invalidateQueries({ queryKey });
    setResolveTarget(null);
    setResolution("");
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <HelprSpinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <p className="text-ds-11 text-muted-foreground">
          Verification cases flagged for manual review — adverse actions, name mismatches, boards with no API.
        </p>
        {rows.length > 0 && (
          <span className={cn("inline-flex items-center justify-center rounded-full text-ds-10 font-bold px-2 py-0.5 min-w-[1.4rem]", toneBadgeClasses.warning)}>
            {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl liquid-glass p-10 text-center text-ds-11 text-muted-foreground">
          No open exceptions.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl liquid-glass p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className={cn("w-10 h-10 shrink-0 rounded-full bg-warning/10 flex items-center justify-center text-ds-13 font-bold", toneTextClasses.warning)}>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-ds-13 text-foreground truncate">
                      {r.full_name || "Unnamed user"}
                    </p>
                    <span className={cn("inline-flex items-center rounded-full text-ds-10 font-semibold px-2 py-0.5", toneBadgeClasses.warning)}>
                      {EXCEPTION_TYPE_LABELS[r.exception_type] ?? r.exception_type}
                    </span>
                    {r.credential_type && (
                      <span className="text-ds-10 text-muted-foreground border border-border rounded-full px-2 py-0.5">
                        {r.credential_type}
                      </span>
                    )}
                  </div>
                  <p className="text-ds-11 text-muted-foreground truncate">{r.email}</p>
                  {r.notes && (
                    <p className="text-ds-11 text-muted-foreground mt-1 line-clamp-2">{r.notes}</p>
                  )}
                </div>
                <p className="text-ds-11 text-muted-foreground shrink-0">
                  {formatShortDate(r.created_at)}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={busy === r.id}
                  onClick={() => {
                    setResolveTarget(r);
                    setResolution("");
                  }}
                >
                  {busy === r.id ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                  )}
                  Resolve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHero
            title="Resolve Exception"
          />
          <Textarea
            aria-label="Resolution note"
            placeholder="e.g. Manually verified license via state portal — credential approved"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resolveTarget) resolve(resolveTarget, resolution);
              }}
            >
              Mark Resolved
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const AdminExceptionQueue = () => (
  <SectionBoundary label="exception queue">
    <ExceptionQueueInner />
  </SectionBoundary>
);

export default AdminExceptionQueue;
