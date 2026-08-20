import { type ApplicantSort } from "../useApplicantComparison";

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
  return (
    <div className="flex items-center gap-1.5 mb-4 flex-wrap" role="group" aria-label="Sort applicants by">
      {(["recommended", "rated", "soonest"] as const).map((opt) => {
        const label = opt === "recommended" ? "Recommended" : opt === "rated" ? "Highest rated" : "Soonest available";
        const active = applicantSort === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => setApplicantSort(opt)}
            aria-pressed={active}
            className="px-3 py-1.5 rounded-ds-md text-ds-11 font-sans font-semibold transition-all duration-150 active:scale-95"
            style={{
              // NOT a hardcoded white. `hsla(0, 0%, 100%, 0.45)` has no dark
              // sibling, so in dark mode this painted 45% pure white over a
              // dark surface and the inactive chip became a mid-grey slab with
              // olivewood text on it. Identical defect to the referral
              // milestone rung fixed in 48ad36cd — same literal, same failure.
              // `--ivory-sand` is `0 0% 100%` in light mode, so light output is
              // byte-identical and only dark changes.
              background: active ? "hsl(var(--bark) / 0.10)" : "hsl(var(--ivory-sand) / 0.45)",
              color: active ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.80)",
              border: active
                ? "0.5px solid hsl(var(--bark) / 0.3)"
                : "0.5px solid hsl(var(--bark) / 0.12)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
