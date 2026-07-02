import type React from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function formatSyncTime(ts: string | null): string {
  if (!ts) return "Never synced";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "Just synced";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Styles (matching SubscriptionPage / StrSettings design language)
// ---------------------------------------------------------------------------
export const cardStyle: React.CSSProperties = {
  background:
    "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%), " +
    "var(--surface-premium)",
  border: "0.5px solid hsl(var(--bark) / 0.18)",
  borderColor: "hsl(var(--bark) / 0.18)",
  boxShadow:
    "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
    "0 8px 20px -6px hsl(var(--olivewood) / 0.10)",
};
