import { statValueSize } from "@/lib/statValueSize";

// One stat tile of the Profile "Wrapped" tab, moved out of HelprWrapped.tsx
// unchanged (Q806, god-component ratchet).

export interface StatCardProps {
  label: string;
  value: string;
}

export const StatCard = ({ label, value }: StatCardProps) => (
  <div
    className="rounded-ds-md p-4 text-center space-y-1 flex flex-col items-center justify-center"
    // The wash is --parchment, NOT a literal white. A hard-coded
    // rgba(255,255,255,0.28) is a light-mode glass: on the dark theme it
    // lifted this card to a mid grey (#616362 measured), and the label —
    // --olivewood at 0.8, which is near-WHITE in dark — landed on it at
    // 3.1:1. Nothing about the text could fix that: at full opacity the same
    // label still only reaches 3.7:1, because the card itself is the wrong
    // colour. --parchment is 95% in light and 9% in dark, so the wash is now
    // a light wash on light and a dark wash on dark, which is the same rule
    // CLAUDE.md states for the glass surfaces: the surface's OWN colour, per
    // theme. Light mode barely moves (95% vs pure white).
    style={{
      background: "hsl(var(--parchment) / 0.28)",
      backdropFilter: "blur(12px) saturate(150%)",
      WebkitBackdropFilter: "blur(12px) saturate(150%)",
      border: "0.5px solid hsl(var(--parchment) / 0.5)",
      boxShadow:
        "inset 0 1px 1px 0 hsl(var(--parchment) / 0.6), 0 2px 8px -2px hsl(var(--olivewood) / 0.12)",
    }}
  >
    <p
      className={`${statValueSize(value)} font-sans font-bold leading-none max-w-full`}
      style={{ color: "hsl(var(--ink-deep))" }}
    >
      {value}
    </p>
    <p className="text-ds-11 font-sans font-semibold uppercase tracking-wider leading-tight" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {label}
    </p>
  </div>
);
