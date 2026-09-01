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
import { History, ShieldAlert, Bell, UserCheck } from "lucide-react";
import { report } from "@/lib/errorLogger";
import { formatName } from "@/lib/utils";

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
  }, [userId]);

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
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
