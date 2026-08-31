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
  type CareerMilestone,
  type MilestoneStats,
} from "@/lib/careerLadder";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { HelperBadge } from "@/components/HelperBadges";

/**
 * ONE recognition row — earned career milestones and earned performance
 * badges, side by side, with no section heading of their own.
 *
 * It replaces two adjacent blocks that used to stack on the public profile:
 * `<CareerMilestones>` (which draws its OWN "CAREER MILESTONES" all-caps
 * eyebrow above a `border-top`) and a bare `<HelperBadges>` chip row directly
 * beneath it. On a young account that rendered as a letterspaced grey section
 * label introducing a single "First Job" pill, then a second, unlabelled row
 * of chips under it — a lot of chrome for very little, and it read like a
 * section that had failed to load (owner, 2026-08-31).
 *
 * Both are the same KIND of object: a thing this person has earned. So they
 * are one wrapped row, rendered INSIDE the masthead card next to the identity
 * they describe, and the row self-hides entirely when nothing is earned —
 * which is the common case for a brand-new member, and must look like a
 * profile without decorations rather than a broken section.
 *
 * The milestone chips keep their tap-to-explain popover (a bare `title`
 * attribute never fires on touch), because "Rising Star" is meaningless
 * without its threshold. The performance badges are self-describing labels
 * and stay static, exactly as they render on the dashboard helper cards.
 */

const ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = { Star, TrendingUp, ShieldCheck, Award, Users, Crown, BadgeCheck, Gem };

function MilestoneIcon({ name, color }: { name: string; color: string }) {
  const Icon = ICON_MAP[name] ?? Star;
  return <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />;
}

function MilestoneChip({ milestone }: { milestone: CareerMilestone }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${milestone.label} — what this means`}
          // min-h-[44px] is NOT a visual box: `py-1` keeps the chip the same
          // height as its static neighbours while the 44px minimum is met by
          // the pseudo-element below (`.tap-44`-style), so a touch target
          // never grows the row's rhythm. Here the chip is genuinely 28px
          // tall, so the hit area is extended with padding on the wrapper
          // rather than by inflating every chip in the row.
          className="inline-flex items-center gap-1.5 rounded-ds-pill px-2.5 py-1.5 text-ds-12 font-sans font-semibold active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring relative after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:h-11 after:content-['']"
          style={{
            background: milestone.color.replace(")", " / 0.12)"),
            border: `0.5px solid ${milestone.color.replace(")", " / 0.28)")}`,
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
          <p
            className="font-sans font-semibold text-ds-13"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
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

type Props = {
  milestoneStats: MilestoneStats;
  badges: HelperBadge[];
};

export const RecognitionRow = ({ milestoneStats, badges }: Props) => {
  const earned = getEarnedMilestones(milestoneStats);
  if (earned.length === 0 && badges.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {earned.map((m) => (
        <MilestoneChip key={m.id} milestone={m} />
      ))}
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={[
            "inline-flex items-center gap-1 rounded-ds-pill",
            "px-2.5 py-1.5 text-ds-12 font-sans font-semibold leading-none",
            badge.color,
          ].join(" ")}
        >
          <span className="shrink-0 inline-flex items-center">{badge.icon}</span>
          {badge.label}
        </span>
      ))}
    </div>
  );
};
