import { statValueSize } from "@/lib/statValueSize";

// One stat tile of the Profile "Wrapped" tab, moved out of HelprWrapped.tsx
// unchanged (Q806, god-component ratchet).

export interface StatCardProps {
  label: string;
  value: string;
  /** A dollar figure: rust (spec v2 §1.1). */
  money?: boolean;
}

// Spec v2 rebuild (audit 2026-10-21): a plain tile on the ground colour with a
// sentence-case muted label, not a frosted box with an uppercase tracked one.
export const StatCard = ({ label, value, money = false }: StatCardProps) => (
  <div className="rounded-[20px] bg-muted p-4 text-center space-y-1 flex flex-col items-center justify-center">
    <p
      className={`${statValueSize(value)} font-sans font-bold leading-none max-w-full tabular-nums`}
      style={{ color: money ? "hsl(var(--accent-ink))" : "hsl(var(--ink-deep))" }}
    >
      {value}
    </p>
    <p className="text-ds-12 font-sans leading-tight text-muted-foreground">
      {label}
    </p>
  </div>
);
