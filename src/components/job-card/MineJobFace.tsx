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
import { Briefcase, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { JobProgress } from "@/components/tracker/JobProgress";
import type { JobProgressState } from "@/lib/jobProgress";

/** The card's one button: the real next step, or the quiet fallback that opens the card's controls. */
export interface MineFaceAction {
  label: string;
  onClick: () => void;
  /** "primary" for a real next step; "secondary" for the fallback (spec §3 buttons). */
  tone: "primary" | "secondary";
  /** A Helpr tracker step this button takes (helperFaceNextStep's key): the 8-step bar reads it (cardBar). */
  step?: string;
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
  progress,
  onCollapse,
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
  /** THE one tracker's bar on a collapsed card (owner, 2026-10-22: the 8 steps ON the job cards); the status
   *  line above already says what happens next. Null/absent, or off the path, draws nothing. */
  progress?: JobProgressState | null;
  /** The card is open: a small chevron beside the title shuts it (owner, 2026-10-21: no "Close" link). */
  onCollapse?: () => void;
}) {
  const Icon =
    category === "other" || !category ? Briefcase : getCategoryIcon(category);
  const navigate = useNavigate();
  const onOpen = () => navigate(`/jobs/${encodeURIComponent(jobId)}`);
  return (
    <div data-mine-face="" className="flex flex-col p-4 md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:gap-y-3">
      {/* From 768px the one button sits to the right of the face, not across a 1500px card. */}
      <div className="order-1 min-w-0 md:order-none md:flex-1">
        <div className="flex items-start gap-1">
        <Link
          to={`/jobs/${encodeURIComponent(jobId)}`}
          data-mine-face-open=""
          aria-label={`Open ${title}`}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <span className="block text-ds-17 font-bold leading-snug tabular-nums text-[hsl(var(--accent-ink))]">
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
        {onCollapse && (
          <button
            type="button"
            data-mine-close=""
            aria-label={`Close ${title}`}
            onClick={onCollapse}
            className="-mr-2 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        </div>
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
          className="order-3 mt-3 w-full rounded-full font-semibold md:mt-0 md:w-auto md:min-w-40 md:px-6 md:shrink-0 md:order-none"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
        >
          {action.label}
        </Button>
      )}
      {/* The tracker under the face, above the button on phone (order); from 768px a full-width row of its own under face + button, so the
          eight full step names fit beside the rail. */}
      {progress && progress.stage !== null && (
        <div className="order-2 pt-3 md:order-none md:basis-full md:pt-0" data-mine-face-progress="" onClick={onOpen}>
          <JobProgress progress={progress} barOnly />
        </div>
      )}
    </div>
  );
}

/**
 * The top of an OPEN mine card: the full meta row (the poster's own address,
 * a hired Helpr's street address, expiry, series). Nothing may go after the
 * step row (Q1567); the way back is the chevron beside the title (MineJobFace
 * onCollapse). A tap on the row opens the job, like the face; holding the
 * address opens the map.
 */
export function MineOpenMeta({ jobId, meta }: { jobId: string; meta: ReactNode }) {
  const navigate = useNavigate();
  if (!meta) return null;
  return (
    <div className="px-4 pb-1" data-mine-expanded-meta="">
      <div className="min-w-0" onClick={() => navigate(`/jobs/${encodeURIComponent(jobId)}`)}>
        {meta}
      </div>
    </div>
  );
}
