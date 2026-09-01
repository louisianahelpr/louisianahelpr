import {
  Home, CalendarOff, RefreshCw, Trash2, CheckCircle, AlertCircle, Clock, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StrConnection } from "./types";
import { PLATFORM_LABELS } from "./types";
import { cardStyle, formatSyncTime } from "./strSettingsHelpers";

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------
interface ConnectionCardProps {
  conn: StrConnection;
  onSync: (id: string) => void;
  /** Asks the page to confirm removal — never removes directly. */
  onRequestRemove: (conn: StrConnection) => void;
  syncing: boolean;
  removing: boolean;
}

export function ConnectionCard({ conn, onSync, onRequestRemove, syncing, removing }: ConnectionCardProps) {
  // THREE states, not two. A connection that has never synced carries
  // `last_synced_at: null` AND `last_sync_error: null` — which the old
  // two-way split (`hasError ? error : ok`) rendered as a SAGE GREEN CHECK
  // beside the words "Never synced". Every calendar was born looking healthy,
  // because the row is inserted with both columns null, so the reassuring
  // tick appeared before a single fetch had happened and stayed there if the
  // cron never ran. A status icon that cannot say "don't know yet" is a claim
  // nothing checks.
  const hasError = !!conn.last_sync_error;
  const neverSynced = !hasError && !conn.last_synced_at;
  const statusColor = hasError
    ? "hsl(var(--burnt-sienna))"
    : neverSynced
      ? "hsl(var(--olivewood) / 0.7)"
      : "hsl(var(--sage))";
  const StatusIcon = hasError ? AlertCircle : neverSynced ? Clock : CheckCircle;

  return (
    <div className="rounded-ds-md p-4 space-y-3" style={cardStyle}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Platform badge */}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-serif italic font-semibold uppercase text-ds-10"
            style={{
              letterSpacing: "0.1em",
              background: "hsl(var(--bark) / 0.1)",
              color: "hsl(var(--bark))",
              border: "0.5px solid hsl(var(--bark) / 0.3)",
            }}
          >
            {PLATFORM_LABELS[conn.platform]}
          </span>
          <p
            className="font-display font-semibold truncate text-ds-15"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {conn.property_name || "Unnamed property"}
          </p>
        </div>
        {/* Sync status */}
        <div className="flex items-center gap-1 shrink-0">
          <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
          <span className="text-ds-12" style={{ color: statusColor }}>
            {hasError ? "Sync failed — reconnect?" : formatSyncTime(conn.last_synced_at)}
          </span>
        </div>
      </div>

      {/* Address */}
      {conn.property_address && (
        <p className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {conn.property_address}
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <div
          className="rounded-ds-md px-3 py-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <p className="text-ds-12" style={{ color: "hsl(var(--burnt-sienna))" }}>
            {conn.last_sync_error}
          </p>
        </div>
      )}

      {/* What this connection actually does — gated on `auto_create_cleaning`.
          str-ical-sync only posts a job inside `if (conn.auto_create_cleaning)`,
          so a host who connected with the toggle off gets checkout syncing and
          nothing else; promising auto-created jobs there is a lie they'd only
          discover by a cleaner never showing up.

          cleaning_budget is a FLAT per-job budget — AddCalendarForm labels it
          "Cleaning budget ($)" and str-ical-sync writes it straight to
          jobs.budget — never an hourly rate, so no "/hr" suffix here. */}
      {conn.auto_create_cleaning ? (
        <div
          className="flex items-center gap-2 rounded-ds-md px-3 py-2"
          style={{ background: "hsl(var(--burnt-sienna) / 0.08)", border: "0.5px solid hsl(var(--burnt-sienna) / 0.2)" }}
        >
          <Home className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} />
          <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Auto-creates <strong style={{ color: "hsl(var(--ink-deep))" }}>cleaning jobs</strong>{" "}
            {/* Null budget means the host never set one — say so instead of
                fabricating an $80 figure str-ical-sync won't use. */}
            {conn.cleaning_budget != null ? (
              <>at <strong style={{ color: "hsl(var(--ink-deep))" }}>${conn.cleaning_budget}</strong></>
            ) : (
              <>(budget not set)</>
            )}
          </span>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 rounded-ds-md px-3 py-2"
          style={{ background: "hsl(var(--olivewood) / 0.06)", border: "0.5px solid hsl(var(--olivewood) / 0.15)" }}
        >
          <CalendarOff className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
          <span className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <strong style={{ color: "hsl(var(--ink-deep))" }}>No jobs auto-created.</strong>{" "}
            Helpr keeps this calendar in sync but won't post a cleaning job at
            checkout. Reconnect the calendar with auto-create on to change that.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md text-ds-13"
          disabled={syncing}
          onClick={() => onSync(conn.id)}
          style={{ height: 36 }}
        >
          {syncing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
        <button
          type="button"
          aria-label="Remove calendar connection"
          disabled={removing}
          className="flex items-center justify-center rounded-ds-md disabled:opacity-50"
          style={{
            width: 40, height: 36,
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            color: "hsl(var(--burnt-sienna))",
          }}
          onClick={() => onRequestRemove(conn)}
        >
          {removing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
