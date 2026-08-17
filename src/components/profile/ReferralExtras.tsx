// Referral-tab extras: client-rendered QR code + tier-ladder visual.
//
// Built as a standalone component so the existing ReferralSection
// stays compact and the heavier QR-encoder + ladder geometry don't
// re-render every time the parent refetches credits.
//
// The QR encodes the same signup URL as the share/SMS shortcuts so a
// scanned-vs-tapped flow lands the recipient at the same place.

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Trophy } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { formatPrice } from "@/lib/format";

interface ReferralExtrasProps {
  referralCode: string | null;
  referralCount: number;
  /** Sum of all referral-credit dollars (redeemed + unredeemed). */
  totalEarned: number;
}

// Tier ladder — three milestones tuned to the platform's referral
// economics. The first is achievable (1), the second is "you're a real
// promoter" (5), and the third is the cap (25 — well past the $25
// in-app credit ceiling, so we frame it as "Helpr Hall of Fame"
// progress rather than dollar credits).
const LADDER = [
  { goal: 1, label: "First friend", reward: "+$5 credit" },
  { goal: 5, label: "Five-pack", reward: "Top promoter badge" },
  { goal: 25, label: "Hall of Fame", reward: "Custom shoutout" },
];

export function ReferralExtras({ referralCode, referralCount, totalEarned }: ReferralExtrasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrError, setQrError] = useState(false);

  // Render the QR onto a canvas every time the code changes. The
  // `qrcode` lib draws synchronously once the encoder is ready;
  // failures degrade quietly to a "tap the share button instead"
  // hint below the canvas slot.
  useEffect(() => {
    if (!canvasRef.current || !referralCode) return;
    const url = `${window.location.origin}/signup?ref=${encodeURIComponent(referralCode)}`;
    QRCode.toCanvas(
      canvasRef.current,
      url,
      {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 144,
        color: {
          dark: "#3a3d2e", // ink-deep equivalent in hex (lib doesn't read CSS vars)
          light: "#f8f4e9", // parchment-ish
        },
      },
      (err) => {
        if (err) setQrError(true);
      },
    );
  }, [referralCode]);

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
      {/* ── QR card ──────────────────────────────────────────────── */}
      <div className="rounded-2xl liquid-glass p-4 flex items-center gap-4">
        <div
          className="shrink-0 rounded-ds-md p-2"
          style={{
            background: "hsl(var(--surface-band))",
            border: "0.5px solid hsl(var(--border))",
          }}
        >
          {referralCode ? (
            <canvas
              ref={canvasRef}
              width={144}
              height={144}
              aria-label={`QR code for referral code ${referralCode}`}
              role="img"
              style={{ display: "block", width: 120, height: 120 }}
            />
          ) : (
            <div className="w-[120px] h-[120px] flex items-center justify-center text-muted-foreground">
              <HelprSpinner size={20} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="font-display italic font-bold leading-tight text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            In-person QR code
          </h3>
          <p
            className="font-serif italic mt-1 leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Show this to a friend at a job site — they scan, sign up, and your code is auto-applied.
          </p>
          {qrError && (
            <p
              className="font-serif italic mt-1.5 leading-snug text-ds-12"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Couldn't draw the QR — use the share button above instead.
            </p>
          )}
        </div>
      </div>

      {/* ── Tier ladder ──────────────────────────────────────────── */}
      <div className="rounded-2xl liquid-glass p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            <h3
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Your referral rank
            </h3>
          </div>
          <div className="text-right shrink-0">
            <p
              className="font-display italic font-bold tabular-nums leading-none text-ds-16"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              ${formatPrice(totalEarned)}
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
        <div className="grid grid-cols-3 gap-2">
          {LADDER.map((m, i) => {
            const cleared = referralCount >= m.goal;
            const isNext = !cleared && i === activeRungIdx + 1;
            return (
              <div
                key={m.goal}
                className="rounded-ds-md p-2.5 text-center"
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
                  className="w-3.5 h-3.5 mx-auto mb-0.5"
                  style={{
                    color: cleared
                      ? "hsl(var(--bark))"
                      : isNext
                        ? "hsl(var(--burnt-sienna))"
                        : "hsl(var(--olivewood) / 0.8)",
                  }}
                />
                <p
                  className="font-display italic font-bold tabular-nums leading-none text-ds-15"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {m.goal}
                </p>
                <p
                  className="font-serif italic mt-0.5 leading-snug text-ds-11"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {m.label}
                </p>
                <p
                  className="font-sans font-semibold mt-1 text-ds-10"
                  style={{
                    // --accent-ink, not --burnt-sienna: this reward line is
                    // 10px on a tinted tile, where the raw brand accent
                    // measures 4.48:1 on dark. Identical value in light mode.
                    color: cleared ? "hsl(var(--bark))" : "hsl(var(--accent-ink))",
                    letterSpacing: "0.02em",
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

export default ReferralExtras;
