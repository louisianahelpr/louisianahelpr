import { ChevronRight, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

/**
 * The phone entry to Quotes (owner answer 12, 2026-10-17: quote requests are
 * found BOTH through the "Wants quotes" filter in Jobs browse AND a Quotes link
 * in the menu), on the Profile landing beside Declutter's, while the hidden
 * 'quotes' switch is on for this member; nothing at all otherwise. The desktop
 * rail lists it as a destination too (DesktopSidebarNav).
 */
export function QuotesEntryRow() {
  const on = useFeature("quotes");
  if (!on) return null;
  return (
    <Link
      to="/quotes"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileText className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Quotes</span>
        <span className="block text-xs text-muted-foreground">Ask for prices on a job, or send yours</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
