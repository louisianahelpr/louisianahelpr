import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Work Record's loading state: the SHEET it is about to show (owner,
 * 2026-10-08: "loading state for work record is not correct"). It was the
 * generic two short cards (ScreenfulReserve), while what arrives is one
 * `.doc-card` letterhead: header with the mark, title and date beside the
 * award tile; the three-fact identity row; the Work Summary band over a 2x2 of
 * stat tiles; then the jobs block. Same classes and padding as
 * src/pages/profile/WorkRecord.tsx, so each block sits where its real row will.
 *
 * Fixed strings the page always prints are drawn as ghost text (transparent
 * over the bone colour), so each bar takes the real line's width and wrap.
 * Lines whose words are data (the name, the member-since month, the stat
 * values, the generated date) are ghosted with a stand-in in the same type
 * style, so each bar is exactly as many real lines tall.
 *
 * loading-states-refresh 38958608457 (2026-10-16, 375, both test accounts)
 * measured three rows off:
 *   - header 114 -> 125px: the mark is a 44px link box (HelprMark's min-h-11)
 *     and was drawn as a 32px bar; the date is one text-ds-12 line (17.4px)
 *     after mt-0.5 and was drawn as a 14px bar after mt-1.5.
 *   - identity 64 -> 55px: the field label read `${ID_VERIFIED_LABEL} by
 *     Stripe` = "Stripe ID verified by Stripe", three lines in an 87px column,
 *     while the sheet prints "ID verified by Stripe" (two). Both now read
 *     WORK_RECORD_ID_FIELD from here.
 *   - stat tiles 57 -> 74px: the real labels sit beside a 16px icon, so
 *     "Jobs Completed" and "Total Earnings" wrap to two lines; the ghosts had
 *     no icon and fit on one.
 */
const hairline = { borderBottom: "1px solid var(--doc-hairline)" };

/** The identity row's ID field label: the sheet prints it, this reserve ghosts it. */
export const WORK_RECORD_ID_FIELD = "ID verified by Stripe";

function Ghost({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={className}>
      <span
        className="text-transparent select-none rounded [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
        style={{ background: "hsl(var(--olivewood) / 0.10)" }}
      >
        {children}
      </span>
    </p>
  );
}

const FIELD_LABEL = "text-ds-10 font-sans font-semibold uppercase tracking-wider mb-0.5";
/** [label, stand-in value, the value's type style on the sheet] */
const IDENTITY: Array<[string, string, string]> = [
  ["Issued to", "Helpr Member", "text-ds-14 font-semibold"],
  [WORK_RECORD_ID_FIELD, "Not verified", "text-ds-13 font-semibold"],
  // Every "<Month> 2026" wraps to two lines in the 87px column at 375.
  ["Member since", "October 2026", "text-ds-13"],
];
/**
 * Stand-in values are the zero state (Q722: a cold visit draws the state that
 * is known before the data; most members have no completed jobs). An active
 * period with jobs ("October 2026 – October 2026") is taller and grows the
 * sheet downward, never collapses it.
 */
const STATS: Array<[string, string]> = [
  ["Jobs Completed", "0"],
  ["Total Earnings", "$0"],
  ["Active Period", "—"],
  // One line, like "4.0 (1)"; "No reviews yet" can wrap in a 114px tile.
  ["Avg Rating", "—"],
];

export function WorkRecordReserve() {
  return (
    <div aria-hidden data-testid="work-record-reserve" className="doc-card rounded-ds-lg overflow-hidden">
      <div className="px-5 pt-5 pb-4" style={hairline}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div data-testid="work-record-reserve-mark" className="min-h-11 flex items-center">
              <Skeleton className="h-6 w-36 rounded" />
            </div>
            <Ghost className="font-display italic font-bold mt-3 text-ds-20 leading-tight">Employment &amp; Earnings Record</Ghost>
            <Ghost className="font-sans text-ds-12 mt-0.5">Generated September 30, 2026</Ghost>
          </div>
          <Skeleton className="shrink-0 w-14 h-14 rounded-ds-lg" />
        </div>
      </div>
      <div className="px-5 py-4" style={hairline}>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {IDENTITY.map(([label, value, valueClass]) => (
            <div key={label}>
              <Ghost className={FIELD_LABEL}>{label}</Ghost>
              <Ghost className={valueClass}>{value}</Ghost>
            </div>
          ))}
        </div>
      </div>
      <div style={hairline}>
        <div className="doc-band px-5 py-2">
          <Ghost className="font-sans uppercase text-ds-9">Work Summary</Ghost>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            {STATS.map(([label, value]) => (
              <div key={label} className="doc-tile rounded-ds-md px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Skeleton data-testid="work-record-reserve-stat-icon" className="w-4 h-4 rounded shrink-0" />
                  <Ghost className="text-ds-10 font-sans font-semibold uppercase tracking-wider">{label}</Ghost>
                </div>
                <Ghost className="text-ds-15 font-bold leading-tight">{value}</Ghost>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-5 py-8 flex flex-col items-center gap-3">
        <Skeleton className="w-8 h-8 rounded" />
        <Skeleton className="h-3.5 w-4/5 rounded" />
        <Skeleton className="h-3.5 w-3/5 rounded" />
      </div>
    </div>
  );
}
