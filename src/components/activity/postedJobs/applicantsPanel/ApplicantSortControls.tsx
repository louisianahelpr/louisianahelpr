import { type Job, type EnrichedApplication } from "../../activityConstants";
import { type ApplicantBidFields } from "../postedJobsHelpers";
import { type ApplicantSort, type ScoredApp } from "../useApplicantComparison";

interface ApplicantSortControlsProps {
  applicantSort: ApplicantSort;
  setApplicantSort: (sort: ApplicantSort) => void;
  selectedJob: Job;
  sortedApplications: ScoredApp[];
}

/**
 * Horizontal sort-pill row for the applicants list. Pure presentational —
 * the active sort + setter arrive via props, and the bid-price sort pills
 * only appear for accept_bids jobs that have at least one bid. Extracted
 * verbatim from ApplicantsPanel.
 */
export function ApplicantSortControls({
  applicantSort,
  setApplicantSort,
  selectedJob,
  sortedApplications,
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
              background: active ? "hsl(var(--bark) / 0.10)" : "hsla(0, 0%, 100%, 0.45)",
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
      {/* Bid price sort — only shown for accept_bids jobs with at least one bid */}
      {selectedJob.pricing_mode === "accept_bids" &&
        sortedApplications.some((sa) => (sa.app as EnrichedApplication & ApplicantBidFields).proposed_price != null) && (
          <>
            {(["bid_asc", "bid_desc"] as const).map((opt) => {
              const label = opt === "bid_asc" ? "Lowest bid" : "Highest bid";
              const active = applicantSort === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setApplicantSort(opt)}
                  aria-pressed={active}
                  className="px-3 py-1.5 rounded-ds-md text-ds-11 font-sans font-semibold transition-all duration-150 active:scale-95"
                  style={{
                    background: active ? "hsl(var(--heritage-gold) / 0.15)" : "hsl(var(--parchment) / 0.5)",
                    color: active ? "hsl(var(--heritage-gold))" : "hsl(var(--olivewood) / 0.80)",
                    border: active
                      ? "1px solid hsl(var(--heritage-gold) / 0.4)"
                      : "1px solid hsl(var(--olivewood) / 0.15)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </>
      )}
    </div>
  );
}
