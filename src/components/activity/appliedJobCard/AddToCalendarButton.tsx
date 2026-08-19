import { useState } from "react";
import { CalendarPlus, CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addJobToCalendar, type CalendarJobEvent } from "@/lib/icalExport";
import { hapticLight } from "@/lib/haptics";

/**
 * "Add to Calendar" that admits what it did.
 *
 * The old inline button called a fire-and-forget `downloadIcs` and never
 * changed: it read "Add to Calendar" before the tap and "Add to Calendar"
 * after it, with no toast, no spinner and no state — so on iOS, where the
 * underlying `<a download>` silently does nothing (see `addJobToCalendar`),
 * the control was indistinguishable from a dead one. That is exactly how it
 * was reported.
 *
 * The confirmed state is deliberately NOT persisted. We hand the file to the
 * OS; whether the user actually saved the event, or dropped the share sheet,
 * is something this app genuinely cannot observe. A remembered "Added ✓" that
 * outlived the session would be asserting something we don't know — so it
 * lasts as long as the card is on screen, which is long enough to answer "did
 * my tap register?" without claiming more than that.
 */
export function AddToCalendarButton({ job }: { job: CalendarJobEvent }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");

  const handleClick = async () => {
    if (state === "working") return;
    void hapticLight();
    setState("working");
    const result = await addJobToCalendar(job);
    if (result === "failed") {
      setState("idle");
      toast.error("Couldn't create the calendar file on this device.");
      return;
    }
    setState("done");
    toast.success(
      result === "shared"
        ? "Pick “Add to Calendar” in the share sheet to save it."
        : "Calendar file downloaded — open it to add the job.",
    );
  };

  const Icon = state === "done" ? CalendarCheck : CalendarPlus;

  return (
    <button
      type="button"
      aria-label={state === "done" ? "Calendar file created" : "Add to calendar"}
      disabled={state === "working"}
      className="inline-flex items-center gap-1 text-ds-11 font-medium mt-1 disabled:opacity-60"
      style={{
        color: state === "done" ? "hsl(var(--sage))" : "hsl(var(--olivewood) / 0.8)",
      }}
      onClick={() => void handleClick()}
    >
      {state === "working" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="w-3.5 h-3.5" aria-hidden />
      )}
      {state === "working" ? "Preparing…" : state === "done" ? "Calendar file ready" : "Add to Calendar"}
    </button>
  );
}

export default AddToCalendarButton;
