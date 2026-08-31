import { Clock, CheckCircle, Timer, RotateCcw, Star, XCircle, ClipboardList, ShieldCheck } from "lucide-react";
import type {
  ResponseMetrics,
  CancellationRate,
  PosterReputation,
  PetCareSignal,
} from "./types";

type Props = {
  isOwnProfile: boolean;
  responseMetrics: ResponseMetrics;
  onTimeArrivalRate: number | null;
  revisionFrequency: number | null;
  cancellationRate: CancellationRate;
  posterReputation: PosterReputation | null;
  hasCleanRecord: boolean;
  petCareSignal: PetCareSignal | null | undefined;
};

/**
 * THE RECORD — every "how do they perform" number, in one grid.
 *
 * These nine signals used to live inside ProfileHeaderCard as nine separate
 * one-line flex rows stacked under the bio, each with its own icon, its own
 * italic value and its own `mt-1.5`. On a phone they all centred, so the
 * identity card became a centred ticker-tape of unrelated facts — reply time,
 * a navigation button, a cancel rate, a disputes line — with no visual rank
 * between them and no way to compare two numbers side by side.
 *
 * A uniform cell grid fixes both problems at once: every metric gets the same
 * value-over-label shape, so the eye can scan a column instead of reading nine
 * sentences, and the identity card goes back to holding only identity.
 *
 * Cells are self-hiding. The card returns null when nothing qualifies, so a
 * brand-new account gets no empty scaffold.
 */

/** One metric cell — big value, quiet label. The only shape in this grid. */
const Metric = ({
  icon: Icon,
  value,
  label,
  tone = "hsl(var(--ink-deep))",
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: string;
  label: string;
  tone?: string;
}) => (
  <div
    className="flex flex-col gap-0.5 rounded-ds-md px-3 py-2.5 min-w-0"
    style={{ background: "hsl(var(--olivewood) / 0.04)" }}
  >
    <span className="flex items-center gap-1.5 min-w-0">
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.55)" }} />
      <span className="font-display italic font-bold tabular-nums text-ds-18 leading-none truncate" style={{ color: tone }}>
        {value}
      </span>
    </span>
    <span
      className="font-sans text-ds-11 leading-snug"
      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
    >
      {label}
    </span>
  </div>
);

export const TrackRecordCard = ({
  isOwnProfile,
  responseMetrics,
  onTimeArrivalRate,
  revisionFrequency,
  cancellationRate,
  posterReputation,
  hasCleanRecord,
  petCareSignal,
}: Props) => {
  const cells: React.ReactNode[] = [];

  if (responseMetrics.totalApplications > 0 && responseMetrics.avgResponseHours !== null) {
    const h = responseMetrics.avgResponseHours;
    cells.push(
      <Metric
        key="reply"
        icon={Clock}
        value={h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`}
        label="Avg. reply time"
      />,
    );
  }

  if (responseMetrics.totalApplications > 0 && responseMetrics.acceptanceRate !== null) {
    cells.push(
      <Metric
        key="accept"
        icon={CheckCircle}
        value={`${responseMetrics.acceptanceRate.toFixed(0)}%`}
        label="Accept rate"
      />,
    );
  }

  if (onTimeArrivalRate !== null) {
    cells.push(
      <Metric
        key="ontime"
        icon={Timer}
        value={`${onTimeArrivalRate.toFixed(0)}%`}
        label="Arrived on time"
        tone={
          onTimeArrivalRate >= 85
            ? "hsl(var(--ink-deep))"
            : onTimeArrivalRate >= 65
            ? "hsl(var(--gold-warm))"
            : "hsl(var(--burnt-sienna))"
        }
      />,
    );
  }

  if (revisionFrequency !== null) {
    cells.push(
      <Metric
        key="revisions"
        icon={RotateCcw}
        value={`${revisionFrequency.toFixed(0)}%`}
        label="Needed revisions"
        tone={
          revisionFrequency <= 10
            ? "hsl(var(--ink-deep))"
            : revisionFrequency <= 25
            ? "hsl(var(--gold-warm))"
            : "hsl(var(--burnt-sienna))"
        }
      />,
    );
  }

  if (posterReputation !== null) {
    cells.push(
      <Metric
        key="poster"
        icon={Star}
        value={posterReputation.avgRating.toFixed(1)}
        label={`As a poster · ${posterReputation.reviewCount} review${posterReputation.reviewCount === 1 ? "" : "s"}`}
      />,
    );
  }

  /* CANCEL RATE — neutral on your own profile.

     This rendered burnt-sienna above 15% on EVERY view, including the owner's
     own "Profile Review". Opening your own profile and being shown your worst
     number in alarm red, every single time, is punishment rather than
     information — the owner cannot act on a colour, and the figure is already
     the least flattering thing on the page.

     So: the owner always sees it in plain ink, phrased as the underlying count
     ("5 of 23 jobs cancelled") rather than a bare percentage, because the raw
     fact is what tells them whether it is worth acting on. Visitors keep the
     graded colour — that IS the trust signal they came for. */
  if (cancellationRate.rate !== null) {
    cells.push(
      <Metric
        key="cancel"
        icon={XCircle}
        value={`${cancellationRate.rate.toFixed(0)}%`}
        label={
          isOwnProfile
            ? `${cancellationRate.cancelled} of ${cancellationRate.total} jobs cancelled`
            : `Cancel rate · ${cancellationRate.cancelled}/${cancellationRate.total} jobs`
        }
        tone={
          isOwnProfile
            ? "hsl(var(--ink-deep))"
            : cancellationRate.rate < 5
            ? "hsl(var(--ink-deep))"
            : cancellationRate.rate < 15
            ? "hsl(var(--gold-warm))"
            : "hsl(var(--burnt-sienna))"
        }
      />,
    );
  }

  if (petCareSignal && petCareSignal.distinctPets > 0) {
    cells.push(
      <Metric
        key="pets"
        icon={ClipboardList}
        value={String(petCareSignal.distinctPets)}
        label={`${petCareSignal.distinctPets === 1 ? "Pet" : "Pets"} cared for · ${petCareSignal.reportCount} ${petCareSignal.reportCount === 1 ? "report" : "reports"}`}
      />,
    );
  }

  // "Show jobs near you" opt-in button + nearby-proof metric REMOVED (item
  // 24, 2026-08-30: "delete the show jobs near you button ... globally").
  // It was a geolocation opt-in that compared the viewer's location against
  // a helper's completed-job pins — low-signal on its own page and needed
  // its own explanation to make sense next to reply time / cancel rate.

  if (cells.length === 0 && !hasCleanRecord) return null;

  return (
    <section aria-labelledby="track-record-heading">
      <h2
        id="track-record-heading"
        className="font-sans font-semibold uppercase tracking-wider text-ds-11 mb-2.5"
        style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.12em" }}
      >
        Track Record
      </h2>
      <div className="rounded-2xl liquid-glass p-3.5">
        {cells.length > 0 && (
          <div className="grid grid-cols-2 gap-2">{cells}</div>
        )}

        {/* Clean record is a yes/no, not a measurement — it reads as a single
            full-width line under the grid rather than as a cell with no number
            in it. */}
        {hasCleanRecord && (
          <div className={cells.length > 0 ? "mt-2.5" : undefined}>
            <span
              className="inline-flex items-center gap-1.5 font-sans font-medium text-ds-12"
              style={{ color: "hsl(var(--success-ink))" }}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              No disputes on record
            </span>
          </div>
        )}
      </div>
    </section>
  );
};
