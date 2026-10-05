import { posterApplicantBadge } from "./applicantBadge";

/**
 * The status pill beside an applicant on the poster's list (Q1259): one badge
 * per closed_reason (applicantBadge.ts), none on a job-cancel close (Q274),
 * "Offer expired" when the Helpr let the offer lapse.
 */
export function ApplicantStatusBadge({ app }: { app: { status: string; closed_reason?: string | null } }) {
  const badge = posterApplicantBadge(app);
  if (!badge) return null;
  return badge.kind === "selected" ? (
    <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]">
      <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--bark))]" aria-hidden="true" />
      {badge.label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ds-11 px-2.5 py-[3px] rounded-ds-pill font-semibold leading-none min-h-[22px] bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.8)]">
      <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[hsl(var(--olivewood)/0.7)]" aria-hidden="true" />
      {badge.label}
    </span>
  );
}
