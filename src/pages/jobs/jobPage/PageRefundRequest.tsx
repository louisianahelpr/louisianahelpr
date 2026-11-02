import { RefundRequestPanel } from "@/components/refund/RefundRequestPanel";
import { RefundsSwitchProvider } from "@/components/refund/RefundsSwitch";
import type { RefundJob } from "@/lib/refundRequests";

/**
 * Q2694 (Jobs stages audit 1102e row 6): an open refund request on the job page itself, for both parties: the amount,
 * the reason, the answer-by and the Helpr's Answer (the cards' own RefundRequestPanel). The job lists read the
 * refund_requests switch once around themselves (RefundsSwitchProvider in JobsSection), and the page sat outside that,
 * so it never showed a request: the Helpr who had 23 h to answer read only "Lexi has until ... to check it".
 * The panel renders nothing (no DOM at all, so the page's empty main column still collapses) with the switch off, with
 * no request, or for anyone but the job's two parties. Guard: src/test/jobPageShowsRefundRequest.test.tsx.
 */
export function PageRefundRequest({
  job,
  userId,
  otherName,
  feeFallbackPercent,
}: {
  job: RefundJob & { title: string };
  userId: string;
  /** The other person on the job, as stored ("First L." is drawn from it). */
  otherName: string | null | undefined;
  /** The Helpr's own fee rate for an unstamped job; null for the poster, who never answers. */
  feeFallbackPercent: number | null;
}) {
  return (
    <RefundsSwitchProvider>
      <RefundRequestPanel job={job} userId={userId} otherName={otherName} feeFallbackPercent={feeFallbackPercent} expanded
        boxClassName="rounded-2xl border border-border bg-card p-4 space-y-2" />
    </RefundsSwitchProvider>
  );
}
