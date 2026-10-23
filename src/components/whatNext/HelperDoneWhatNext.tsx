import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { APPROVAL_WINDOW_HOURS, STANDARD_PAYOUT_PHRASE } from "../../../supabase/functions/_shared/escrowTiming";

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
 * The poster approves (Now); if they have not answered in APPROVAL_WINDOW_HOURS, Helpr support
 * steps in and nothing is paid until the job is approved (owner 2026-10-23, escrowTiming.ts); then
 * the payout, sent STANDARD_PAYOUT_PHRASE; then reviews. No amount and no payout date: the tracker
 * does not hold the take-home, and the date is only known once the poster approves.
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
      lead="The person who posted it can now approve the work."
      steps={[
        { key: "done", label: "You marked it done", detail: moment ? `Today · ${timeOf(moment.at)}` : "Today", state: "done" },
        {
          key: "confirm",
          label: "The person who posted it approves",
          detail: `If they haven't answered in ${APPROVAL_WINDOW_HOURS} hours, Helpr support steps in`,
          state: "now",
        },
        { key: "paid", label: "You're paid", detail: `Your payout is sent ${STANDARD_PAYOUT_PHRASE}`, state: "later" },
        { key: "reviews", label: "You both leave reviews", detail: "It helps you get hired again", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
      secondary={{ label: "Find your next job", onClick: () => { setMoment(null); navigate("/jobs"); } }}
    />
  );
}
