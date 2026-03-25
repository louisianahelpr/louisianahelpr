import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEntries = async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("admin_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!data) { setEntries([]); setLoading(false); return; }

    const adminIds = [...new Set((data as any[]).map((e: any) => e.admin_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", adminIds);

    const nameMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
    setEntries((data as any[]).map((e: any) => ({
      ...e,
      admin_name: formatName(nameMap.get(e.admin_id), "System"),
    })));
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, []);

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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading audit log…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No audit entries yet</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(entry => (
            <div key={entry.id} className="rounded-lg border border-border bg-card p-3 flex items-start gap-3">
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
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAuditLog;
