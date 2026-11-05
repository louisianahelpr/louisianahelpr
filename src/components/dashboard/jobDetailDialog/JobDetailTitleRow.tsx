import type { Dispatch, ReactNode, SetStateAction } from "react";
import { DialogBody } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { EnrichedJob } from "../types";
import { JobPrice } from "../JobPrice";
import { JobPriceTakeHome } from "../helprTakeHome";

/* Moved verbatim from JobDetailDialog.tsx (Q806 god-component ratchet, a pure move: the sheet's DOM is byte-identical). */

export function JobDetailTitleRow({ hero, job, viewerUserId, descExpanded, setDescExpanded, commissionPercent, helpers }: {
  /** The sheet's <DialogHero>, rendered by JobDetailDialog itself so the shell guard (popupShellInventory) still sees
   *  the Hero beside its DialogContent. */
  hero: ReactNode;
  job: EnrichedJob;
  viewerUserId: string | null;
  descExpanded: boolean;
  setDescExpanded: Dispatch<SetStateAction<boolean>>;
  commissionPercent: number;
  helpers: number;
}) {
  return (
    <>
        {/* Title+description share the row with price, price as a small
            pill vertically centered against BOTH lines — same layout as
            JobCard's title row (owner: "fix the layout so it's more
            similar to the job card, with money on the right of the title
            in a pill box", then "center [it] better between title and
            description"). `chip` is the exact component JobCard uses so the
            number is styled identically on both surfaces.
            `mt-1`, not the `mt-5` this carried until 2026-08-31: that margin
            existed to clear the badge row while the badge row was `absolute`
            and therefore invisible to layout — a hand-measured number that had
            already been wrong twice (it was `mt-7`, tuned for the pre-`compact`
            44px icon row, before that). The badge row takes its own grid track
            now, so the dialog's own `gap-3` does the clearing and this is just
            the last few px needed to clear the corner icon cluster
            (absolute, y=8..40). Measured after: title top lands at 43px on
            phone and 43px at sm — the sm case was 40px before, so the desktop
            card is unmoved for all practical purposes. */}
        <div className="mt-1 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {hero}
            {/* Description — always visible right under the title (owner:
                "move the description under the title, put posted by info
                there [in Details]"). It used to fold behind the Details
                toggle alongside the poster card; that toggle is gone too
                now (owner: "remove details and put posted by info here"). */}
            {job.description && (
              <div className="relative min-w-0 mt-1">
                {/* THE HOUSE BODY VOICE, not this dialog's own (2026-08-31).
                    This was `font-sans text-ds-15` at `ink-deep / 0.88`,
                    hand-set here — upright serif, one of the SEVEN different
                    body sizes the popup audit found across 24 dialogs, and two
                    steps larger and darker than the prose every confirm in the
                    app speaks. A helpr reading a job description and then a
                    cancellation confirm was reading two different products.
                    `DialogBody` is that one voice (serif italic, ds-12,
                    olivewood/0.8 — byte-identical to what BrandConfirmDialog
                    gives ~26 confirms), and it takes no className, so this
                    cannot drift back one utility at a time.
                    The <p> keeps only NON-TYPE utilities: line-clamp-3 turns it
                    into a display:-webkit-box, which defaults to
                    min-width:auto and sizes to its max-content width — so a
                    normal word near the edge overflows and the box's own
                    overflow:hidden clips it mid-word instead of wrapping.
                    min-w-0 lets the box shrink to its container so text wraps,
                    and we only clamp when the text is actually long enough to
                    need it so short descriptions stay plain blocks that wrap
                    cleanly. */}
                <DialogBody>
                  <p
                    className={`break-words min-w-0 ${!descExpanded && job.description.length > 180 ? "line-clamp-3" : ""}`}
                  >
                    {job.description}
                  </p>
                </DialogBody>
                {job.description.length > 180 && (
                  <Button type="button" variant="link" size="sm" onClick={() => setDescExpanded((v) => !v)}
                    className="mt-1 -mb-2 px-0 text-ds-13 font-sans font-bold"
                    // Q2709: the shared link Button (44px, h-11), same ink and type as before. A text link is olive
                    // (--action-strong), sentence case (spec v2 rebuild, audit 2026-10-21): it was a rust uppercase
                    // "READ MORE", and rust is money only.
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    {descExpanded ? "Show less" : "Read more"}
                  </Button>
                )}
              </div>
            )}
          </div>
          {/* #62: only the take-home (owner 2026-10-25), RIGHT OF THE TITLE like the feed card's price (owner
              2026-10-28); a long title wraps beside it. Guard: src/test/jobSheetPayBesideTitle.test.ts. */}
          {viewerUserId && viewerUserId !== job.customer_id && (
            <div className="shrink-0 self-start pt-0.5" data-job-sheet-pay="">
              <JobPriceTakeHome job={job} bare />
            </div>
          )}
          {!(viewerUserId && viewerUserId !== job.customer_id) && (
          <div className="shrink-0">
            <JobPrice
              variant="chip"
              size="lg"
              budget={job.budget}
              effectiveFee={commissionPercent}
              urgentFee={job.urgent_fee ?? 0}
              helpersNeeded={helpers} jobStatus={job.status} feeStamp={job} showBudget={!!viewerUserId && viewerUserId === job.customer_id} // J1: own job = the price set
            />
          </div>
          )}
        </div>
    </>
  );
}
