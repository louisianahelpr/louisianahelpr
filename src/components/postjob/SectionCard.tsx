import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";

interface SectionCardProps {
  /** 1-based chapter number shown in the corner marker. */
  stepNumber: number;
  /** Bodoni display title — the chapter name. */
  title: string;
  /** Section icon, rendered inside the chapter marker. */
  icon: LucideIcon;
  /** True once the section's required fields are satisfied. */
  complete: boolean;
  children: React.ReactNode;
}

/**
 * SectionCard — the shared "chapter" container for the three Post-a-Task
 * sections (Details / Logistics / Budget). Gives every section the same
 * contained panel, the same internal padding, and the same editorial
 * header: a numbered chapter marker + Bodoni title. This is what turns
 * the wall of fields into three unmistakable chapters.
 */
export function SectionCard({
  stepNumber,
  title,
  icon: Icon,
  complete,
  children,
}: SectionCardProps) {
  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-5 shadow-sm">
      {/* Chapter header — numbered marker, Bodoni title. A divider rule
          under it visually closes the header off from the fields so the
          section reads as a chapter, not a field group. */}
      <header
        className="flex items-center justify-between gap-3 pb-3.5"
        style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Numbered chapter marker — the step number sits behind the
              section icon as a quiet badge, so the chapter ordinal is
              always visible even deep in a long scroll. */}
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-ds-md bg-primary/10 flex items-center justify-center">
              <Icon className="w-[18px] h-[18px] text-primary" strokeWidth={2} />
            </div>
            <span
              className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full font-sans font-bold tabular-nums text-ds-10"
              style={{
                background: complete ? "hsl(var(--bark))" : "hsl(var(--parchment))",
                color: complete ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                boxShadow: "0 0 0 1.5px hsl(var(--bark) / 0.45)",
              }}
            >
              {complete ? <Check className="h-3 w-3" strokeWidth={3.25} /> : stepNumber}
            </span>
          </div>
          <div className="leading-none min-w-0">
            <h2
              className="font-display italic font-bold text-ds-18"
              style={{
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.018em",
              }}
            >
              {title}
            </h2>
          </div>
        </div>
        {complete && (
          <span
            className="shrink-0 rounded-full px-2.5 py-1 font-sans font-semibold uppercase tracking-wider text-ds-10"
            style={{
              background: "hsl(var(--bark) / 0.1)",
              color: "hsl(var(--bark))",
            }}
          >
            Done
          </span>
        )}
      </header>
      {children}
    </section>
  );
}
