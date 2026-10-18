import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";
import { fetchFixedAnswerForJob } from "@/lib/rentals/api";
import { fmtDate } from "./rentalsUi";

/**
 * Rentals: on the landlord's release decision (CompletionChoiceSheet), the
 * tenant's latest "Was it fixed?" answer for the repair request this job was
 * posted from (owner Q42; lh-money-escrow review of 3e84eea25 #6: it showed
 * only on /rentals/requests/:id, so "the landlord sees it before confirming"
 * depended on them opening that page). Renders nothing for a job that came
 * from no request, before the tenant answers, while the 'rentals' switch is
 * off, and on a failed read (the decision does not depend on it, and it is
 * never wired into release).
 */
export default function TenantFixedAnswer({ jobId, userId }: { jobId: string; userId: string }) {
  const on = useFeature("rentals");
  const q = useQuery({
    queryKey: ["rentals", "fixed-answer", jobId, userId],
    enabled: on,
    queryFn: () => fetchFixedAnswerForJob(jobId, userId),
  });
  const a = q.data;
  if (!on || !a) return null;
  return (
    <div
      role="status"
      className="rounded-xl border p-3 mt-3 font-sans text-ds-13 leading-snug"
      style={{ borderColor: a.saysFixed ? "hsl(var(--border))" : "hsl(var(--destructive) / 0.5)" }}
    >
      <p className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        {a.saysFixed ? "Your tenant says it's fixed" : "Your tenant says it's NOT fixed"}
      </p>
      <p style={{ color: "hsl(var(--olivewood))" }}>
        Answered {fmtDate(a.answeredAt)}{a.note ? `: "${a.note}"` : "."}{" "}
        <Link className="underline" to={`/rentals/requests/${a.requestId}`}>See the request</Link>
      </p>
    </div>
  );
}
