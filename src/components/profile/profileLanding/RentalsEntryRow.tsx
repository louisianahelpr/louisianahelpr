import { ChevronRight, Home } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeature } from "@/hooks/useFeature";

/**
 * The entry to Rentals (docs/specs/landlord-hub-prep.md) on the Profile
 * landing while the hidden 'rentals' switch is on for this member; nothing at
 * all otherwise. One row for everyone (never role-based): landlords and
 * tenants both land on /rentals.
 */
export function RentalsEntryRow() {
  const on = useFeature("rentals");
  if (!on) return null;
  return (
    <Link
      to="/rentals"
      className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Home className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm">Rentals</span>
        <span className="block text-xs text-muted-foreground">Repair requests between tenants and landlords</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
