/**
 * UserAuditLog — who-did-what-when timeline for a user.
 *
 * Reads `admin_audit_log` (the canonical table used by logAdminAction)
 * and falls back to deriving entries from `user_violations` /
 * `notifications` when the table is empty for the user.
 *
 * The query is intentionally cheap: 50 rows max, single SELECT, no
 * joins. Admin names are resolved via a separate lookup against
 * profiles so the timeline doesn't depend on a foreign-key relation.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { History, ShieldAlert, Bell, UserCheck, Undo2 } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { formatName } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface UserAuditLogProps {
  userId: string;
}

interface TimelineEntry {
  id: string;
  ts: string;
  /** Short label shown as the row title — e.g. "Banned user". */
  label: string;
  /** Optional context — reason, duration, etc. */
  detail?: string;
  /** Display name of the actor (admin) — empty for system events. */
  actor?: string;
  source: "audit" | "violation" | "notification";
  /**
   * Raw user_violations.id, on violation rows only. Present so the row can
   * offer the reversal below — the timeline is the ONLY admin surface that
   * renders individual strikes, so it is the only place the action can live.
   */
  violationId?: string;
}

const ICONS: Record<TimelineEntry["source"], React.ElementType> = {
  audit: UserCheck,
  violation: ShieldAlert,
  notification: Bell,
};

const humaniseAction = (action: string): string => {
  if (!action) return "Action";
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export const UserAuditLog = ({ userId }: UserAuditLogProps) => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  /** Bumped after a reversal so the timeline refetches from the server. */
  const [reloadKey, setReloadKey] = useState(0);
  const [reversing, setReversing] = useState<TimelineEntry | null>(null);
  const [reason, setReason] = useState("");
  const [restoreAccess, setRestoreAccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const submitReversal = async () => {
    if (!reversing?.violationId || !reason.trim() || saving) return;
    setSaving(true);
    // The RPC is the only writer: it snapshots the row into admin_audit_log
    // before deleting it, so there is no client-side audit step to forget.
    // Cast: the RPC is newer than the last types regeneration. Same escape
    // hatch this file already uses for admin_audit_log above.
    const { data, error } = await (supabase.rpc as any)("admin_reverse_violation", {
      p_violation_id: reversing.violationId,
      p_reason: reason.trim(),
      p_restore_access: restoreAccess,
    });
    setSaving(false);
    if (error) {
      report(error, { tags: { source: "UserAuditLog.reverseViolation" } });
      // PGRST202 is the deploy-lag window: migrations land on merge to main,
      // so the bundle can reach an admin minutes before the function exists.
      // Say so, rather than letting it read as a permissions problem.
      toast.error(
        error.code === "PGRST202"
          ? "Reversal isn't live yet — this deploys with the next migration. Try again shortly."
          : error.message?.includes("not_authorized")
            ? "You don't have permission to reverse this."
            : "Couldn't reverse that strike. Nothing was changed.",
      );
      return;
    }
    const restored = (data as { access_restored?: boolean } | null)?.access_restored;
    toast.success(
      restored
        ? "Strike reversed and account access restored."
        : "Strike reversed. It no longer counts toward future warnings.",
    );
    setReversing(null);
    setReason("");
    setRestoreAccess(false);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const merged: TimelineEntry[] = [];

      // 1) Canonical audit log — every logAdminAction() lands here.
      // target_id matches the affected user_id for user-level actions.
      try {
        const { data: auditRows, error } = await (supabase.from as any)("admin_audit_log")
          .select("id, admin_id, action, target_type, details, created_at")
          .or(`target_id.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error && error.code !== "PGRST205" && error.code !== "42P01") {
          report(error, { tags: { source: "UserAuditLog.audit" } });
        }
        for (const row of (auditRows as any[] | null) ?? []) {
          merged.push({
            id: `audit-${row.id}`,
            ts: row.created_at,
            label: humaniseAction(row.action),
            detail: row.details
              ? typeof row.details === "string"
                ? row.details
                : Object.entries(row.details).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")
              : undefined,
            actor: row.admin_id,
            source: "audit",
          });
        }
      } catch (e) {
        report(e, { tags: { source: "UserAuditLog.audit.catch" } });
      }

      // 2) User violations — every warning / strike issued.
      try {
        const { data: vioRows, error } = await supabase
          .from("user_violations")
          .select("id, violation_type, description, action_taken, created_at, reported_by")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) report(error, { tags: { source: "UserAuditLog.violations" } });
        for (const row of vioRows ?? []) {
          merged.push({
            id: `violation-${row.id}`,
            ts: row.created_at ?? new Date().toISOString(),
            label: humaniseAction(row.violation_type || "violation"),
            detail: [row.action_taken, row.description].filter(Boolean).join(" · "),
            actor: row.reported_by || undefined,
            source: "violation",
            violationId: row.id,
          });
        }
      } catch (e) {
        report(e, { tags: { source: "UserAuditLog.violations.catch" } });
      }

      // 3) Admin-originated notifications — useful for "you were warned"
      // entries that don't have a violation row (e.g. soft outreach).
      try {
        const { data: notifRows, error } = await supabase
          .from("notifications")
          .select("id, title, message, created_at, type")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) report(error, { tags: { source: "UserAuditLog.notifications" } });
        for (const row of notifRows ?? []) {
          // Heuristic: surface only admin-toned notifications. Skips
          // mundane "your job is open" pings so the timeline stays useful.
          const isAdmin = (row.title || "").toLowerCase().includes("admin")
            || (row.title || "").startsWith("⚠️")
            || (row.title || "").startsWith("🚫")
            || (row.title || "").startsWith("⛔");
          if (!isAdmin) continue;
          merged.push({
            id: `notif-${row.id}`,
            ts: row.created_at,
            label: row.title || "Notification",
            detail: row.message ?? undefined,
            source: "notification",
          });
        }
      } catch (e) {
        report(e, { tags: { source: "UserAuditLog.notifications.catch" } });
      }

      // Sort merged feed by timestamp desc.
      merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      // Resolve admin actor names in one batch.
      const actorIds = Array.from(new Set(merged.map((e) => e.actor).filter((id): id is string => !!id && id.length > 16)));
      const nameMap = new Map<string, string>();
      if (actorIds.length > 0) {
      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
        const { data: profs, error: profsError } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", actorIds);
      if (profsError) report(profsError, { severity: "warning", tags: { source: "UserAuditLog.hydrateNames" } });
        for (const p of profs ?? []) {
          nameMap.set(p.user_id, formatName(p.full_name, "Admin"));
        }
      }
      for (const e of merged) {
        if (e.actor && nameMap.has(e.actor)) e.actor = nameMap.get(e.actor)!;
        else if (e.actor) e.actor = "Admin";
      }

      if (!cancelled) {
        setEntries(merged.slice(0, 50));
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, reloadKey]);

  return (
    <div className="space-y-2">
      <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
        <History className="w-3.5 h-3.5" /> Audit Log
      </h4>
      {loading ? (
        <p className="text-ds-11 text-muted-foreground">Loading timeline…</p>
      ) : entries.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground italic">
          No admin actions, warnings, or notifications recorded for this user yet.
        </p>
      ) : (
        <ol className="relative border-l border-border/60 pl-4 space-y-3">
          {entries.map((e) => {
            const Icon = ICONS[e.source];
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.45rem] top-0.5 w-4 h-4 rounded-full bg-card border border-border flex items-center justify-center">
                  <Icon className="w-2.5 h-2.5 text-muted-foreground" aria-hidden />
                </span>
                <div className="rounded-ds-sm bg-secondary/30 p-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-ds-13 font-medium text-foreground truncate">
                      {e.label}
                    </p>
                    <time
                      className="text-ds-10 text-muted-foreground tabular-nums shrink-0"
                      dateTime={e.ts}
                      title={new Date(e.ts).toLocaleString()}
                    >
                      {formatDistanceToNow(new Date(e.ts), { addSuffix: true })}
                    </time>
                  </div>
                  {e.detail && (
                    <p className="text-ds-11 text-muted-foreground break-words leading-snug">
                      {e.detail}
                    </p>
                  )}
                  {e.actor && (
                    <p className="text-ds-10 text-muted-foreground italic">
                      by {e.actor}
                    </p>
                  )}
                  {e.violationId && (
                    <button
                      type="button"
                      onClick={() => { setReversing(e); setReason(""); setRestoreAccess(false); }}
                      className="mt-1 inline-flex items-center gap-1 text-ds-10 font-medium text-muted-foreground hover:text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-ds-sm"
                    >
                      <Undo2 className="w-2.5 h-2.5" aria-hidden />
                      Reverse this strike
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}>
        <DialogContent>
          <DialogHero title="Reverse this strike" />
          <div className="space-y-3">
            <p className="text-ds-12 text-muted-foreground leading-snug">
              <strong className="text-foreground">{reversing?.label}</strong> will be
              removed from this user's record. It stops counting toward every future
              warning ladder, and the reversal is logged against your account.
            </p>
            <Textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="Why is this being reversed? e.g. helper provided GPS proof they were on site"
              rows={3}
              aria-label="Reason for reversing this strike"
            />
            <label className="flex items-start gap-2 text-ds-12 text-muted-foreground cursor-pointer">
              <Checkbox
                checked={restoreAccess}
                onCheckedChange={(v) => setRestoreAccess(v === true)}
                className="mt-0.5"
              />
              <span>
                Also restore account access. Only applies if this was their{" "}
                <strong className="text-foreground">last remaining strike</strong> and
                they are on a warning or temporary suspension — a permanent ban is
                never lifted here.
              </span>
            </label>
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => setReversing(null)}>
              Cancel
            </DialogSecondaryAction>
            <DialogPrimaryAction onClick={submitReversal} disabled={!reason.trim() || saving}>
              {saving ? "Reversing…" : "Reverse strike"}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
