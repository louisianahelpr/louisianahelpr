import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { formatCategory } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import type { Json } from "@/integrations/supabase/types";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";

interface AuditEntry {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Json | null;
  created_at: string;
  admin_name?: string;
}

const AdminAuditLog = () => {
  const { data: entries, isInitialLoading, isError, refetch } = useInstantQuery<AuditEntry[]>({
    key: ["admin-audit-log"],
    fallback: [],
    fetcher: async () => {
      const data = unwrap(await supabase.from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200));

      if (!data || data.length === 0) return [];

      const adminIds = [...new Set(data.map((e) => e.admin_id))];
      const profiles = unwrap(await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", adminIds));

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      return data.map((e) => ({
        ...e,
        admin_name: formatName(nameMap.get(e.admin_id), "System"),
      }));
    },
  });

  const exportCSV = () => {
    const header = "Timestamp,Admin,Action,Target Type,Target ID,Details\n";
    const rows = entries.map(e =>
      `"${e.created_at}","${e.admin_name}","${e.action}","${e.target_type || ""}","${e.target_id || ""}","${JSON.stringify(e.details || {}).replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionTone: Record<string, Tone> = {
    approve_user: "success",
    deny_user: "danger",
    ban_user: "danger",
    resolve_fraud_flag: "info",
    update_settings: "notice",
    resolve_dispute: "danger",
    job_status_override: "warning",
    job_admin_refund: "danger",
    job_admin_refund_partial: "warning",
  };

  // Pull the most useful fields from details for inline display so admins
  // see the "what happened" at a glance instead of just the action label.
  const summarizeDetails = (action: string, details: Json | null): string | null => {
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const d = details as Record<string, Json | undefined>;
    const get = (k: string) => d[k];
    if (action === "job_status_override") {
      const from = get("from_status");
      const to = get("to_status");
      const title = get("job_title");
      if (from && to) return `${from} → ${to}${title ? ` · "${title}"` : ""}`;
    }
    if (action === "job_admin_refund" || action === "job_admin_refund_partial") {
      const title = get("job_title");
      const budget = get("budget");
      const partial = get("partial_amount_dollars");
      const reason = get("reason");
      const parts: string[] = [];
      if (title) parts.push(`"${title}"`);
      if (partial) parts.push(`$${partial} of $${budget ?? "?"}`);
      else if (budget) parts.push(`$${budget}`);
      if (reason) parts.push(`reason: ${reason}`);
      return parts.join(" · ") || null;
    }
    if (action === "resolve_dispute" || action === "resolve_fraud_flag") {
      const outcome = get("outcome") || get("resolution");
      if (outcome) return String(outcome);
    }
    if (action === "ban_user" || action === "deny_user") {
      const reason = get("reason");
      if (reason) return `reason: ${reason}`;
    }
    // Fallback: surface the first short string field for unknown actions.
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string" && v.length < 80 && k !== "id") return `${k}: ${v}`;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={entries.length === 0}>
          <Download className="w-3 h-3 mr-1" /> Export CSV
        </Button>
      </div>

      {isInitialLoading ? (
        // Shape-matched skeletons so the audit log surface holds its
        // height while the 200-row select resolves.
        <div className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-ds-sm liquid-glass p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load the audit log."
          body="Tap Try again. Every admin action is still recorded — this is just a fetch hiccup."
          onRetry={() => refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={FileText}
          eyebrow="Quiet so far"
          title="No audit entries yet"
          body="Admin actions land here the moment anyone approves a user, resolves a dispute, or updates settings."
        />
      ) : (
        <div className="space-y-1.5">
          {entries.map(entry => {
            const summary = summarizeDetails(entry.action, entry.details);
            return (
              <div key={entry.id} className="rounded-ds-sm liquid-glass p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ds-13 text-foreground">{entry.admin_name}</span>
                    <Badge className={toneBadgeClasses[actionTone[entry.action] ?? "neutral"]}>
                      {formatCategory(entry.action)}
                    </Badge>
                    {entry.target_type && (
                      <span className="text-ds-11 text-muted-foreground">→ {entry.target_type}</span>
                    )}
                  </div>
                  {summary && (
                    <p className="text-ds-11 text-foreground/80 mt-1 break-words">{summary}</p>
                  )}
                  <p className="text-ds-11 text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAuditLog;
