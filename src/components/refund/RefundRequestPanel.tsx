import { lazy, Suspense, useState, type ReactNode } from "react";
import { HandCoins } from "lucide-react";
import { useRefundsOn } from "./RefundsSwitch";
import { formatName } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { isWaiting, refundPartTotalCents, refundRushBackCents, withdrawRefundRequest, type RefundJob } from "@/lib/refundRequests";
import { Money, answerByLabel, useRefundRequest } from "./refundParts";

const RefundAnswerDialog = lazy(() => import("./RefundAnswerDialog").then((m) => ({ default: m.RefundAnswerDialog })));

/**
 * Board 141: where a job's refund request stands, on both parties' cards
 * (the person who asked, and the Helpr asked: a person, not a role). Below the
 * job's own row, like the date-change request (ScheduleChangeControl), and
 * only while there is something to say. The Helpr answers from here; the
 * poster asks from the job's action row (InProgressStep). Behind the
 * refund_requests switch (testers until the owner opens it).
 */
export function RefundRequestPanel({
  job,
  userId,
  otherName,
  feeFallbackPercent,
  expanded,
}: {
  job: RefundJob & { title: string };
  userId: string;
  /** The other person on the job, as stored; shown as "First L.". */
  otherName: string | null | undefined;
  /** The Helpr's own fee rate when the job has no stamp (their tier). The
   *  Helpr's card passes it; the poster's card never answers, so passes null. */
  feeFallbackPercent: number | null;
  expanded: boolean;
}) {
  const on = useRefundsOn();
  const party = job.customer_id === userId || job.helper_id === userId;
  // Nothing below runs (no read, no query cache needed) unless the switch is
  // on for this viewer and the card is open on a job with a Helpr.
  if (!on || !expanded || !party || !job.helper_id) return null;
  return <RefundRequestPanelOpen job={job} userId={userId} otherName={otherName} feeFallbackPercent={feeFallbackPercent} />;
}

function RefundRequestPanelOpen({
  job,
  userId,
  otherName,
  feeFallbackPercent,
}: {
  job: RefundJob & { title: string };
  userId: string;
  otherName: string | null | undefined;
  feeFallbackPercent: number | null;
}) {
  const { data: request } = useRefundRequest(job.id, true);
  const [answering, setAnswering] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const queryClient = useQueryClient();
  const withdraw = async () => {
    if (!request || withdrawing) return;
    setWithdrawing(true);
    try {
      await withdrawRefundRequest(request.id);
      toast("Withdrawn. Nothing changes on the payment.");
      try {
        await queryClient.invalidateQueries({ queryKey: ["refund-request", job.id] });
      } catch (refreshErr) {
        // The request IS withdrawn; a stale card is recoverable, a false failure is not.
        report(refreshErr, { tags: { source: "RefundRequestPanel.refresh" }, context: { jobId: job.id } });
      }
    } catch (err) {
      toast.error(userFacingError(err, "We couldn't withdraw that. Check your connection and try again."));
    } finally {
      setWithdrawing(false);
    }
  };
  if (!request) return null;

  const asked = request.requester_id === userId;
  const askedOfMe = request.responder_id === userId;
  const other = formatName(otherName, asked ? "Your Helpr" : "The person who posted it");
  const settled = job.payment_status === "released" || job.payment_status === "refunded";
  const dueOpen = request.status === "open" && Date.parse(request.answer_by) > Date.now();
  // Owner 2026-10-21: an agreed part also returns the same share of the rush fee.
  const rushBack = refundRushBackCents(job, request);
  const partTotal = refundPartTotalCents(job, request);

  let line: ReactNode = null;
  if (askedOfMe && dueOpen) {
    line = (
      <>
        {other} asked for <Money cents={request.amount_cents} /> back: “{request.reason}” Answer by {answerByLabel(request.answer_by)}, or it
        goes to Helpr to decide.
      </>
    );
  } else if (asked && request.status === "open") {
    line = (
      <>
        You asked {other} for <Money cents={request.amount_cents} /> back. {other} has until {answerByLabel(request.answer_by)} to answer, or
        Helpr decides.
      </>
    );
  } else if (request.status === "agreed" && !settled) {
    line = asked ? (
      <>
        {request.refund_scope === "all" ? (
          <>
            {other} agreed to refund all of it. Most of what you paid is on its way back to how you paid.
            Your receipt shows the exact amount.
          </>
        ) : (
          <>
            {other} agreed to your refund: <Money cents={partTotal} /> is on its way back to how you paid
            {rushBack > 0 ? <> (<Money cents={request.amount_cents} /> of the price and <Money cents={rushBack} /> of the rush fee)</> : null}.
          </>
        )}
      </>
    ) : (
      request.refund_scope === "all" ? (
        <>You agreed to refund all of it. You're paid nothing for this job.</>
      ) : (
        <>
          You agreed to give back <Money cents={partTotal} />
          {rushBack > 0 ? <> (<Money cents={request.amount_cents} /> of the price and <Money cents={rushBack} /> of the rush fee)</> : null}. You take home your pay on the rest.
        </>
      )
    );
  } else if (request.status === "agreed" && settled) {
    line = asked ? (
      <>The refund {other} agreed to has been sent back to how you paid.</>
    ) : (
      <>The refund you agreed to is settled.</>
    );
  } else if (isWaiting(request) && request.status === "declined") {
    line = asked ? (
      <>{other} didn't agree to the refund. A real person at Helpr will decide; the payment stays on hold until then.</>
    ) : (
      <>You didn't agree to the refund. A real person at Helpr will decide; the payment stays on hold until then.</>
    );
  } else if (request.status === "finish_offered" && !settled) {
    line = asked ? (
      <>
        {other} offered to come back and finish instead of a refund. Accept the new time on this job, or decline it and a real person
        at Helpr will decide. The payment stays on hold until then.
      </>
    ) : (
      <>You offered to come back and finish instead of a refund. The payment stays on hold until they answer.</>
    );
  } else if (request.status === "coming_back") {
    line = asked ? (
      <>You accepted. {other} is coming back to finish at the new time.</>
    ) : (
      <>They accepted. Come back at the new time, then mark the job done again.</>
    );
  }
  if (!line) return null;
  // The poster can take back a request still waiting (open, or declined
  // before Helpr's decision is filed): nothing moves either way.
  const canWithdraw = asked && isWaiting(request);

  return (
    <div className="px-4 py-2 border-t border-border/20 space-y-2" data-refund-request="" onClick={(e) => e.stopPropagation()}>
      <p className="font-sans text-ds-12 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
        <HandCoins className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden style={{ color: "hsl(var(--bark))" }} />
        {line}
      </p>
      {canWithdraw && (
        <button
          type="button"
          disabled={withdrawing}
          onClick={() => void withdraw()}
          // SECONDARY, as Answer below: the card's ONE primary stays the job's own move.
          className="min-h-[44px] px-4 rounded-full font-sans text-ds-13 font-semibold border border-border disabled:opacity-40"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {withdrawing ? "Withdrawing…" : "Withdraw request"}
        </button>
      )}
      {askedOfMe && dueOpen && feeFallbackPercent !== null && (
        <>
          <button
            type="button"
            onClick={() => setAnswering(true)}
            // SECONDARY, never the solid primary: this block sits under a card
            // whose ONE primary is the job's own next move (as the date-change
            // request's Accept / Decline do; src/test/offerCardHierarchy.test.tsx).
            className="min-h-[44px] px-4 rounded-full font-sans text-ds-13 font-semibold border"
            style={{ color: "hsl(var(--primary))", borderColor: "hsl(var(--primary) / 0.35)" }}
          >
            Answer
          </button>
          {answering && (
            <Suspense fallback={null}>
              <RefundAnswerDialog
                open={answering}
                onOpenChange={setAnswering}
                job={job}
                request={request}
                posterName={other}
                feeFallbackPercent={feeFallbackPercent}
                userId={userId}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
