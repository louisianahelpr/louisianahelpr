import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { AUTO_COMPLETE_HOURS } from "../../../supabase/functions/_shared/escrowTiming";

/** What the Helpr's Done tap hands the sheet: when it was marked. */
type DoneMoment = { jobId: string; at: string };

// One host at a time (the Activity page mounts it). With no host mounted the tracker keeps
// its old toast, so a Done tapped anywhere else is still confirmed.
let openSheet: ((moment: DoneMoment) => void) | null = null;

/**
 * The tracker's success line for a step the Helpr just took. "done" opens board 81's
 * "What next" sheet when a host is mounted; every other step (and "done" with no host)
 * keeps the toast it always had.
 */
export function announceTransition(status: string, message: string, moment: DoneMoment) {
  if (status === "done" && openSheet) openSheet(moment);
  else toast.success(message);
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * Board 81, "What next" after the Helpr marks the job done, on the shared WhatNextSheet.
 * The poster confirms (Now), or the job completes on its own after AUTO_COMPLETE_HOURS
 * (the cron's real cutoff, escrowTiming.ts); then the payout; then reviews. No amount and no
 * payout date: the tracker does not hold the take-home, and a date we can't compute is hidden.
 */
export function HelperDoneWhatNextHost() {
  const [moment, setMoment] = useState<DoneMoment | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    openSheet = setMoment;
    return () => { if (openSheet === setMoment) openSheet = null; };
  }, []);
  return (
    <WhatNextSheet
      open={!!moment}
      onClose={() => setMoment(null)}
      title="Nice work"
      lead="The person who posted this job has your update and is checking now."
      steps={[
        { key: "done", label: "You marked it done", detail: moment ? `Today · ${timeOf(moment.at)}` : "Today", state: "done" },
        {
          key: "confirm",
          label: "The person who posted it confirms",
          detail: `Or it completes on its own after ${AUTO_COMPLETE_HOURS} hours`,
          state: "now",
        },
        { key: "paid", label: "You're paid", detail: "Your payout follows once it's complete", state: "later" },
        { key: "reviews", label: "You both leave reviews", detail: "It helps you get hired again", state: "later" },
      ]}
      primary={{ label: "Got it", onClick: () => setMoment(null) }}
      secondary={{ label: "Find your next job", onClick: () => { setMoment(null); navigate("/jobs"); } }}
    />
  );
}
