import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useInstantQuery } from "@/hooks/useInstantQuery";

interface AuditEntry {
  id: string;
  admin_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  admin_name?: string;
}

const AdminAuditLog = () => {
  const { data: entries, isInitialLoading } = useInstantQuery<AuditEntry[]>({
    key: ["admin-audit-log"],
    fallback: [],
    fetcher: async () => {
      const { data } = await supabase.from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!data) return [];

      const adminIds = [...new Set((data as any[]).map((e: any) => e.admin_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", adminIds);

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      return (data as any[]).map((e: any) => ({
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

  const actionColor: Record<string, string> = {
    approve_user: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    deny_user: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    ban_user: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    resolve_fraud_flag: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    update_settings: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    resolve_dispute: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    job_status_override: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    job_admin_refund: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    job_admin_refund_partial: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  };

  // Pull the most useful fields from details for inline display so admins
  // see the "what happened" at a glance instead of just the action label.
  const summarizeDetails = (action: string, details: Record<string, unknown> | null): string | null => {
    if (!details) return null;
    const get = (k: string) => details[k];
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
    for (const [k, v] of Object.entries(details)) {
      if (typeof v === "string" && v.length < 80 && k !== "id") return `${k}: ${v}`;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" /> Audit Log
        </h2>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={entries.length === 0}>
          <Download className="w-3 h-3 mr-1" /> Export CSV
        </Button>
      </div>

      {isInitialLoading ? (
        <p className="text-xs text-muted-foreground">Loading audit log…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl liquid-glass p-8 text-center">
          <p className="text-xs text-muted-foreground">No audit entries yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(entry => {
            const summary = summarizeDetails(entry.action, entry.details);
            return (
              <div key={entry.id} className="rounded-lg liquid-glass p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground">{entry.admin_name}</span>
                    <Badge className={actionColor[entry.action] || "bg-muted text-muted-foreground"}>
                      {entry.action.replace(/_/g, " ")}
                    </Badge>
                    {entry.target_type && (
                      <span className="text-xs text-muted-foreground">→ {entry.target_type}</span>
                    )}
                  </div>
                  {summary && (
                    <p className="text-xs text-foreground/80 mt-1 break-words">{summary}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
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
