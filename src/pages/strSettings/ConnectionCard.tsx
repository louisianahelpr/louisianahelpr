import {
  Home, RefreshCw, Trash2, CheckCircle, AlertCircle, Loader2,
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
  onRemove: (id: string) => void;
  syncing: boolean;
  removing: boolean;
}

export function ConnectionCard({ conn, onSync, onRemove, syncing, removing }: ConnectionCardProps) {
  const hasError = !!conn.last_sync_error;
  const statusColor = hasError ? "hsl(var(--burnt-sienna))" : "hsl(var(--sage))";
  const StatusIcon = hasError ? AlertCircle : CheckCircle;

  return (
    <div className="rounded-ds-md p-4 space-y-3" style={cardStyle}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Platform badge */}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-serif italic font-semibold uppercase"
            style={{
              fontSize: "0.62rem",
              letterSpacing: "0.1em",
              background: "hsl(var(--bark) / 0.1)",
              color: "hsl(var(--bark))",
              border: "0.5px solid hsl(var(--bark) / 0.3)",
            }}
          >
            {PLATFORM_LABELS[conn.platform]}
          </span>
          <p
            className="font-display font-semibold truncate"
            style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))" }}
          >
            {conn.property_name || "Unnamed property"}
          </p>
        </div>
        {/* Sync status */}
        <div className="flex items-center gap-1 shrink-0">
          <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
          <span style={{ fontSize: "0.72rem", color: statusColor }}>
            {hasError ? "Error" : formatSyncTime(conn.last_synced_at)}
          </span>
        </div>
      </div>

      {/* Address */}
      {conn.property_address && (
        <p style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          {conn.property_address}
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <div
          className="rounded-lg px-3 py-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--burnt-sienna))" }}>
            {conn.last_sync_error}
          </p>
        </div>
      )}

      {/* Budget info row */}
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: "hsl(var(--gold-warm) / 0.08)", border: "0.5px solid hsl(var(--gold-warm) / 0.2)" }}
      >
        <Home className="w-3.5 h-3.5" style={{ color: "hsl(var(--bark))" }} />
        <span style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Auto-creates <strong style={{ color: "hsl(var(--ink-deep))" }}>cleaning jobs</strong> at{" "}
          <strong style={{ color: "hsl(var(--ink-deep))" }}>
            ${conn.cleaning_budget ?? 80}/hr
          </strong>
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md"
          disabled={syncing}
          onClick={() => onSync(conn.id)}
          style={{ fontSize: "0.8rem", height: 36 }}
        >
          {syncing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {syncing ? "Syncing…" : "Sync now"}
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
          onClick={() => onRemove(conn.id)}
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
