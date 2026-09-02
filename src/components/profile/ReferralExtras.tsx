// Referral-tab extras: the tier-ladder visual.
//
// Built as a standalone component so the existing ReferralSection stays
// compact and the ladder geometry doesn't re-render every time the parent
// refetches credits. (It also carried the in-person QR code until that
// feature was removed at the owner's request.)

import { Trophy } from "lucide-react";
import { formatPriceExact } from "@/lib/format";

interface ReferralExtrasProps {
  referralCount: number;
  /** Sum of all referral-credit dollars (redeemed + unredeemed). */
  totalEarned: number;
}

// Tier ladder — one rung per referred friend, $5 each.
//
// CAVEAT, verified by running `enforce_referral_cap` (migration
// 20260403151012) in PGlite: the cap is FIVE CREDIT ROWS per user, and it
// counts `first_job_bonus` alongside `referrer_bonus`. A user who themselves
// signed up through a referral link already holds a first_job_bonus, so only
// FOUR of these five rungs can ever pay them — the fifth insert is silently
// suppressed (`RETURN NULL`) and raises a `referral_abuse` fraud flag. The
// rungs still describe the goal correctly for a user who was not referred; the
// dollar ceiling ($25) is the part that holds for everyone, which is why the
// headline copy in ReferralSection states the ceiling rather than a friend
// count. Flagged for a product decision: either exclude first_job_bonus from
// the cap, or render four rungs for a referred user.
const LADDER = [
  { goal: 1, label: "Friend 1", reward: "+$5" },
  { goal: 2, label: "Friend 2", reward: "+$5" },
  { goal: 3, label: "Friend 3", reward: "+$5" },
  { goal: 4, label: "Friend 4", reward: "+$5" },
  { goal: 5, label: "Friend 5", reward: "+$5 · $25 max" },
];

export function ReferralExtras({ referralCount, totalEarned }: ReferralExtrasProps) {
  // Active rung — the *highest* milestone the user has reached. Drives
  // the "now" marker and rewards-claimed pill.
  const activeRungIdx = LADDER.reduce(
    (acc, m, i) => (referralCount >= m.goal ? i : acc),
    -1,
  );
  // Next milestone — the first un-met one, or null when the top rung
  // is already cleared.
  const nextRung = LADDER.find((m) => referralCount < m.goal) ?? null;
  // Progress to the next rung — 0..1, used both for the wide progress
  // bar and the "how many more" copy below.
  const nextRungIdx = nextRung ? LADDER.findIndex((m) => m.goal === nextRung.goal) : -1;
  const priorGoal =
    nextRungIdx <= 0 ? 0 : LADDER[nextRungIdx - 1].goal;
  const nextProgressPct = nextRung
    ? Math.min(
        100,
        Math.round(
          ((referralCount - priorGoal) / (nextRung.goal - priorGoal)) * 100,
        ),
      )
    : 100;

  return (
    <div className="space-y-4">
      {/* ── Tier ladder ──────────────────────────────────────────── */}
      <div className="rounded-2xl liquid-glass p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            {/* h2, not h3: the only heading above this on the Referrals tab
                is the page h1 ("Referrals", via ProfileTabHeader → PageHeader),
                so an h3 here skipped a level — axe `heading-order`, moderate,
                and a screen-reader user hears a missing section. The TAG moved;
                every style class is unchanged, so nothing shifts on screen
                (`text-ds-16` sets the size, not the browser's h-default). */}
            <h2
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Your referral rank
            </h2>
          </div>
          <div className="text-right shrink-0">
            <p
              className="font-display italic font-bold tabular-nums leading-none text-ds-16"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {/* formatPriceExact, not formatPrice: formatPrice ROUNDS to whole
                  dollars, so a $12.50 balance read "$13" here while the tiles
                  above and the cash-out button said "$12.50". Credits are money
                  the user can withdraw — never round them for display. */}
              ${formatPriceExact(totalEarned)}
            </p>
            <p
              className="font-serif italic text-ds-10"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              earned
            </p>
          </div>
        </div>

        {/* Progress bar — overall position in the ladder. Uses the
            top goal as denominator so the bar is a global progress
            indicator, not per-rung. */}
        <div className="h-2 rounded-full bg-muted/60 overflow-hidden mb-3">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, Math.round((referralCount / LADDER[LADDER.length - 1].goal) * 100))}%`,
              background: "linear-gradient(90deg, hsl(var(--burnt-sienna)) 0%, hsl(var(--burnt-sienna)) 100%)",
            }}
          />
        </div>

        {/* Milestone rungs — each tile renders as cleared (green
            tick), current (warm accent), or upcoming (muted). */}
        <div className="grid grid-cols-5 gap-1.5">
          {LADDER.map((m, i) => {
            const cleared = referralCount >= m.goal;
            const isNext = !cleared && i === activeRungIdx + 1;
            return (
              <div
                key={m.goal}
                className="rounded-ds-md p-1.5 text-center"
                style={{
                  background: cleared
                    ? "hsl(var(--bark) / 0.10)"
                    : isNext
                      ? "hsl(var(--burnt-sienna) / 0.10)"
                      // Was the literal `hsla(0, 0%, 100%, 0.45)` — 45% pure
                      // white with no dark sibling, so the "upcoming" rung
                      // stayed a mid-grey #7f7e7d slab in dark mode and every
                      // label on it collapsed (axe: 1.11 / 2.19 / 2.9:1).
                      // --ivory-sand is `0 0% 100%` in light mode, so this is
                      // byte-identical there and only darkens in dark mode.
                      : "hsl(var(--ivory-sand) / 0.45)",
                  border: cleared
                    ? "0.5px solid hsl(var(--bark) / 0.32)"
                    : isNext
                      ? "0.5px solid hsl(var(--burnt-sienna) / 0.42)"
                      : "0.5px solid hsl(var(--olivewood) / 0.14)",
                }}
              >
                <Trophy
                  className="w-3 h-3 mx-auto mb-0.5"
                  style={{
                    color: cleared
                      ? "hsl(var(--bark))"
                      : isNext
                        ? "hsl(var(--burnt-sienna))"
                        : "hsl(var(--olivewood) / 0.8)",
                  }}
                />
                <p
                  className="font-display italic font-bold tabular-nums leading-none text-ds-14"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {m.goal}
                </p>
                <p
                  className="font-sans font-semibold mt-1 leading-snug text-ds-9"
                  style={{
                    // --accent-ink, not --burnt-sienna: this reward line is
                    // ~9-10px on a tinted tile, where the raw brand accent
                    // measures 4.48:1 on dark. Identical value in light mode.
                    color: cleared ? "hsl(var(--bark))" : "hsl(var(--accent-ink))",
                    letterSpacing: "0.01em",
                  }}
                >
                  {m.reward}
                </p>
              </div>
            );
          })}
        </div>

        {/* Next-rung copy — concrete "X more to go" prompt, with a
            per-rung progress bar so the user sees forward motion
            even when they're between two milestones. */}
        {nextRung && (
          <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.12)" }}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <p
                className="font-serif italic text-ds-12"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                  {Math.max(0, nextRung.goal - referralCount)}
                </span>{" "}
                more to reach {nextRung.label}.
              </p>
              <span
                className="text-ds-10 font-bold tabular-nums"
                style={{ color: "hsl(var(--bark))" }}
              >
                {nextProgressPct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${nextProgressPct}%`,
                  background: "hsl(var(--burnt-sienna))",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
