import {
  Star,
  TrendingUp,
  ShieldCheck,
  Award,
  Users,
  Crown,
  BadgeCheck,
  Gem,
} from "lucide-react";
import {
  getEarnedMilestones,
  getNextMilestone,
  getMilestoneProgress,
  type CareerMilestone,
  type MilestoneStats,
} from "@/lib/careerLadder";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Map icon name strings to Lucide components.
// Using a record so TypeScript validates the shape and the render is O(1).
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Star,
  TrendingUp,
  ShieldCheck,
  Award,
  Users,
  Crown,
  BadgeCheck,
  Gem,
};

interface CareerMilestonesProps {
  stats: MilestoneStats;
  /** When true, also show the next-milestone progress bar (own-profile view). */
  showProgress?: boolean;
}

function MilestoneIcon({ name, color }: { name: string; color: string }) {
  const Icon = ICON_MAP[name] ?? Star;
  return <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />;
}

// A bare `title` attribute never shows on mobile — there is no hover state
// to trigger the native tooltip, so a tap-only visitor got a badge with no
// way to learn what it means. Popover (tap to open, tap outside to close)
// is the same disclosure pattern ReviewsTab's "How Reviews Work" already
// uses, so a badge explains itself the same way on touch and desktop.
function MilestonePill({ milestone }: { milestone: CareerMilestone }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${milestone.label} — tap for details`}
          className="inline-flex items-center gap-1.5 rounded-ds-pill px-2.5 py-1 text-ds-12 font-sans font-semibold active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            background: `${milestone.color.replace(")", " / 0.12)").replace("hsl(", "hsl(")}`,
            border: `0.5px solid ${milestone.color.replace(")", " / 0.28)").replace("hsl(", "hsl(")}`,
            color: milestone.color,
          }}
        >
          <MilestoneIcon name={milestone.icon} color={milestone.color} />
          {milestone.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 rounded-2xl shadow-lg"
        style={{
          background: "hsl(var(--parchment))",
          color: "hsl(var(--bark))",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <MilestoneIcon name={milestone.icon} color={milestone.color} />
          <p className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            {milestone.label}
          </p>
        </div>
        <p className="text-ds-11 leading-snug" style={{ color: "hsl(var(--bark))" }}>
          {milestone.description}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * CareerMilestones — earned badges + optional next-milestone progress.
 *
 * Sits below skill endorsements on UserProfile / ProfileLanding.
 * Self-hides when the user has 0 earned milestones AND showProgress=false.
 */
export function CareerMilestones({ stats, showProgress = false }: CareerMilestonesProps) {
  const earned = getEarnedMilestones(stats);
  const next = getNextMilestone(stats);
  const progress = next ? getMilestoneProgress(next, stats) : null;

  // Nothing to render at all — hide section cleanly.
  if (earned.length === 0 && !showProgress) return null;
  // Even on own profile: nothing earned + no next milestone = hide.
  if (earned.length === 0 && !next) return null;

  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.12)" }}
    >
      <p
        className="text-ds-10 font-sans font-semibold uppercase tracking-wide mb-2"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Career milestones
      </p>

      {/* Earned badges grid */}
      {earned.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {earned.map((m) => (
            <MilestonePill key={m.id} milestone={m} />
          ))}
        </div>
      )}

      {/* Next-milestone progress — own profile only */}
      {showProgress && next && progress && (
        <div
          className="mt-2.5 rounded-ds-md p-3 space-y-2"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.14)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <MilestoneIcon name={next.icon} color={next.color} />
              <span
                className="text-ds-12 font-semibold truncate"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {next.label}
              </span>
            </div>
            <span
              className="text-ds-11 tabular-nums shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {progress.label}
            </span>
          </div>
          {/* Progress bar */}
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "hsl(var(--bark) / 0.14)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (progress.current / progress.target) * 100)}%`,
                background: next.color,
                opacity: 0.75,
              }}
            />
          </div>
          {next.requirement.avgRating && stats.avgRating > 0 && stats.avgRating < next.requirement.avgRating && (
            <p
              className="text-ds-11 font-serif italic"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Also needs {next.requirement.avgRating}+ avg rating (yours: {stats.avgRating.toFixed(1)})
            </p>
          )}
        </div>
      )}

      {/* On own-profile with earned milestones, also show next if it exists */}
      {showProgress && next && !progress && earned.length > 0 && (
        <div
          className="mt-2.5 rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.14)",
          }}
        >
          <MilestoneIcon name={next.icon} color={next.color} />
          <p
            className="text-ds-12 font-serif italic"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Next: <span className="font-semibold not-italic" style={{ color: "hsl(var(--ink-deep))" }}>{next.label}</span>
            {" — "}{next.description}
          </p>
        </div>
      )}
    </div>
  );
}
