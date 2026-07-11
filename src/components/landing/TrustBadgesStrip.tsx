import { Star, ShieldCheck, Lock, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Badge = {
  Icon: LucideIcon;
  label: string;
  suffix: string;
  accent: string;
  tint: string;
  fillIcon?: boolean;
};

const badges: Badge[] = [
  {
    Icon: Star,
    label: "4.9",
    suffix: "average rating",
    accent: "hsl(var(--gold-warm))",
    tint: "hsl(var(--gold-warm) / 0.14)",
    fillIcon: true,
  },
  {
    Icon: ShieldCheck,
    label: "ID-verified",
    suffix: "helpers",
    accent: "hsl(var(--burnt-sienna))",
    tint: "hsl(var(--burnt-sienna) / 0.10)",
  },
  {
    Icon: Lock,
    label: "Escrow",
    suffix: "protected payments",
    accent: "hsl(var(--olivewood))",
    tint: "hsl(var(--olivewood) / 0.10)",
  },
  {
    Icon: MapPin,
    label: "Louisiana-only",
    suffix: "trusted neighbors",
    accent: "hsl(var(--burnt-sienna))",
    tint: "hsl(var(--burnt-sienna) / 0.10)",
  },
];

const TrustBadgesStrip = () => (
  <section
    className="px-5 sm:px-8 lg:px-12 py-6 sm:py-8"
    style={{
      background: "hsl(var(--olivewood) / 0.04)",
      borderTop: "1px solid hsl(var(--olivewood) / 0.1)",
      borderBottom: "1px solid hsl(var(--olivewood) / 0.1)",
    }}
  >
    <div className="container mx-auto max-w-5xl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        {badges.map(({ Icon, label, suffix, accent, tint, fillIcon }) => (
          <div
            key={label}
            className="flex items-center gap-3 justify-center sm:justify-start"
          >
            <div
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center"
              style={{ backgroundColor: tint }}
            >
              <Icon
                className="w-5 h-5"
                style={{ color: accent }}
                strokeWidth={1.75}
                fill={fillIcon ? "currentColor" : "none"}
              />
            </div>
            <div className="min-w-0">
              <div
                className="font-sans font-bold text-ds-15 sm:text-ds-17 leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {label}
              </div>
              <div
                className="font-sans text-ds-11 sm:text-ds-12 leading-tight"
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
              >
                {suffix}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default TrustBadgesStrip;
