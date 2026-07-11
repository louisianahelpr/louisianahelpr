import { MapPin, Sparkles, ShieldCheck, Banknote } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * DifferentiatorStrip — a horizontal 4-badge row answering "why Helpr" in
 * one glance. Sits on the parchment surface with no card chrome, reading
 * as an inline strip of four promises rather than a card grid. This is
 * also where pricing lives, subtly: "Free to post" is a single line of
 * type, not a call-out.
 *
 * Layout: 2×2 on mobile, 4-across on md+. Each cell is centered:
 * icon → label → italic sub-copy.
 */

type Badge = {
  Icon: LucideIcon;
  label: string;
  sub: string;
};

const badges: Badge[] = [
  {
    Icon: MapPin,
    label: "Only Louisiana neighbors",
    sub: "Every helper is verified local",
  },
  {
    Icon: Sparkles,
    label: "Free to post",
    sub: "No sign-up fees. No monthly minimums",
  },
  {
    Icon: ShieldCheck,
    label: "Held in escrow",
    sub: "Funds released when the job is done",
  },
  {
    Icon: Banknote,
    label: "Same-day payout",
    sub: "Cash hits your account the day it's done",
  },
];

const DifferentiatorStrip = () => {
  return (
    <section className="px-5 sm:px-8 lg:px-12 py-10 sm:py-14">
      <div className="container mx-auto max-w-5xl">
        <ul
          className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8"
          role="list"
        >
          {badges.map(({ Icon, label, sub }, i) => (
            <li
              key={label}
              className="text-center observe-fade-up flex flex-col items-center"
              style={{ transitionDelay: `${80 + i * 60}ms` }}
            >
              <Icon
                className="w-6 h-6"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={1.5}
                aria-hidden
              />
              <div
                className="font-sans font-semibold text-ds-15 sm:text-ds-17 mt-3 leading-snug text-balance"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {label}
              </div>
              <div
                className="font-serif italic text-ds-11 sm:text-ds-13 mt-1 leading-relaxed text-balance"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {sub}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default DifferentiatorStrip;
