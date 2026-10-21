import { HandCoins } from "lucide-react";
import { JobActionChip } from "@/components/job-card/JobActionRow";
import { isWaiting } from "@/lib/refundRequests";
import { useRefundRequest } from "./refundParts";

/**
 * Board 141: the poster's "Ask for a refund" on the job's row. Rendered only
 * where the switch is on and the job is one a request can be on
 * (canAskForRefund); it stands down while a request already waits on the
 * Helpr or on Helpr's decision (that request's state shows below the row,
 * RefundRequestPanel). The sheet it opens lives in the step's `dialogs` slot,
 * because the row's More panel unmounts this chip when it closes.
 */
export function RefundAskChip({ jobId, onOpen }: { jobId: string; onOpen: () => void }) {
  const { data: latest, isSuccess } = useRefundRequest(jobId, true);
  if (!isSuccess || (latest && isWaiting(latest))) return null;
  return (
    <JobActionChip
      icon={HandCoins}
      label="Ask for a refund"
      ariaLabel="Ask for a refund — ask the Helpr for part or all of the money back"
      tone="neutral"
      onClick={onOpen}
    />
  );
}
