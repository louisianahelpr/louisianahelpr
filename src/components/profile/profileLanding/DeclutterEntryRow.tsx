import { ChevronRight, Sofa } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

/**
 * The phone entry to Declutter (docs/specs/declutter-auctions.md row 1), on
 * the Profile landing while the hidden 'declutter' switch is on for this
 * member; nothing at all otherwise. The desktop rail lists it as a
 * destination too (DesktopSidebarNav). A tab of its own in the phone dock
 * waits for a look at 375 with six tabs (spec build decision B21).
 */
export function DeclutterEntryRow() {
  const on = useFeature("declutter");
  if (!on) return null;
  return (
    <Link
      to="/declutter"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Sofa className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Declutter</span>
        <span className="block text-xs text-muted-foreground">Buy and sell used household items near you</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
