import { Link } from "react-router-dom";
import { ChevronRight, Truck } from "lucide-react";

/** Deliver (Helprs who carry items for pay) left the tab row; its view stays at ?view=deliver. */
export function DeliverEntry() {
  return (
    <Link
      to="/declutter?view=deliver"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Truck className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Deliver for pay</span>
        <span className="block text-xs text-muted-foreground">Carry Declutter items for buyers near you</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
