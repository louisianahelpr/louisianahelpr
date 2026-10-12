/**
 * "Available now" pill on an applicant card — shown when the helper has
 * toggled their 4-hour availability signal and the window hasn't expired yet.
 * Moved verbatim out of ApplicantsPanel (component-size ratchet).
 */
export function ApplicantAvailableNow({ until }: { until: string | null | undefined }) {
  const isNowAvailable = until && new Date(until) > new Date();
  return isNowAvailable ? (
    <span
      className="inline-flex items-center gap-0.5 mt-0.5 text-ds-11 font-semibold px-1.5 py-0.5 rounded-full"
      style={{ background: "hsl(var(--sage) / 0.12)", color: "hsl(var(--sage))" }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
      Available now
    </span>
  ) : null;
}
