import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatJobDate } from "@/lib/dateUtils";
import { fetchLatestRefundRequest, refundDollars } from "@/lib/refundRequests";

/**
 * Board 141 shared pieces: the job summary card at the top of both refund
 * sheets, money in rust, and the one cached read of a job's refund request.
 * Spec v2: rust is money only, sentence case, members as "First L.".
 */

/** The job's newest refund request the viewer can read, one cache key for every reader. */
export function useRefundRequest(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["refund-request", jobId],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchLatestRefundRequest(jobId),
  });
}

/** An amount, in the money ink (spec v2 §1.1). */
export function Money({ cents, children }: { cents?: number; children?: ReactNode }) {
  return (
    <span className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">
      {children ?? refundDollars(cents ?? 0)}
    </span>
  );
}

/** "Lexi" from "Lexi L." (a first name for the button: "Send to Jolie"). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Board 141's top card: which job, with whom, when, and its price. */
export function RefundJobSummary({
  title,
  who,
  dateNeeded,
  priceCents,
}: {
  title: string;
  who: string;
  dateNeeded: string | null | undefined;
  priceCents: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0 rounded-[20px] border border-border bg-card px-4 py-3" data-refund-job-summary="">
      <div className="min-w-0">
        <p className="truncate font-sans text-ds-15 font-bold" style={{ color: "hsl(var(--ink-deep))" }} title={title}>
          {title}
        </p>
        <p className="truncate font-sans text-ds-12 text-muted-foreground">
          {who}
          {dateNeeded ? ` · ${formatJobDate(dateNeeded)}` : ""}
        </p>
      </div>
      <span className="shrink-0 font-sans text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">
        {refundDollars(priceCents)}
      </span>
    </div>
  );
}

/** "Thu, Oct 23, 10:41 AM" in Louisiana time: when the answer is due. */
export function answerByLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}
