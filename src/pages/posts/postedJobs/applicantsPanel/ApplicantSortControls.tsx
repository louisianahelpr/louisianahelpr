import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { type ApplicantSort } from "../useApplicantComparison";

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "rated", label: "Highest rated" },
  { value: "soonest", label: "Applied first" },
] as const satisfies readonly { value: ApplicantSort; label: string }[];

interface ApplicantSortControlsProps {
  applicantSort: ApplicantSort;
  setApplicantSort: (sort: ApplicantSort) => void;
}

/**
 * Horizontal sort-pill row for the applicants list. Pure presentational —
 * the active sort + setter arrive via props. Extracted verbatim from
 * ApplicantsPanel.
 *
 * The "Lowest bid"/"Highest bid" pills (and the job + sorted-list props that
 * only existed to decide whether to show them) went out with the accept_bids
 * pricing mode — it was never used in production.
 */
export function ApplicantSortControls({
  applicantSort,
  setApplicantSort,
}: ApplicantSortControlsProps) {
  // Judgment call: the "soonest" sort already ordered by application
  // timestamp ascending (see useApplicantComparison's comment — "first to
  // apply"), but its label read "Soonest available", which sounds like the
  // HELPER's stated availability, not when they applied. Rather than add a
  // second, functionally-duplicate "Applied first" option next to a
  // mislabeled one that does the exact same sort, the existing one says
  // what it actually does.
  //
  // One of three is always chosen, so it is a switch, not a filter strip:
  // the shared SegmentedControl (Q2709, owner 10-31 "Nothing hand-made"),
  // quiet tone because the hire sheet's solid primary sits below it.
  return (
    <SegmentedControl
      ariaLabel="Sort applicants by"
      tone="quiet"
      className="mb-4"
      options={SORT_OPTIONS}
      value={applicantSort}
      onChange={setApplicantSort}
    />
  );
}
