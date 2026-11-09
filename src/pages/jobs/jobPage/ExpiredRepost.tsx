import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { isExpiredListing } from "@/lib/expiredListing";

/**
 * F116 (owner UI audit 11-09, /jobs/:id of an expired listing at 1440: "The bottom card is a large empty white box
 * holding only a right-aligned 'Post this job again' button. Put the button directly under 'No Helpr was hired in
 * time', left-aligned"). On the desktop website the poster's expired listing draws its one action inside the status
 * card, under the line, left-aligned, and the side card's row is not drawn (it held nothing else). On a phone the
 * page keeps its one sticky action bar (owner pick 11-08, JP2). Guard: src/pages/jobs/jobPage/expiredRepost.test.tsx.
 */
export function useExpiredRepost(
  job: { id: string; status?: string | null; helper_id?: string | null; cancellation_reason?: string | null; cancelled_by?: string | null } | undefined,
  isPoster: boolean,
): { inline: ReactNode; hideRow: boolean } {
  const navigate = useNavigate();
  const desktop = useIsWebDesktop();
  const { gate, gatedProps } = useAgeGate();
  if (!job || !isPoster || !desktop || !isExpiredListing(job)) return { inline: null, hideRow: false };
  const go = gate("post", () => navigate(`/post-job?rebook=${encodeURIComponent(job.id)}`));
  return {
    hideRow: true,
    inline: (
      <div data-expired-repost="" className="flex justify-start">
        <Button type="button" variant="primary" size="lg" className="rounded-full px-6 text-ds-16" onClick={go} {...gatedProps("post")}>
          Post this job again
        </Button>
      </div>
    ),
  };
}
