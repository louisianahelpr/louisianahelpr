import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHero, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { FileSpreadsheet, FileText, CalendarIcon, Loader2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { formatCategory } from "@/lib/format";
// jsPDF + jspdf-autotable are ~450KB combined; load only when user clicks PDF export.
import type jsPDFType from "jspdf";

// react-day-picker (the Calendar's dependency) only renders inside the
// tap-to-open date popovers below — defer its chunk until one opens.
const Calendar = lazy(() =>
  import("@/components/ui/calendar").then((m) => ({ default: m.Calendar })),
);

const calendarFallback = (
  <Skeleton className="h-[19rem] w-[17rem] rounded-2xl" aria-hidden />
);

interface EarningsExportProps {
  helperId: string;
  helperName: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
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

type CSVValue = string | number | null | undefined;
type JsPDFWithAutoTable = jsPDFType & { lastAutoTable?: { finalY?: number } };

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Export failed";

export const EarningsExport = ({ helperId, helperName, open: controlledOpen, onOpenChange, hideTrigger }: EarningsExportProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };
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
    if (error) {
      // The RPC ships in a migration that may not be pushed to production
      // yet (migrations don't auto-deploy). Surface a friendly message
      // instead of Postgres's cryptic "function not found" error.
      if (error.code === "PGRST202") {
        throw new Error("Earnings export isn't available just yet. Please try again soon.");
      }
      throw error;
    }
    return (data || []) as ExportRow[];
  };

  const handleExport = async (formatType: "csv" | "pdf") => {
    const range = resolveRange();
    if (!range) return;
    setBusy(true);
    try {
      const rows = await fetchRows(range.start, range.end);
      if (!rows.length) {
        return;
      }
      if (formatType === "csv") downloadCSV(rows, range.label);
      else await downloadPDF(rows, range.label);
      setOpen(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadCSV = (rows: ExportRow[], label: string) => {
    const escape = (v: CSVValue) => {
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

  const downloadPDF = async (rows: ExportRow[], label: string) => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
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
        formatCategory(r.category),
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

    const finalY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY || 200;
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
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 text-ds-11 gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            Tax Export
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHero
          eyebrow={
            <>
              <Receipt className="w-3 h-3" /> Tax export
            </>
          }
          title="Earnings Export"
        />

        <div className="space-y-4 py-2">
          <div>
            <label className="text-ds-11 font-semibold text-foreground mb-2 block">Date Range</label>
            <Select value={mode} onValueChange={(v) => setMode(v as RangeMode)}>
              <SelectTrigger aria-label="Date Range"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ytd">Year-to-Date</SelectItem>
                <SelectItem value="month">Specific Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "month" && (
            <div>
              <label className="text-ds-11 font-semibold text-foreground mb-2 block">Month</label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
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
                <label className="text-ds-11 font-semibold text-foreground mb-2 block">From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !customStart && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customStart ? format(customStart, "MMM d, yyyy") : "Start"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Suspense fallback={calendarFallback}>
                      <Calendar mode="single" selected={customStart} onSelect={setCustomStart} autoFocus className={cn("p-3 pointer-events-auto")} />
                    </Suspense>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-ds-11 font-semibold text-foreground mb-2 block">To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !customEnd && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customEnd ? format(customEnd, "MMM d, yyyy") : "End"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Suspense fallback={calendarFallback}>
                      <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} autoFocus className={cn("p-3 pointer-events-auto")} />
                    </Suspense>
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

          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Includes date, job, category, parish, taxable/exempt status, gross budget, platform fee,
            parish tax collected, and net payout. Tips are tracked separately.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
