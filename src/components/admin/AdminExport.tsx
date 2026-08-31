import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Download, Users, Briefcase, DollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";

const downloadCSV = (filename: string, header: string, rows: string[]) => {
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const AdminExport = () => {
  const [exporting, setExporting] = useState<string | null>(null);

  const exportUsers = async () => {
    setExporting("users");
    // profiles.role was dropped — fetch profile + user_roles separately and merge.
    const [{ data, error }, { data: roles, error: rolesError }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email, approval_status, ban_status, location, created_at, subscription_tier").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (error) {
      report(error, { tags: { source: "AdminExport.exportUsers.profiles" } });
      toast.error("Export failed: " + error.message);
      setExporting(null);
      return;
    }
    if (rolesError) {
      report(rolesError, { tags: { source: "AdminExport.exportUsers.roles" } });
      toast.error("Export failed: " + rolesError.message);
      setExporting(null);
      return;
    }
    if (!data?.length) { toast.error("No data to export."); setExporting(null); return; }
    // Build a user_id → roles map. Pick the most-privileged role per user
    // (admin > helper > customer) for the single CSV column.
    const roleByUser = new Map<string, string>();
    const priority = (r: string) => r === "admin" ? 1 : r === "helper" ? 2 : 3;
    for (const r of roles ?? []) {
      const existing = roleByUser.get(r.user_id);
      if (!existing || priority(r.role) < priority(existing)) {
        roleByUser.set(r.user_id, r.role);
      }
    }
    const header = "User ID,Name,Email,Role,Status,Ban Status,Location,Created,Subscription";
    const rows = data.map(p => [p.user_id, p.full_name, p.email, roleByUser.get(p.user_id) ?? "", p.approval_status, p.ban_status, p.location, p.created_at, p.subscription_tier].map(esc).join(","));
    downloadCSV(`users-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    setExporting(null);
  };

  const exportJobs = async () => {
    setExporting("jobs");
    // Try the wide select with the new `department` column first; fall
    // back when the column doesn't exist yet (migration 20260609170000
    // unapplied on prod). Cast through `any` until generated supabase
    // types catch up.
    const wide = await supabase
      .from("jobs")
      .select(
        "id, title, category, status, budget, platform_fee_amount, customer_id, helper_id, date_needed, created_at, payment_status, department, business_id" as any,
      )
      .order("created_at", { ascending: false });
    let rowsRaw: any[] | null = wide.data as any[] | null;
    let queryErr = wide.error;
    if (queryErr) {
      const code = (queryErr as { code?: string }).code;
      if (code === "42703" || code === "PGRST204") {
        const narrow = await supabase
          .from("jobs")
          .select("id, title, category, status, budget, platform_fee_amount, customer_id, helper_id, date_needed, created_at, payment_status")
          .order("created_at", { ascending: false });
        rowsRaw = narrow.data;
        queryErr = narrow.error;
      }
    }
    if (queryErr) {
      report(queryErr, { tags: { source: "AdminExport.exportJobs" } });
      toast.error("Export failed: " + queryErr.message);
      setExporting(null);
      return;
    }
    if (!rowsRaw?.length) { toast.error("No data to export."); setExporting(null); return; }
    const header = "Job ID,Title,Category,Status,Budget,Platform Fee,Customer ID,Helper ID,Date Needed,Created,Payment Status,Department,Business ID";
    const rows = rowsRaw.map((j: any) => [
      j.id, j.title, j.category, j.status, j.budget, j.platform_fee_amount, j.customer_id, j.helper_id,
      j.date_needed, j.created_at, j.payment_status, j.department ?? "", j.business_id ?? "",
    ].map(esc).join(","));
    downloadCSV(`jobs-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    setExporting(null);
  };

  const exportEarnings = async () => {
    setExporting("earnings");
    const { data, error } = await supabase.from("jobs").select("id, title, budget, platform_fee_amount, platform_fee_percent, helper_id, customer_id, status, updated_at, payment_status, urgent_fee").eq("status", "completed");
    if (error) {
      report(error, { tags: { source: "AdminExport.exportEarnings" } });
      toast.error("Export failed: " + error.message);
      setExporting(null);
      return;
    }
    if (!data?.length) { toast.error("No data to export."); setExporting(null); return; }
    const header = "Job ID,Title,Budget,Platform Fee,Fee %,Urgent Fee,Helper ID,Customer ID,Payment Status,Completed At";
    const rows = data.map(j => [j.id, j.title, j.budget, j.platform_fee_amount, j.platform_fee_percent, j.urgent_fee, j.helper_id, j.customer_id, j.payment_status, j.updated_at].map(esc).join(","));
    downloadCSV(`earnings-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    setExporting(null);
  };

  // One row per dataset, so the three cards are provably identical instead
  // of three hand-copied blocks that could drift apart the next time one is
  // edited (they had already drifted from every other admin card by carrying
  // a bare `font-semibold` h3 instead of the shared header treatment).
  const DATASETS = [
    { key: "users", icon: Users, title: "Users", body: "All user profiles including status, role, and subscription info.", label: "Export Users", run: exportUsers },
    { key: "jobs", icon: Briefcase, title: "Jobs", body: "All jobs with status, budgets, and assignment details.", label: "Export Jobs", run: exportJobs },
    { key: "earnings", icon: DollarSign, title: "Earnings", body: "Completed jobs with fee breakdowns for accounting.", label: "Export Earnings", run: exportEarnings },
  ] as const;

  return (
    <AdminViewShell>
      <AdminCard
        title="Data Exports"
        subtitle="Platform data as CSV files for reporting, accounting, and compliance."
        contentClassName="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        {DATASETS.map(({ key, icon: Icon, title, body, label, run }) => (
          /* `flex-col` + `mt-auto` on the button: the three descriptions are
             different lengths, so "Users" wrapped to two lines and its Export
             button sat a line lower than its two siblings — three buttons on
             three different baselines across one row. The button now pins to
             the bottom of every card regardless of copy length. */
          <div key={key} className="flex flex-col rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
            <div className="w-9 h-9 rounded-ds-sm bg-primary/10 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-semibold text-foreground text-ds-13">{title}</h3>
              <p className="text-ds-11 text-muted-foreground">{body}</p>
            </div>
            <Button size="sm" className="mt-auto self-start" onClick={run} disabled={!!exporting}>
              {exporting === key ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
              {label}
            </Button>
          </div>
        ))}
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminExport;
