import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Download, Users, Briefcase, DollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
    const { data } = await supabase.from("profiles").select("user_id, full_name, email, role, approval_status, ban_status, location, created_at, subscription_tier").order("created_at", { ascending: false });
    if (!data?.length) { toast.error("No data to export"); setExporting(null); return; }
    const header = "User ID,Name,Email,Role,Status,Ban Status,Location,Created,Subscription";
    const rows = data.map(p => [p.user_id, p.full_name, p.email, p.role, p.approval_status, p.ban_status, p.location, p.created_at, p.subscription_tier].map(esc).join(","));
    downloadCSV(`users-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    toast.success(`Exported ${data.length} users`);
    setExporting(null);
  };

  const exportJobs = async () => {
    setExporting("jobs");
    const { data } = await supabase.from("jobs").select("id, title, category, status, budget, platform_fee_amount, customer_id, helper_id, date_needed, created_at, payment_status").order("created_at", { ascending: false });
    if (!data?.length) { toast.error("No data to export"); setExporting(null); return; }
    const header = "Job ID,Title,Category,Status,Budget,Platform Fee,Customer ID,Helper ID,Date Needed,Created,Payment Status";
    const rows = data.map(j => [j.id, j.title, j.category, j.status, j.budget, j.platform_fee_amount, j.customer_id, j.helper_id, j.date_needed, j.created_at, j.payment_status].map(esc).join(","));
    downloadCSV(`jobs-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    toast.success(`Exported ${data.length} jobs`);
    setExporting(null);
  };

  const exportEarnings = async () => {
    setExporting("earnings");
    const { data } = await supabase.from("jobs").select("id, title, budget, platform_fee_amount, platform_fee_percent, helper_id, customer_id, status, updated_at, payment_status, urgent_fee").eq("status", "completed");
    if (!data?.length) { toast.error("No data to export"); setExporting(null); return; }
    const header = "Job ID,Title,Budget,Platform Fee,Fee %,Urgent Fee,Helper ID,Customer ID,Payment Status,Completed At";
    const rows = data.map(j => [j.id, j.title, j.budget, j.platform_fee_amount, j.platform_fee_percent, j.urgent_fee, j.helper_id, j.customer_id, j.payment_status, j.updated_at].map(esc).join(","));
    downloadCSV(`earnings-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    toast.success(`Exported ${data.length} earnings records`);
    setExporting(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
        <Download className="w-5 h-5 text-primary" /> Data Export
      </h2>
      <p className="text-sm text-muted-foreground">Export platform data as CSV files for reporting, accounting, and compliance.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground">Users</h3>
          <p className="text-xs text-muted-foreground">All user profiles including status, role, and subscription info.</p>
          <Button size="sm" onClick={exportUsers} disabled={!!exporting}>
            {exporting === "users" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
            Export Users
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground">Jobs</h3>
          <p className="text-xs text-muted-foreground">All jobs with status, budgets, and assignment details.</p>
          <Button size="sm" onClick={exportJobs} disabled={!!exporting}>
            {exporting === "jobs" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
            Export Jobs
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground">Earnings</h3>
          <p className="text-xs text-muted-foreground">Completed jobs with fee breakdowns for accounting.</p>
          <Button size="sm" onClick={exportEarnings} disabled={!!exporting}>
            {exporting === "earnings" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
            Export Earnings
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminExport;
