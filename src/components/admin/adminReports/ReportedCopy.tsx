/**
 * What a report kept of the thing reported, as it read when it was reported (the database copies it on insert, so it
 * stays even after the thing is edited or deleted): a message's words, a Declutter question with its answer (B48,
 * owner decision 10-31, App Store 1.2), or a Declutter review's stars and words (A3-75, audit 11-01). A question or
 * answer report also offers the take-down: "Remove Question" takes the whole entry off the listing, "Remove Answer"
 * only the seller's answer (declutter_admin_remove_question); a review report offers "Remove Review", which takes it
 * off the member's profile and out of their rating (declutter_admin_remove_review). The report resolves and the server
 * logs it. Q1948 (L46): a Shops review report offers the same "Remove Review" (shops_admin_remove_review), which
 * takes it off the shop's page and out of the shop's rating. Moved out of AdminReports.tsx (size ratchet).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeReportedQuestion, removeReportedReview } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { removeReportedShopReview } from "@/lib/shops/reviews";

const LABEL: Record<string, string> = {
  message: "Reported message: ",
  declutter_question: "Reported question: ",
  declutter_answer: "Reported answer: ",
  declutter_review: "Reported review: ",
  shop_review: "Reported shop review: ",
  // Q2209: a Homes chat message (20261106191100 keeps the listing headline and the words, never a name).
  home_talk_message: "Reported Homes message: ",
};

type Part = "question" | "answer" | "review";
const DONE: Record<Part, string> = {
  question: "Question removed. The report is resolved.",
  answer: "Answer removed. The report is resolved.",
  review: "Review removed. The report is resolved.",
};

export function ReportedCopy({ report, onDone, gone = false }: {
  report: { id: string; reported_type: string; reported_id: string; reported_content?: string | null; status: string };
  onDone: () => void;
  /** The question or review is already removed: nothing left to take down. */
  gone?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const label = LABEL[report.reported_type];
  if (!label || !report.reported_content) return null;
  const open = report.status !== "resolved" && report.status !== "dismissed";
  const isShopReview = report.reported_type === "shop_review";
  const isReview = report.reported_type === "declutter_review" || isShopReview;
  // Only a Declutter question, answer or review, or a Shops review, can be taken down from here; a message's copy is read-only.
  const removable = report.reported_type.startsWith("declutter_") || isShopReview;
  const remove = async (part: Part) => {
    setBusy(true);
    try {
      if (part === "review" && isShopReview) await removeReportedShopReview(report.reported_id, report.id);
      else if (part === "review") await removeReportedReview(report.reported_id, report.id);
      else await removeReportedQuestion(report.reported_id, part, report.id);
      toast(DONE[part]);
      onDone();
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const removeButton = (part: Part, text: string) => (
    <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" disabled={busy} onClick={() => remove(part)}>
      {text}
    </Button>
  );
  return (
    <div className="space-y-2 rounded-ds-sm bg-muted/50 p-3 text-ds-11" data-reported-copy={report.reported_type}>
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">{label}</span>{report.reported_content}</p>
      {gone && removable && <p className="font-semibold">{isReview ? "This review was removed." : "This question was removed."}</p>}
      {removable && open && !gone && (
        <div className="flex flex-wrap gap-2">
          {isReview ? removeButton("review", "Remove Review") : (
            <>
              {report.reported_type === "declutter_answer" && removeButton("answer", "Remove Answer")}
              {removeButton("question", "Remove Question")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
