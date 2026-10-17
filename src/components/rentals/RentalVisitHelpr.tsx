import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeature } from "@/hooks/useFeature";
import { fetchVisitForJob, proposeVisit } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { fmtDate } from "./rentalsUi";

/**
 * Rentals (owner Q41, "the tenant OKs the visit time the Helpr offers"): on the
 * hired Helpr's expanded job card, for a job posted from a repair request, the
 * Helpr offers a visit time and sees whether the tenant OK'd it. Loaded lazily
 * by AppliedJobCard (off /posts' shared chunk). Renders nothing while the
 * 'rentals' switch is off, for a job that came from no request, and on a failed
 * read (the job itself does not depend on it). The server decides who may
 * offer (rentals_propose_visit: the job's Helpr, funded, not finished).
 */
export default function RentalVisitHelpr({ jobId }: { jobId: string }) {
  const on = useFeature("rentals");
  const qc = useQueryClient();
  const [when, setWhen] = useState("");
  const q = useQuery({ queryKey: ["rentals", "visit", jobId], enabled: on, queryFn: () => fetchVisitForJob(jobId) });
  const offer = useMutation({
    mutationFn: () => proposeVisit(jobId, new Date(when).toISOString()),
    onSuccess: () => {
      setWhen("");
      void qc.invalidateQueries({ queryKey: ["rentals", "visit", jobId] });
    },
    onError: (e: unknown) => toast.error(rentalsErrorMessage(e)),
  });
  const v = q.data;
  if (!on || !v) return null;
  return (
    <section aria-label="Visit time" className="rounded-ds-sm bg-secondary/30 p-2 min-w-0 space-y-1.5">
      <p className="text-ds-11 text-foreground">
        {v.proposedFor
          ? v.confirmedAt
            ? `Rental repair: the tenant OK'd ${fmtDate(v.proposedFor)}.`
            : `Rental repair: you offered ${fmtDate(v.proposedFor)}. Waiting for the tenant to OK it.`
          : "Rental repair: offer the tenant a visit time."}
      </p>
      <div className="flex gap-2 items-center">
        <Input
          type="datetime-local"
          aria-label="Visit time to offer"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="h-8 text-ds-11"
        />
        <Button type="button" size="sm" disabled={!when || offer.isPending} onClick={() => offer.mutate()}>
          {v.proposedFor ? "Offer a new time" : "Offer this time"}
        </Button>
      </div>
    </section>
  );
}
