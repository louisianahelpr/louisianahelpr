import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ID_VERIFIED_LABEL } from "@/components/profile/IdVerifiedPill";

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
 */
const hairline = { borderBottom: "1px solid var(--doc-hairline)" };

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

const IDENTITY_LABELS = ["Issued to", `${ID_VERIFIED_LABEL} by Stripe`, "Member since"];
const STAT_LABELS = ["Jobs Completed", "Total Earnings", "Active Period", "Avg Rating"];

export function WorkRecordReserve() {
  return (
    <div aria-hidden data-testid="work-record-reserve" className="doc-card rounded-ds-lg overflow-hidden">
      <div className="px-5 pt-5 pb-4" style={hairline}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Skeleton className="h-8 w-36 rounded" />
            <Ghost className="font-display italic font-bold mt-3 text-ds-20 leading-tight">Employment &amp; Earnings Record</Ghost>
            <Skeleton className="h-3.5 w-40 rounded mt-1.5" />
          </div>
          <Skeleton className="shrink-0 w-14 h-14 rounded-ds-lg" />
        </div>
      </div>
      <div className="px-5 py-4" style={hairline}>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {IDENTITY_LABELS.map((l) => (
            <div key={l}>
              <Ghost className="text-ds-10 font-sans font-semibold uppercase tracking-wider mb-0.5">{l}</Ghost>
              <Skeleton className="h-4 w-4/5 rounded mt-1" />
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
            {STAT_LABELS.map((l) => (
              <div key={l} className="doc-tile rounded-ds-md px-3 py-2.5">
                <Ghost className="text-ds-10 font-sans font-semibold uppercase tracking-wider mb-1">{l}</Ghost>
                <Skeleton className="h-4 w-1/2 rounded" />
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
