import type { UpcomingJob } from "@/components/dashboard/DashboardStatusBanners";

interface DashboardInProgressBadgeProps {
  /** Nearest accepted / in-progress job where the user is the helper. */
  job: UpcomingJob | null;
  /**
   * Navigate to {@link inProgressBadgeTarget}'s `to`. The page owns routing
   * (`navigate`); the destination is computed HERE, next to the label, so the
   * two can't drift — see that function.
   */
  onView: (to: string) => void;
}

/**
 * What the pill says, and where it goes — decided in ONE place.
 *
 * The pill shows two different states and they want two different
 * destinations, so the label and the route are returned together. Splitting
 * them (label here, `navigate()` in the page) is how a pill ends up reading
 * "In progress" and landing on an unfiltered list.
 *
 * Both routes are the app's OWN existing deep links, not new ones:
 * `/my-jobs?filter=in_progress` is what every in-progress notification already
 * links to (`useLifecycleHandlers`, `create-payment`), and `?filter=active` is
 * the applied tab's default bucket. `/my-jobs` is Activity's `defaultTab:
 * "applied"` route — NOT `/activity`, which redirects to `/my-posts` and drops
 * the query string, and not `/jobs/:id`, which bounces a signed-in user to
 * `/dashboard?quickApply=…`, i.e. straight back to the screen they tapped from.
 *
 * - `in_progress` → the job the badge is describing. The filter narrows the
 *   applied list to jobs whose status is exactly `in_progress`, which is the
 *   badge's own job (the query behind it takes the single nearest one).
 * - accepted-but-not-started → "Upcoming", so the honest destination is the
 *   list of active/upcoming jobs, not a single row.
 */
export function inProgressBadgeTarget(job: UpcomingJob): {
  live: boolean;
  label: string;
  to: string;
  /** Where the accessible name says it goes. */
  destination: string;
} {
  const live = job.status === "in_progress";
  return live
    ? { live, label: "In progress", to: "/my-jobs?filter=in_progress", destination: "open this job in My Jobs" }
    : { live, label: "Upcoming", to: "/my-jobs?filter=active", destination: "open your active jobs" };
}

/**
 * Compact live-status pill that sits in the dashboard's top brand row, just
 * before the bell. It replaces the old full-width "upcoming job" strip:
 * instead of eating a content row above the feed, the reminder rides the
 * pinned band of chrome so it stays reachable no matter how far the feed is
 * scrolled.
 *
 * It is a SHORTCUT, not a disclosure. Tapping it navigates straight to the
 * state it is describing (see {@link inProgressBadgeTarget}); it used to open
 * a popover whose only real content was a "View job ›" button, which made the
 * live reminder cost two taps to act on. The job title survives in the
 * accessible name and the `title` tooltip rather than in a panel.
 *
 * A job the helper is actively working (`in_progress`) gets a pulsing dot to
 * read as "live"; an accepted-but-not-started job shows a steady dot.
 * Self-hides entirely when there's no active job.
 */
const DashboardInProgressBadge = ({ job, onView }: DashboardInProgressBadgeProps) => {
  if (!job) return null;

  const { live, label, to, destination } = inProgressBadgeTarget(job);

  return (
    /* The visible pill is an inner span so the <button> can keep the global
       44px min tap target (HIG) WITHOUT the tinted pill itself ballooning to
       44px tall. The global `button { min-height:44px }` rule out-specifies
       any min-h-0 utility, so we don't fight it — the button stays a
       transparent 44px hit area and the span renders the thin ~22px chip.
       `-my-*` isn't needed: the row already reserves 44px for the bell, so
       the tall hit area adds no height. */
    <button
      type="button"
      onClick={() => onView(to)}
      title={`${label}: ${job.title}`}
      aria-label={`${label}: ${job.title}. Tap to ${destination}.`}
      className="btn-press inline-flex items-center bg-transparent border-0 p-0 transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-full"
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
  );
};

export default DashboardInProgressBadge;
