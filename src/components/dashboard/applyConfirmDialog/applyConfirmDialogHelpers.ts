import type { EnrichedJob } from "@/components/dashboard/types";

/** Mirror ReportDialog's pitch cap so the backend never silently truncates. */
export const MAX_PITCH_LENGTH = 500;
/** Soft minimum — short pitches read as "lol sure" to posters. We don't
 *  block submission below this (an empty pitch is still allowed), but
 *  we surface the count to nudge the helpr toward a useful intro. */
export const SOFT_MIN_PITCH_LENGTH = 30;

/**
 * Per-job draft key — old single-key behavior meant moving to a different
 * job overwrote your half-written pitch. Scoping by job id keeps each
 * application independent. The `helpr_` prefix is mirrored to Capacitor
 * Preferences (see safeStorage) so a force-quit doesn't lose the draft.
 */
export function pitchDraftKey(jobId: string | undefined | null) {
  return `helpr_apply_pitch_draft_${jobId ?? "unknown"}`;
}

/** Legacy single-key draft from before drafts were per-job. We migrate
 *  it once into the current job's key so an in-flight pitch from the
 *  pre-update build isn't dropped. */
export const LEGACY_PITCH_DRAFT_KEY = "helpr_apply_pitch_draft";

/** localStorage key for the helpr's saved default pitch template. */
export const TEMPLATE_KEY = "helpr_pitch_template";

/** Two-to-three sentence starters — clickable to insert/replace. We
 *  swap in time-of-day on the first one so the greeting feels live. */
function greetingByHour(hour: number) {
  if (hour < 5) return "Hi"; // late night
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Hi";
  return "Good evening";
}

/**
 * One suggested opener: a SHORT chip `label` and the full `sentence` that
 * tapping it inserts.
 *
 * The chips used to be labelled with a 32-character slice of the sentence
 * itself, which is why the row ran to 674px of max-content and had to be a
 * horizontal scroller — and why the chip sitting at the scrollport edge was
 * visibly cut mid-word. A chip is a label, not a preview: naming the INTENT
 * ("Done this before") keeps every pill short enough that the row simply
 * wraps, so nothing is clipped at 320 or 375 and the row stops contributing
 * a runaway intrinsic width to the dialog's grid column. The inserted text
 * is unchanged.
 */
export type StarterSentence = { label: string; sentence: string };

export function buildStarterSentences(job: EnrichedJob | null): StarterSentence[] {
  const greet = greetingByHour(new Date().getHours());
  const cat = (job?.category ?? "this kind of work").toLowerCase().replace(/_/g, " ");
  const dayLabel = (() => {
    if (!job?.date_needed) return "";
    const d = new Date(job.date_needed + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { weekday: "long" });
  })();
  return [
    {
      label: dayLabel ? `Free ${dayLabel}` : "I'm available",
      sentence: `${greet}, I'm available ${dayLabel ? dayLabel : "the day you need"}${job?.start_time ? ` at ${job.start_time}` : ""} and ready to go.`,
    },
    {
      label: "Done this before",
      sentence: `I've done ${cat} before and can bring the right tools for the job.`,
    },
    {
      label: "Happy to quote",
      sentence: `Happy to send a quick quote or answer any questions before you decide.`,
    },
  ];
}

/**
 * Returns up to 2 context-aware tips for the helpr based on the job's
 * attributes. Empty array when no tips apply — the UI hides the tips block.
 */
export function getApplyTips(job: {
  is_urgent?: boolean | null;
  budget?: number | null;
  pricing_mode?: string;
  date_needed?: string | null;
  category?: string | null;
}): string[] {
  const tips: string[] = [];

  // Urgent jobs — availability is the key signal
  if (job.is_urgent) {
    tips.push("Urgent job — mention your earliest available start time in your message");
  }

  // High-budget jobs — experience matters more
  if (job.budget != null && job.budget >= 150) {
    tips.push("Higher-budget jobs go to Helprs who mention relevant experience");
  }

  // Bid-mode — price explanation helps
  if (job.pricing_mode === "accept_bids") {
    tips.push("For bid jobs, briefly explain what your price includes");
  }

  // Upcoming date — scheduling matters
  if (job.date_needed) {
    const date = new Date(job.date_needed);
    const daysAway = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysAway >= 0 && daysAway <= 3) {
      tips.push("Job is in the next 3 days — confirm you're available at the date/time");
    }
  }

  // Category-specific tips
  const catTips: Record<string, string> = {
    handyman:  "List the specific tools you have for this type of work",
    cleaning:  "Mention if you bring your own supplies or need the poster's",
    moving:    "Confirm if you have a truck or will need access to one",
    pet_care:  "Mention any pet care certifications or relevant experience",
    yard_work: "Specify what equipment you'll use",
    painting:  "Mention your prep process — posters care about prep as much as painting",
  };
  if (job.category && catTips[job.category]) {
    tips.push(catTips[job.category]);
  }

  // Never return more than 2 tips — keep it scannable
  return tips.slice(0, 2);
}
