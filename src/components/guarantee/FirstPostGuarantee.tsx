import { useRecentPostedJobs, usePostedBefore } from "@/hooks/useRecentPostedJobs";
import { GuaranteePromise } from "./GuaranteePromise";

/**
 * "First job, easy yes" (owner-approved growth item, B59): on a member's FIRST
 * post, Review says plainly that the job is covered by the Helpr Guarantee.
 * Only when we know they have never posted (postedBefore === false; unknown
 * shows nothing), and only for a one-Helpr job, the kind the guarantee covers.
 * Same 3-row query and cache key as Post a job's entry screen.
 */
export function FirstPostGuarantee({ oneHelpr }: { oneHelpr: boolean }) {
  const recent = useRecentPostedJobs(3);
  const postedBefore = usePostedBefore(recent);
  if (!oneHelpr || postedBefore !== false) return null;
  return <GuaranteePromise />;
}
