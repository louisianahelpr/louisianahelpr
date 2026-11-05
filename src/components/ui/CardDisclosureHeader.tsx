import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The open/close header of a settings card that folds its form away (Q2709, 11-05: Declutter's "I can deliver" and
 * "Police spot meetup times" cards each hand-made the same row). An icon, a bold title, a one-line summary of what is
 * saved, and a chevron that turns when open; the whole row is the 44px+ tap target and says aria-expanded.
 */
export function CardDisclosureHeader({ icon: Icon, title, summary, open, onToggle, disabled }: {
  icon: LucideIcon;
  title: ReactNode;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left" aria-expanded={open} disabled={disabled} onClick={onToggle}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{summary}</span>
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </button>
  );
}
