/** Types for scripts/probes/unsubscribe-get-redirects.mjs (Q1655). */
export function gradeUnsubscribeGet(answer: {
  status: number;
  location: string | null;
  contentType: string | null;
  body: string | null;
}): string[];
