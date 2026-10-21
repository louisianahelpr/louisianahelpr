import { Check } from "lucide-react";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { sentenceCaseLabel } from "@/lib/jobCategoryGroups";

/** "Pressure washing" -> "pressure washing", keeping acronyms ("HVAC"). */
function inSentence(category: string): string {
  const s = sentenceCaseLabel(jobCategoryLabel(category));
  return /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Board 188 (proof on applicants): what this applicant has really done, first.
 * "12 pressure washing jobs on Helpr · 31 total" from the completed-job counts,
 * or, for someone with none yet, "New to Helpr · ID verified" (only when the ID
 * check is done; never a blank, never a made-up number). Nothing while the
 * category count is unknown (switch off, not deployed, read failed).
 */
export function ApplicantProofLine({
  categoryCount,
  totalCount,
  idVerified,
  category,
}: {
  /** Completed jobs in this job's category; undefined when not known. */
  categoryCount: number | undefined;
  totalCount: number;
  idVerified: boolean;
  /** The job's category value (jobs.category). */
  category: string;
}) {
  if (categoryCount === undefined) return null;
  const categoryLabel = inSentence(category);
  let text: string | null = null;
  if (categoryCount > 0) {
    text = `${categoryCount} ${categoryLabel} job${categoryCount === 1 ? "" : "s"} on Helpr${totalCount > categoryCount ? ` · ${totalCount} total` : ""}`;
  } else if (totalCount === 0 && idVerified) {
    text = "New to Helpr · ID verified";
  } else if (totalCount > 0) {
    text = `${totalCount} job${totalCount === 1 ? "" : "s"} on Helpr, none in ${categoryLabel} yet`;
  }
  if (!text) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-ds-12 font-sans text-foreground" data-applicant-proof="">
      <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      {text}
    </span>
  );
}
