import { useState } from "react";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import BusinessLayout from "@/components/business/BusinessLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";

type ExportFormat = "csv" | "quickbooks";

const today = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};

const csvEscape = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const BusinessExports = () => {
  usePageTitle("Exports — Helpr Business");
  const { business, isLoading } = useMyBusiness();
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(today());
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [generating, setGenerating] = useState(false);

  if (isLoading) {
    return (
      <BusinessLayout eyebrow="Reports" title="Exports">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessLayout>
    );
  }
  if (!business) return <BusinessNoAccountState title="Exports" />;

  const generate = async () => {
    setGenerating(true);
    try {
      const fromIso = new Date(`${from}T00:00:00Z`).toISOString();
      const toIso = new Date(`${to}T23:59:59Z`).toISOString();

      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, status, budget, platform_fee_amount, customer_fee_amount, payment_status, accepted_by, created_at, updated_at")
        .eq("business_id", business.business_id)
        .in("payment_status", ["released", "payout_pending", "escrow"])
        .neq("status", "cancelled")
        .gte("updated_at", fromIso)
        .lte("updated_at", toIso);
      if (error) throw error;

      const rows = data ?? [];

      let content: string;
      let filename: string;
      if (format === "quickbooks") {
        // QuickBooks IIF-style header (simplified) — usable as a one-row-
        // per-bill CSV that Quickbooks accepts via "Import bills (CSV)".
        const header = "*Bill No,*Supplier,*Bill Date,*Due Date,Terms,*Account,Line Description,*Line Amount\n";
        const body = rows.map((j: any) => {
          const billNo = `HELPR-${String(j.id).slice(0, 8)}`;
          const supplier = "Helpr";
          const date = new Date(j.updated_at).toISOString().slice(0, 10);
          const total = (j.budget || 0) + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0);
          return [
            csvEscape(billNo),
            csvEscape(supplier),
            csvEscape(date),
            csvEscape(date),
            csvEscape("Net 30"),
            csvEscape("Contract Labor"),
            csvEscape(j.title || "Helpr job"),
            csvEscape(total.toFixed(2)),
          ].join(",");
        }).join("\n");
        content = header + body + "\n";
        filename = `helpr-quickbooks-${from}-to-${to}.csv`;
      } else {
        const header = "job_id,title,status,payment_status,budget_usd,platform_fee_usd,customer_fee_usd,total_paid_usd,completed_at\n";
        const body = rows.map((j: any) => {
          const cells = [
            j.id,
            j.title || "",
            j.status,
            j.payment_status,
            (j.budget || 0).toFixed(2),
            (j.platform_fee_amount || 0).toFixed(2),
            (j.customer_fee_amount || 0).toFixed(2),
            ((j.budget || 0) + (j.platform_fee_amount || 0) + (j.customer_fee_amount || 0)).toFixed(2),
            j.updated_at,
          ].map(csvEscape);
          return cells.join(",");
        }).join("\n");
        content = header + body + "\n";
        filename = `helpr-export-${from}-to-${to}.csv`;
      }

      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      hapticSuccess();
      toast.success(`Exported ${rows.length} job${rows.length === 1 ? "" : "s"}`);
    } catch (err: any) {
      hapticError();
      toast.error(err.message || "We couldn't generate that export — try again in a moment.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <BusinessLayout
      eyebrow="Reports"
      title="Exports"
      meta="Download paid-work data as CSV or in a QuickBooks-friendly bill format."
    >
      <Card className="p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Download className="w-4 h-4" /> Generate export
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <Label htmlFor="ex-from">From</Label>
            <Input id="ex-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ex-to">To</Label>
            <Input id="ex-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="mb-4">
          <Label htmlFor="ex-format">Format</Label>
          <select
            id="ex-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="w-full h-10 px-3 rounded-ds-sm border border-border bg-background text-ds-13"
          >
            <option value="csv">CSV (general)</option>
            <option value="quickbooks">QuickBooks Bills (CSV)</option>
          </select>
        </div>
        <Button onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Download className="w-4 h-4 mr-1" /> Generate</>}
        </Button>
        <p className="text-ds-11 text-muted-foreground mt-3">
          Only paid jobs (escrow / payout-pending / released) within the date range are included.
        </p>
      </Card>
    </BusinessLayout>
  );
};

export default BusinessExports;
