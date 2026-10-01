import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { saveOrShareFile } from "@/lib/fileExport";
import { buildPayoutsCsv } from "@/components/profile/earningsTab/earningsTabHelpers";
import type { StripePayout } from "@/components/profile/earningsTab/types";

/** CSV export (1099 / tax prep) of the Stripe payouts, one calendar year at a time. */
export function usePayoutsCsvExport(payouts: StripePayout[] | undefined) {
  const payoutYears = useMemo(() => {
    const years = new Set<number>();
    (payouts ?? []).forEach((p) => years.add(new Date(p.arrival_date * 1000).getFullYear()));
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [payouts]);

  const [exportYear, setExportYear] = useState<string>(String(new Date().getFullYear()));

  useEffect(() => {
    if (payoutYears.length && !payoutYears.includes(Number(exportYear))) {
      setExportYear(String(payoutYears[0]));
    }
  }, [payoutYears, exportYear]);

  const handleExportCSV = async () => {
    const year = Number(exportYear);
    const { rows, csv } = buildPayoutsCsv(payouts ?? [], year);

    if (!rows.length) {
      toast("No payouts to export", { description: `No payouts found for ${year}.` });
      return;
    }

    // Was `URL.createObjectURL` + `<a download>` + click, inline in EarningsTab.
    // That idiom is a silent no-op in WKWebView — the tap did nothing at all in
    // the shipped app (owner: "Download csv pdf etc does not work").
    // saveOrShareFile keeps the anchor on web and routes native through the OS
    // share sheet, and toasts on every outcome. See src/lib/fileExport.ts.
    // It owns the messaging, so there is no separate "Export ready" toast
    // (which toastPolicy.ts would suppress anyway); what matters is that a
    // FAILURE is stated.
    await saveOrShareFile({
      blob: new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      filename: `helpr-payouts-${year}.csv`,
      label: `your ${year} payouts CSV`,
    });
  };

  return { payoutYears, exportYear, setExportYear, handleExportCSV };
}
