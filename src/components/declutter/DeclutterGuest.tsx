/**
 * BUY-16 (audit 10-30, High). Owner 10-30: "Guests see Declutter Browse and item pages; sign up to buy or offer; no
 * seller full name or address." Every Declutter link, shared listings and "Post to Facebook" included, went to the
 * login wall. A signed-out visitor now reads a listing while Declutter is open to everyone (features_open_to_everyone,
 * the landing's own answer); the server reads are the anon policies of 20261031060656_declutter_guest_read.sql.
 * While Declutter is not open to everyone, a guest still gets the login wall, as before.
 */
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";

function here(location: { pathname: string; search: string }): string {
  return encodeURIComponent(location.pathname + location.search);
}

/** DeclutterGate's signed-out branch: the page while Declutter is open to everyone, the login wall otherwise. */
export function DeclutterGuestGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const location = useLocation();
  const { open, settled } = useSectionsOpen(true);
  if (!settled) return <>{skeleton}</>;
  if (open?.has("declutter")) return <>{children}</>;
  return <Navigate to={`/login?redirect=${here(location)}`} replace />;
}

/** In place of Buy now / Make an offer (or Ask for it) for a guest: sign up, or log in, and come back to this item. */
export function DeclutterGuestJoin({ free }: { free: boolean }) {
  const location = useLocation();
  return (
    <section data-guest-join="" aria-label={free ? "Ask for this item" : "Buy or make an offer"} className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold">{free ? "Sign up to ask for it." : "Sign up to buy it or make an offer."}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild size="wrap" className="w-full rounded-full">
          <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
        </Button>
        <Button asChild size="wrap" variant="outline" className="w-full rounded-full">
          <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">It's free. You come back to this item after.</p>
    </section>
  );
}

/** Above a guest's Browse (BUY-16): one line and the two ways in, coming back to Browse after. */
export function DeclutterGuestBrowseJoin() {
  const location = useLocation();
  return (
    <section data-guest-join="browse" aria-label="Join to buy or sell" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card p-3">
      <p className="min-w-0 flex-1 basis-48 text-sm">
        <span className="font-semibold">Sign up to buy, make offers or sell.</span>{" "}
        <span className="text-muted-foreground">It's free.</span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button asChild size="sm" className="rounded-full">
          <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
        </Button>
      </div>
    </section>
  );
}
