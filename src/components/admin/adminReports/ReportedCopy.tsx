/**
 * What a report kept of the thing reported, as it read when it was reported (the database copies it on insert, so it
 * stays even after the thing is edited or deleted): a message's words, or a Declutter question with its answer (B48,
 * owner decision 10-31, App Store 1.2). A question or answer report also offers the take-down: "Remove Question" takes
 * the whole entry off the listing, "Remove Answer" only the seller's answer; the report resolves and the server logs it
 * (declutter_admin_remove_question). Moved out of AdminReports.tsx (size ratchet).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeReportedQuestion } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const LABEL: Record<string, string> = {
  message: "Reported message: ",
  declutter_question: "Reported question: ",
  declutter_answer: "Reported answer: ",
};

export function ReportedCopy({ report, onDone, gone = false }: {
  report: { id: string; reported_type: string; reported_id: string; reported_content?: string | null; status: string };
  onDone: () => void;
  /** The question is already off the listing (removed): nothing left to take down. */
  gone?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const label = LABEL[report.reported_type];
  if (!label || !report.reported_content) return null;
  const open = report.status !== "resolved" && report.status !== "dismissed";
  const remove = async (part: "question" | "answer") => {
    setBusy(true);
    try {
      await removeReportedQuestion(report.reported_id, part, report.id);
      toast(part === "question" ? "Question removed. The report is resolved." : "Answer removed. The report is resolved.");
      onDone();
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-ds-sm bg-muted/50 p-3 text-ds-11" data-reported-copy={report.reported_type}>
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">{label}</span>{report.reported_content}</p>
      {gone && LABEL[report.reported_type] && report.reported_type !== "message" && <p className="font-semibold">This question was removed.</p>}
      {report.reported_type !== "message" && open && !gone && (
        <div className="flex flex-wrap gap-2">
          {report.reported_type === "declutter_answer" && (
            <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" disabled={busy} onClick={() => remove("answer")}>
              Remove Answer
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" disabled={busy} onClick={() => remove("question")}>
            Remove Question
          </Button>
        </div>
      )}
    </div>
  );
}
