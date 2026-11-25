import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";

/**
 * Deep audit 11-22 #35: a Helpr's cancel / leave confirm packed all four strike rungs into its one red callout. The
 * callout now says the one fact ("counts as a reliability strike"); the ladder (the shared sentence, so it cannot
 * drift from apply_consequence_ladder) sits behind this closed "How strikes work". Guard:
 * src/test/cancelPopupsSayTheOutcome.test.tsx.
 */
export function StrikeLadderDetails() {
  return (
    <details data-strike-ladder="" className="group">
      <summary className="min-h-11 flex cursor-pointer list-none items-center text-ds-13 font-semibold text-primary [&::-webkit-details-marker]:hidden">
        How strikes work
      </summary>
      <p className="font-sans text-ds-12 text-muted-foreground">{`Your first strike is recorded with no penalty; ${RELIABILITY_LADDER_SENTENCE}.`}</p>
    </details>
  );
}
