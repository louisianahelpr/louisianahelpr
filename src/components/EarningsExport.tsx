import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileSpreadsheet, FileText, CalendarIcon, Loader2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface EarningsExportProps {
  helperId: string;
  helperName: string;
}

interface ExportRow {
  job_id: string;
  date_completed: string;
  job_title: string;
  category: string;
  parish: string;
  tax_status: string;
  gross_budget: number;
  platform_fee: number;
  parish_tax_collected: number;
  net_payout: number;
}

type RangeMode = "month" | "ytd" | "custom";

export const EarningsExport = ({ helperId, helperName }: EarningsExportProps) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RangeMode>("ytd");
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [busy, setBusy] = useState(false);

  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      });
    }
    return opts;
  })();

  const resolveRange = (): { start: string; end: string; label: string } | null => {
    if (mode === "month") {
      const [y, m] = month.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return {
        start: `${y}-${String(m).padStart(2, "0")}-01`,
        end: end.toISOString().slice(0, 10),
        label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      };
    }
    if (mode === "ytd") {
      const y = new Date().getFullYear();
      const today = new Date().toISOString().slice(0, 10);
      return { start: `${y}-01-01`, end: today, label: `${y} Year-to-Date` };
    }
    if (!customStart || !customEnd) {
      toast.error("Pick both a start and end date.");
      return null;
    }
    return {
      start: customStart.toISOString().slice(0, 10),
      end: customEnd.toISOString().slice(0, 10),
      label: `${format(customStart, "MMM d, yyyy")} – ${format(customEnd, "MMM d, yyyy")}`,
    };
  };

  const fetchRows = async (start: string, end: string): Promise<ExportRow[]> => {
    const { data, error } = await supabase.rpc("get_helper_earnings_export", {
      _helper_id: helperId,
      _start_date: start,
      _end_date: end,
    });
    if (error) throw error;
    return (data || []) as ExportRow[];
  };

  const handleExport = async (formatType: "csv" | "pdf") => {
    const range = resolveRange();
    if (!range) return;
    setBusy(true);
    try {
      const rows = await fetchRows(range.start, range.end);
      if (!rows.length) {
        toast.info(`No completed jobs found for ${range.label}.`);
        return;
      }
      if (formatType === "csv") downloadCSV(rows, range.label);
      else downloadPDF(rows, range.label);
      toast.success(`${formatType.toUpperCase()} ready — ${rows.length} job${rows.length === 1 ? "" : "s"}.`);
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadCSV = (rows: ExportRow[], label: string) => {
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "Date", "Job Title", "Category", "Parish", "Tax Status",
      "Gross Budget (USD)", "Platform Fee (USD)", "Parish Tax Collected (USD)", "Net Payout (USD)",
    ];
    const lines = [headers.join(",")];
    let totGross = 0, totFee = 0, totTax = 0, totNet = 0;
    for (const r of rows) {
      totGross += Number(r.gross_budget);
      totFee += Number(r.platform_fee);
      totTax += Number(r.parish_tax_collected);
      totNet += Number(r.net_payout);
      lines.push([
        r.date_completed,
        escape(r.job_title),
        escape(r.category),
        escape(r.parish),
        r.tax_status,
        Number(r.gross_budget).toFixed(2),
        Number(r.platform_fee).toFixed(2),
        Number(r.parish_tax_collected).toFixed(2),
        Number(r.net_payout).toFixed(2),
      ].join(","));
    }
    lines.push("");
    lines.push(`TOTAL,,,,,${totGross.toFixed(2)},${totFee.toFixed(2)},${totTax.toFixed(2)},${totNet.toFixed(2)}`);
    lines.push("");
    lines.push(`Helper,${escape(helperName)}`);
    lines.push(`Period,${escape(label)}`);
    lines.push(`Generated,${new Date().toISOString()}`);
    lines.push("Note,Parish tax is collected & remitted by Helpr (marketplace facilitator). Net payout shown before tips.");

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `helpr-earnings-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`);
  };

  const downloadPDF = (rows: ExportRow[], label: string) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
    const totals = rows.reduce(
      (acc, r) => ({
        gross: acc.gross + Number(r.gross_budget),
        fee: acc.fee + Number(r.platform_fee),
        tax: acc.tax + Number(r.parish_tax_collected),
        net: acc.net + Number(r.net_payout),
      }),
      { gross: 0, fee: 0, tax: 0, net: 0 }
    );

    // Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("Helpr — Earnings Statement", 40, 50);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Helper: ${helperName}`, 40, 70);
    doc.text(`Period: ${label}`, 40, 85);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`, 40, 100);

    autoTable(doc, {
      startY: 120,
      head: [["Date", "Job", "Category", "Parish", "Tax", "Gross", "Fee", "Parish Tax", "Net Payout"]],
      body: rows.map((r) => [
        r.date_completed,
        r.job_title.length > 28 ? r.job_title.slice(0, 26) + "…" : r.job_title,
        r.category.replace(/_/g, " "),
        r.parish,
        r.tax_status,
        `$${Number(r.gross_budget).toFixed(2)}`,
        `$${Number(r.platform_fee).toFixed(2)}`,
        `$${Number(r.parish_tax_collected).toFixed(2)}`,
        `$${Number(r.net_payout).toFixed(2)}`,
      ]),
      foot: [[
        "", "", "", "", "TOTAL",
        `$${totals.gross.toFixed(2)}`,
        `$${totals.fee.toFixed(2)}`,
        `$${totals.tax.toFixed(2)}`,
        `$${totals.net.toFixed(2)}`,
      ]],
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [40, 40, 40] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      columnStyles: {
        5: { halign: "right" }, 6: { halign: "right" },
        7: { halign: "right" }, 8: { halign: "right" },
      },
    });

    const finalY = (doc as any).lastAutoTable.finalY || 200;
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(
      "Parish tax is collected & remitted by Helpr LLC as a Louisiana marketplace facilitator. " +
        "Net payout shown before tips. For tax-prep — provide this statement to your CPA.",
      40,
      finalY + 24,
      { maxWidth: 720 }
    );

    doc.save(`helpr-earnings-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
          <Receipt className="w-3.5 h-3.5" />
          Tax Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            Earnings Export
          </DialogTitle>
          <DialogDescription>
            Download by parish & tax status. Hand straight to your CPA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-semibold text-foreground mb-2 block">Date Range</label>
            <Select value={mode} onValueChange={(v) => setMode(v as RangeMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ytd">Year-to-Date</SelectItem>
                <SelectItem value="month">Specific Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "month" && (
            <div>
              <label className="text-xs font-semibold text-foreground mb-2 block">Month</label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-foreground mb-2 block">From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !customStart && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customStart ? format(customStart, "MMM d, yyyy") : "Start"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customStart} onSelect={setCustomStart} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-2 block">To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !customEnd && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customEnd ? format(customEnd, "MMM d, yyyy") : "End"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} initialFocus className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button onClick={() => handleExport("csv")} disabled={busy} variant="outline" className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Download CSV
            </Button>
            <Button onClick={() => handleExport("pdf")} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Download PDF
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Includes date, job, category, parish, taxable/exempt status, gross budget, platform fee,
            parish tax collected, and net payout. Tips are tracked separately.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
