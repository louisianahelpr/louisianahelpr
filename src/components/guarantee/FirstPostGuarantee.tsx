import { GuaranteePromise } from "./GuaranteePromise";

/**
 * "First job, easy yes" (owner-approved growth item, B59): on a member's FIRST
 * post, Review says plainly that the job is covered by the Helpr Guarantee.
 * Only when we know they have never posted (usePostJobForm's isFirstPost:
 * unknown counts as not first), and only for a one-Helpr job, the kind the
 * guarantee covers.
 */
export function FirstPostGuarantee({ oneHelpr, firstPost }: { oneHelpr: boolean; firstPost: boolean }) {
  if (!oneHelpr || !firstPost) return null;
  return <GuaranteePromise />;
}
