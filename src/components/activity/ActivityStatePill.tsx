import { postedActiveState, appliedActiveState, stateToneColors } from "./activityStateLabel";
import type { PostedJobStateInput, AppliedStateInput } from "./activityStateLabel";

/**
 * The "where does this stand?" pill on an Active card.
 *
 * Renders nothing when the item isn't in the Active bucket — completed and
 * cancelled cards already carry their own treatment, and repeating it here
 * would say the same thing twice in two type sizes.
 */
export function ActivityStatePill({
  posted,
  applied,
}: {
  posted?: PostedJobStateInput;
  applied?: AppliedStateInput;
}) {
  const state = posted ? postedActiveState(posted) : applied ? appliedActiveState(applied) : null;
  if (!state) return null;
  const { fg, bg } = stateToneColors(state.tone);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-ds-pill text-ds-10 font-sans font-semibold shrink-0"
      style={{ color: fg, background: bg }}
    >
      {/* A filled dot rather than a per-state icon: at 10px an icon set turns
          into noise, and the dot's colour already carries the tone. */}
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fg }} aria-hidden />
      {state.label}
    </span>
  );
}
