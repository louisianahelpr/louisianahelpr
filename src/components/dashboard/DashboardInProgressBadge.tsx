import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UpcomingJob } from "@/components/dashboard/DashboardStatusBanners";
import { formatJobDate } from "@/lib/dateUtils";

interface DashboardInProgressBadgeProps {
  /** Nearest accepted / in-progress job where the user is the helper. */
  job: UpcomingJob | null;
  /** Navigate to the job (Activity › My Jobs). */
  onView: () => void;
}

/**
 * Compact live-status pill that sits in the dashboard top nav next to the
 * bell. It replaces the old full-width "upcoming job" strip: instead of
 * eating a content row above the feed, the reminder rides the pinned header
 * so it stays reachable no matter how far the feed is scrolled.
 *
 * A job the helper is actively working (`in_progress`) gets a pulsing dot to
 * read as "live"; an accepted-but-not-started job shows a steady dot. Tapping
 * the pill opens a small popover with the job title, time, and a View action.
 * Self-hides entirely when there's no active job.
 */
const DashboardInProgressBadge = ({ job, onView }: DashboardInProgressBadgeProps) => {
  const [open, setOpen] = useState(false);

  if (!job) return null;

  const live = job.status === "in_progress";
  const label = live ? "In progress" : "Upcoming";

  const dateLine =
    job.date_needed &&
    `${formatJobDate(job.date_needed)}${job.start_time ? ` · ${job.start_time.slice(0, 5)}` : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The visible pill is an inner span so the <button> can keep the
            global 44px min tap target (HIG) WITHOUT the tinted pill itself
            ballooning to 44px tall. The global `button { min-height:44px }`
            rule out-specifies any min-h-0 utility, so we don't fight it —
            the button stays a transparent 44px hit area and the span renders
            the thin ~22px chip. `-my-*` isn't needed: the header row already
            reserves 44px for the bell, so the tall hit area adds no height. */}
        <button
          type="button"
          aria-label={`${label}: ${job.title}. Tap for details.`}
          className="btn-press inline-flex items-center bg-transparent border-0 p-0 transition-transform active:scale-[0.97]"
        >
          <span
            className="inline-flex h-[1.375rem] items-center gap-1 rounded-full pl-1.5 pr-2"
            style={{
              background: "hsl(var(--live-pill-tint) / 0.22)",
              border: "1px solid hsl(var(--live-pill-tint) / 0.6)",
            }}
          >
            {/* Pulsing "live" dot — the ping ring only animates for an
                actively-in-progress job so the pulse genuinely signals live. */}
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {live && (
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
                  style={{ background: "hsl(var(--live-pill-tint))" }}
                />
              )}
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ background: "hsl(var(--live-pill-tint))" }}
              />
            </span>
            <span
              className="font-serif italic uppercase tracking-[0.1em] text-ds-9"
              style={{ color: "hsl(var(--live-pill-ink))" }}
            >
              {label}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-0 overflow-hidden">
        <div className="px-4 py-3">
          <span
            className="font-serif italic uppercase tracking-[0.12em] text-ds-9"
            style={{ color: "hsl(var(--burnt-sienna) / 0.9)" }}
          >
            {label}
          </span>
          <p
            className="font-display font-bold leading-snug mt-1"
            style={{ fontSize: "0.98rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
          >
            {job.title}
          </p>
          {dateLine && (
            <p className="font-serif italic mt-0.5" style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              {dateLine}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onView();
          }}
          className="btn-press w-full px-4 py-2.5 text-left font-sans font-semibold text-ds-12 transition-colors active:opacity-80"
          style={{
            background: "hsl(var(--bark) / 0.08)",
            borderTop: "1px solid hsl(var(--olivewood) / 0.12)",
            color: "hsl(var(--bark))",
          }}
        >
          View job ›
        </button>
      </PopoverContent>
    </Popover>
  );
};

export default DashboardInProgressBadge;
