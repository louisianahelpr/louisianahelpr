import { ChevronRight, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

/**
 * The phone entry to Shops (docs/specs/local-shops-prep.md L1-L2), on the
 * Profile landing while the hidden 'shops' switch is on for this member;
 * nothing at all otherwise. The desktop rail lists it too
 * (DesktopSidebarNav). Its own tab in the phone dock waits for the G2b
 * navigation change (build queue item 12), as Declutter's does.
 */
export function ShopsEntryRow() {
  const on = useFeature("shops");
  if (!on) return null;
  return (
    <Link
      to="/shops"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Store className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Shops</span>
        <span className="block text-xs text-muted-foreground">Local makers, trades and businesses, or open your own free shop</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
