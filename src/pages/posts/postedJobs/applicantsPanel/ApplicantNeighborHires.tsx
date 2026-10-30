/**
 * "N neighbors hired them" on an applicant card (from get_neighbor_hire_count,
 * near the job address). Bark, so it reads as a warm local signal apart from the
 * neutral olivewood ones. Moved verbatim out of ApplicantsPanel (component-size ratchet).
 */
export function ApplicantNeighborHires({ count }: { count: number }) {
  return count > 0 ? (
    <span
      className="inline-flex items-center gap-1 mt-0.5 text-ds-11 font-sans font-semibold"
      style={{ color: "hsl(var(--bark))" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: "hsl(var(--bark))" }}
        aria-hidden="true"
      />
      {count} neighbor{count > 1 ? "s" : ""} hired them
    </span>
  ) : null;
}
