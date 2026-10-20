/**
 * The face of a "mine" job card (boards 14 and 21, spec §3 "Mine card"):
 * a 56px photo thumb, the title, date · time, ONE status line, the money on
 * the right in rust, and ONE button. Tapping the face opens the job page
 * (/jobs/:id); the button does the card's real next step.
 *
 * Shared by the poster's Posted card and the Helpr's Working card so the two
 * tabs of one screen draw one card (spec §1.3, "one of each").
 */
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";

/** The card's one button: the real next step, or the quiet fallback that opens the card's controls. */
export interface MineFaceAction {
  label: string;
  onClick: () => void;
  /** "primary" for a real next step; "secondary" for the fallback (spec §3 buttons). */
  tone: "primary" | "secondary";
  disabled?: boolean;
}

/** "Sat, Oct 31 · 9:00 AM": only the parts the job really has (no street address on a list). */
export function mineFaceWhen(job: {
  date_needed?: string | null;
  start_time?: string | null;
  is_flexible_schedule?: boolean | null;
}): string {
  return [
    job.date_needed ? formatJobDate(job.date_needed) : null,
    jobStartTimeLabel(job.start_time ?? null, job.is_flexible_schedule ?? null),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function MineJobFace({
  jobId,
  title,
  category,
  photo,
  when,
  status,
  money,
  moneyCaption,
  action,
  extra,
}: {
  jobId: string;
  title: string;
  category: string | null;
  /** The job's first photo; absent, the category icon on its tint (spec §9.33 stress cases). */
  photo: string | null;
  when: string;
  /** The one status line (JobStatusStrip, line variant). */
  status: ReactNode;
  /** Pre-formatted, with its "$". Null hides it (spec §1.5). */
  money: string | null;
  /** Under the amount, e.g. "you take home" on the Helpr's card. */
  moneyCaption?: string | null;
  /** Null when the card is open: its own step row carries the action then. */
  action: MineFaceAction | null;
  /** Under the face, above the button, OUTSIDE the link (it may hold controls):
   *  a hired Helpr's street address row (owner, 2026-09-19 en-route carve-out). */
  extra?: ReactNode;
}) {
  const Icon =
    category === "other" || !category ? Briefcase : getCategoryIcon(category);
  const navigate = useNavigate();
  const onOpen = () => navigate(`/jobs/${encodeURIComponent(jobId)}`);
  return (
    <div data-mine-face="" className="p-4 md:flex md:items-center md:gap-6">
      {/* From 768px the one button sits to the right of the face, not across a 1500px card. */}
      <div className="min-w-0 md:flex-1">
        <Link
          to={`/jobs/${encodeURIComponent(jobId)}`}
          data-mine-face-open=""
          aria-label={`Open ${title}`}
          className="flex items-start gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className="h-14 w-14 shrink-0 overflow-hidden rounded-xl"
            data-mine-face-thumb=""
          >
            {photo ? (
              <img
                src={photo}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <PhotoPlaceholder
                icon={Icon}
                seed={category}
                warm
                className="h-full w-full"
                iconClassName="h-6 w-6"
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-3">
              <span
                data-mine-face-title=""
                className="line-clamp-2 min-w-0 text-ds-16 font-bold leading-snug text-foreground [overflow-wrap:anywhere]"
              >
                {title}
              </span>
              {money && (
                <span className="shrink-0 text-right" data-mine-face-money="">
                  <span className="block text-ds-17 font-bold leading-snug tabular-nums text-[hsl(var(--burnt-sienna))]">
                    {money}
                  </span>
                  {moneyCaption && (
                    <span className="block text-ds-11 text-muted-foreground">
                      {moneyCaption}
                    </span>
                  )}
                </span>
              )}
            </span>
            {when && (
              <span className="mt-0.5 block text-ds-13 text-muted-foreground">
                {when}
              </span>
            )}
          </span>
        </Link>
        {/* Under the title column (56px thumb + 12px gap), outside the link: the
          address row holds its own press-to-map control. A tap here opens the
          job like the face does (pointer only; the link above is the keyboard
          path). The address sits above the status line (enRouteAddressVisible). */}
        {(extra || status) && (
          <div
            className="space-y-1 pl-[68px] pt-1"
            data-mine-face-under=""
            onClick={onOpen}
          >
            {extra && <div data-mine-face-extra="">{extra}</div>}
            {status && <div>{status}</div>}
          </div>
        )}
      </div>
      {action && (
        <Button
          type="button"
          variant={action.tone === "primary" ? "primary" : "outline"}
          disabled={action.disabled}
          data-mine-face-action={action.tone}
          size="sm"
          className="mt-3 w-full rounded-full font-semibold md:mt-0 md:w-auto md:min-w-40 md:px-6 md:shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * The top of an OPEN mine card: the full meta row (the poster's own address,
 * a hired Helpr's street address, expiry, series) and Close. Nothing may go
 * after the step row (Q1567), so the way back sits up here. A tap on the row
 * opens the job, like the face; holding the address opens the map.
 */
export function MineOpenMeta({ jobId, meta, onClose }: { jobId: string; meta: ReactNode; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-start gap-2 px-4 pb-1" data-mine-expanded-meta="">
      <div className="min-w-0 flex-1" onClick={() => navigate(`/jobs/${encodeURIComponent(jobId)}`)}>
        {meta}
      </div>
      <button
        type="button"
        data-mine-close=""
        onClick={onClose}
        className="-my-2 min-h-11 shrink-0 px-2 text-ds-14 font-semibold text-primary"
      >
        Close
      </button>
    </div>
  );
}
