import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHero, DialogFooter, DialogPrimaryAction, DialogSecondaryAction } from "@/components/ui/dialog";
import { RadioCardList, type RadioCardOption } from "@/components/ui/RadioCardList";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import {
  answerRefundRequest,
  canOfferToFinish,
  latestComeBackDate,
  refundRushBackCents,
  refundTakeHomeDollars,
  type RefundAnswer,
  type RefundJob,
  type RefundRequest,
} from "@/lib/refundRequests";
import { Money, RefundJobSummary, answerByLabel, firstNameOf } from "./refundParts";

const DATE_TIME_FIELD =
  "block w-full min-w-0 appearance-none min-h-[44px] rounded-[14px] border border-border px-3 py-2.5 bg-background text-left [&::-webkit-date-and-time-value]:text-left";

/**
 * Board 141, Helpr side: "Refund request". Agree (the money moves on its own:
 * the refund back to how they paid, the rest to you after your fee), Come back
 * and finish (offered only where the existing date/time request can be sent:
 * a booked job not started yet), or I don't agree (Helpr decides). The
 * take-home shown is the split's own arithmetic
 * (src/test/refundRequestTakeHome.test.ts).
 */
export function RefundAnswerDialog({
  open,
  onOpenChange,
  job,
  request,
  posterName,
  feeFallbackPercent,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: RefundJob & { title: string };
  request: RefundRequest;
  /** The person who posted it, "First L.". */
  posterName: string;
  /** The Helpr's own fee rate when the job has no stamp (their tier). */
  feeFallbackPercent: number;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<"" | RefundAnswer>("");
  const [date, setDate] = useState(job.date_needed ?? "");
  const [time, setTime] = useState((job.start_time ?? "").slice(0, 5));
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const first = firstNameOf(posterName);
  const takeHome = refundTakeHomeDollars(job, request, feeFallbackPercent);
  // Owner 2026-10-21: an agreed part also returns the same share of the rush fee.
  const rushBack = refundRushBackCents(job, request);
  const finishOffered = canOfferToFinish(job);
  const latestDate = latestComeBackDate();
  const finishReady =
    answer !== "finish" ||
    (!!date && date <= latestDate && !(date === job.date_needed && time === (job.start_time ?? "").slice(0, 5)));

  const options: RadioCardOption[] = [
    {
      value: "agree",
      label: <>Agree · refund <Money cents={request.amount_cents + rushBack} /></>,
      sub: request.refund_scope === "all"
        ? "All of it goes back. You're paid nothing for this job."
        : rushBack > 0
          ? <>That is <Money cents={request.amount_cents} /> of the price and <Money cents={rushBack} /> of the rush fee. You take home the rest: <Money>${takeHome}</Money></>
          : <>You take home the rest: <Money>${takeHome}</Money></>,
    },
    ...(finishOffered
      ? [{ value: "finish", label: "Come back and finish", sub: "Offer a time instead of a refund" }]
      : []),
    { value: "decline", label: "I don't agree", sub: "A real person at Helpr will decide" },
  ];

  const close = () => {
    if (!sending) onOpenChange(false);
  };

  const send = async () => {
    if (sendingRef.current || !answer || !finishReady) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const status = await answerRefundRequest(request.id, answer, answer === "finish" ? { date, time: time || null } : null);
      hapticSuccess();
      toast(
        status === "agreed"
          ? `Agreed. ${first} gets the refund and you take home your pay on the rest.`
          : status === "finish_offered"
          ? `Sent. ${first} can accept or decline the new time.`
          : "Sent. A real person at Helpr will decide.",
      );
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["refund-request", request.job_id] }),
          queryClient.invalidateQueries({ queryKey: ["schedule-change", request.job_id] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(userId) }),
        ]);
      } catch (refreshErr) {
        // The answer IS recorded; a stale card is recoverable, a false failure is not.
        report(refreshErr, { tags: { source: "RefundAnswerDialog.refresh" }, context: { jobId: request.job_id } });
      }
      onOpenChange(false);
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "We couldn't send your answer. Check your connection and try again."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title="Refund request" />
        <div className="space-y-3.5">
          <RefundJobSummary title={job.title} who={posterName} dateNeeded={job.date_needed} priceCents={request.budget_cents} />

          <div className="rounded-[20px] border border-border bg-card px-4 py-3" data-refund-ask="">
            <p className="font-sans text-ds-14 leading-relaxed" style={{ color: "hsl(var(--ink-deep))" }}>
              {first} asked for <Money cents={request.amount_cents} /> back: “{request.reason}”
            </p>
          </div>

          <RadioCardList required label="Your answer" options={options} value={answer} onChange={(v) => setAnswer(v as RefundAnswer)} />

          {answer === "finish" && (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <label className="min-w-0 space-y-1 font-sans text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
                <span className="block font-semibold">Date</span>
                <input type="date" value={date} max={latestDate} onChange={(e) => setDate(e.target.value)} className={`${DATE_TIME_FIELD} min-w-0`} />
              </label>
              <label className="min-w-0 space-y-1 font-sans text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
                <span className="block font-semibold">Start time</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${DATE_TIME_FIELD} min-w-0`} />
              </label>
            </div>
          )}

          <p className="font-sans text-ds-12 leading-relaxed text-muted-foreground">
            Answer by {answerByLabel(request.answer_by)} or it goes to Helpr to decide.
          </p>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={close} disabled={sending}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={send} disabled={sending || !answer || !finishReady}>
            {sending ? "Sending…" : "Send answer"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
