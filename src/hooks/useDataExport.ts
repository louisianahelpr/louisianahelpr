import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticError } from "@/lib/haptics";
import { saveOrShareFile } from "@/lib/fileExport";
import { functionInvokeError } from "@/lib/supabaseResult";
import { toast } from "sonner";

/**
 * GDPR Art. 20 / CCPA data portability: put the signed-in account's data in one
 * JSON file and hand it to the platform (download on the web, share sheet on
 * native).
 *
 * Shared by the Privacy policy's DataExportCard and the Settings row "Download
 * my data" (A3-I4, app audit 2026-10-28: the row used to open the whole Privacy
 * policy to reach the card's button; it now downloads directly). One copy of
 * the call, the file name and the failure handling, so the two entry points
 * cannot drift.
 *
 * One server call for the whole account (Q290). The edge function runs
 * export_my_data() as this user (every table with a column that references a
 * person; the list is guarded two-way against the schema by
 * src/test/dataExportCoversEveryUserTable.test.ts) and adds signed links to the
 * person's stored files. It fails closed: an error, never a file that silently
 * leaves part of the account out.
 */
export function useDataExport(userId: string | null | undefined) {
  const [exporting, setExporting] = useState(false);
  // A second tap while the first export runs is ignored (state updates are async).
  const running = useRef(false);

  const startExport = useCallback(async () => {
    if (!userId || running.current) return;
    running.current = true;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-my-data");
      if (error) throw await functionInvokeError(error);
      if (!data || typeof data !== "object" || !("exported_at" in data)) {
        throw new Error("export-my-data returned no export");
      }
      const payload = { ...(data as Record<string, unknown>) };

      // `saveOrShareFile`, never `<a download>` + blob URL: WKWebView honours
      // neither, so on iOS the old handoff fetched every row and produced no
      // file. It picks the route the platform supports (native: share a real
      // `file://`; web: the anchor download) and toasts on every failure path.
      // See src/lib/fileExport.ts.
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const ok = await saveOrShareFile({
        blob,
        filename: `helpr-data-export-${new Date().toISOString().split("T")[0]}.json`,
        label: "your data export",
        source: "LegalTab.exportData",
      });
      // saveOrShareFile owns the failure toast and telemetry; a cancelled
      // share sheet also lands here and stays silent, which is correct.
      if (!ok) hapticError();
    } catch (err) {
      // Tag kept as `LegalTab.exportData` so existing error dashboards and
      // alerts keep matching after the move.
      report(err, { tags: { source: "LegalTab.exportData" } });
      hapticError();
      toast.error("We couldn't put your data together just now — try again or email support.");
    } finally {
      running.current = false;
      setExporting(false);
    }
  }, [userId]);

  return { exporting, startExport };
}
