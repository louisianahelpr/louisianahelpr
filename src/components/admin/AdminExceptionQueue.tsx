import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, ClipboardList } from "lucide-react";
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
import { logAdminAction } from "@/lib/adminAudit";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { userFacingError } from "@/lib/userFacingError";

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

  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<ExceptionRow[]>({
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
        // THROW, don't `return []`. A toast is transient; the list it leaves
        // behind reads "No open exceptions — Nothing is waiting on a decision
        // right now" forever, which is the opposite of the truth on a
        // COMPLIANCE queue. Throwing flips isError so the surface says so.
        // (The PGRST202 branch above stays a legitimate empty: the table
        // genuinely does not exist yet during a deploy-lag window.)
        throw error;
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

  /**
   * Bulk selection, keyed by exception id.
   *
   * Bulk resolve IS offered here, unlike the credential and IDV queues, and
   * the difference is who reads the text. A rejection reason is sent to the
   * applicant, so one reason pasted across a batch is either wrong for most of
   * them or too generic to act on. A resolution note is INTERNAL audit trail,
   * and exceptions genuinely arrive in batches with one shared cause ("board
   * had no API, verified manually offline"). One note across that batch is
   * accurate rather than lazy.
   *
   * The note is REQUIRED for bulk, though: an empty note on one row is a
   * judgement call, but on twenty it erases why any of them were cleared.
   */
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Sequential, so one failure does not obscure the rest. */
  const resolveChecked = async (note: string) => {
    const targets = rows.filter((r) => checkedIds.has(r.id));
    if (targets.length === 0 || !note.trim()) return;
    setBulkRunning(true);
    let ok = 0;
    const failures: string[] = [];
    for (const row of targets) {
      const { data: updated, error } = await supabase
        .from("verification_exceptions")
        .update({
          status: "resolved",
          resolution: note.trim(),
          resolved_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("id");
      if (error || !updated || updated.length === 0) {
        failures.push(row.full_name || row.email || row.id);
      } else {
        ok++;
        await logAdminAction("resolve_verification_exception", "verification_exception", row.id, { resolution: note.trim() });
      }
    }
    setBulkRunning(false);
    setBulkOpen(false);
    setCheckedIds(new Set());
    setResolution("");
    qc.invalidateQueries({ queryKey });
    if (failures.length === 0) toast.success(`Resolved ${ok}`);
    else if (ok === 0) toast.error(`Could not resolve ${failures.length} — you may not have permission to write to this queue.`);
    else toast.warning(`Resolved ${ok}, ${failures.length} failed — ${failures.join(", ")}`);
  };

  const resolve = async (row: ExceptionRow, res: string) => {
    setBusy(row.id);
    // `.select()` so "no row matched" is distinguishable from "resolved".
    // Until the admin RLS policy landed, the only non-owner policy on this
    // table was `auth.role() = 'service_role'`, which never matches an admin's
    // JWT — so this update affected zero rows while the queue reported success.
    const { data: updated, error } = await supabase
      .from("verification_exceptions")
      .update({
        status: "resolved",
        resolution: res.trim() || null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("id");
    setBusy(null);
    if (error) {
      toast.error(userFacingError(error, "Couldn't action that exception — try again"));
      return;
    }
    if (!updated || updated.length === 0) {
      toast.error("That exception couldn't be resolved — you may not have permission to write to this queue.");
      return;
    }
    await logAdminAction("resolve_verification_exception", "verification_exception", row.id, { resolution: res.trim() || null });
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
    <AdminViewShell>
      {/* The lead sentence and its count chip sat on the bare page background
          above an untitled list. They describe the queue, so they become its
          card's subtitle and header action. */}
      <AdminCard
        title="Open Exceptions"
        subtitle="Verification cases flagged for manual review — adverse actions, name mismatches, boards with no API."
        action={
          rows.length > 0 ? (
            <span className={cn("inline-flex items-center justify-center rounded-full text-ds-11 font-bold px-2.5 py-1 min-w-[1.75rem]", toneBadgeClasses.warning)}>
              {rows.length}
            </span>
          ) : undefined
        }
      >
      {isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the exception queue."
          body="Tap Try again. Nothing has been decided or lost — this list is read straight from verification_exceptions."
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={ClipboardList}
          title="No open exceptions"
          body="Nothing is waiting on a decision right now."
        />
      ) : (
        <div className="space-y-3">
          {checkedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-ds-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-ds-13 font-medium text-foreground">
                {checkedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={bulkRunning} onClick={() => setCheckedIds(new Set())}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  disabled={bulkRunning}
                  onClick={() => {
                    setResolution("");
                    setBulkOpen(true);
                  }}
                >
                  Resolve {checkedIds.size}
                </Button>
              </div>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-3 shrink-0 h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={checkedIds.has(r.id)}
                  onChange={() => toggleChecked(r.id)}
                  disabled={bulkRunning}
                  aria-label={`Select the ${EXCEPTION_TYPE_LABELS[r.exception_type] ?? r.exception_type} exception for ${r.full_name || r.email || "this user"}`}
                />
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
      </AdminCard>

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
      <AlertDialog open={bulkOpen} onOpenChange={(o) => !o && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHero
            title={`Resolve ${checkedIds.size} Exceptions`}
            subtitle="One note is recorded against every selected exception."
          />
          <Textarea
            aria-label="Resolution note for all selected exceptions"
            placeholder="e.g. Board has no API — all verified manually against the state portal"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkRunning || !resolution.trim()}
              onClick={(e) => {
                // Keep the dialog mounted while the loop runs.
                e.preventDefault();
                resolveChecked(resolution);
              }}
            >
              {bulkRunning ? "Resolving…" : `Mark ${checkedIds.size} Resolved`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminViewShell>
  );
};

const AdminExceptionQueue = () => (
  <SectionBoundary label="exception queue">
    <ExceptionQueueInner />
  </SectionBoundary>
);

export default AdminExceptionQueue;
