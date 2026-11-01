/**
 * BUY-16 (audit 10-30, High). Owner 10-30: "Guests see Declutter Browse and item pages; sign up to buy or offer; no
 * seller full name or address." Every Declutter link, shared listings and "Post to Facebook" included, went to the
 * login wall. A signed-out visitor now reads a listing while Declutter is open to everyone (features_open_to_everyone,
 * the landing's own answer); the server reads are the anon policies of 20261031060656_declutter_guest_read.sql.
 * While Declutter is not open to everyone, a guest still gets the login wall, as before.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGuestSellerFirstName } from "@/lib/declutter/api";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HelprMark } from "@/components/HelprMark";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { DESKTOP_BAR_PAD_TOP } from "@/lib/desktopBar";

function here(location: { pathname: string; search: string }): string {
  return encodeURIComponent(location.pathname + location.search);
}

/** DeclutterGate's signed-out branch: the page while Declutter is open to everyone, the login wall otherwise. */
export function DeclutterGuestGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const location = useLocation();
  const { open, settled } = useSectionsOpen(true);
  if (!settled) return <>{skeleton}</>;
  if (open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>;
  return <Navigate to={`/login?redirect=${here(location)}`} replace />;
}

/**
 * AUD31-67 (Guests on Declutter): a guest who opened a shared Declutter link had no brand and no way to the rest of
 * Louisiana Helpr. The H mark, a link to the landing page, sits in each guest join panel (Browse and item).
 */
function GuestBrand() {
  return (
    <span data-guest-brand="" className="inline-flex shrink-0">
      <HelprMark to="/" size="sm" />
    </span>
  );
}

/**
 * AUD31-67, the rest: at desktop width AppShell keeps the top bar's band (DESKTOP_BAR_H, src/lib/desktopBar.ts) on
 * every page, but that bar (DesktopTopNav) is drawn only for a member, so a guest saw an empty 70px band above
 * "Declutter" with no header. A guest gets a slim bar in that band instead: the H logo (home) at the left, Log in and
 * Sign up at the right, both coming back to this page. Same height as the member's bar (its top pad plus an h-14
 * row). Phone widths keep no band, so nothing is drawn there.
 * Guard: src/components/declutter/declutterGuestTopBar.test.tsx.
 */
function DeclutterGuestTopBar() {
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const bannerOffset = useOfflineBannerOffset();
  if (!isWebDesktop) return null;
  return (
    <header
      data-guest-top-bar=""
      className="fixed left-0 right-0 z-50 glass-nav"
      style={{ paddingTop: DESKTOP_BAR_PAD_TOP, top: bannerOffset || 0, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
    >
      <div className="w-full flex h-14 items-center justify-between gap-3 px-6">
        <HelprMark to="/" size="md" emblemOnly />
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="rounded-full px-3">
            <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full px-4">
            <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** In place of Buy now / Make an offer (or Ask for it) for a guest: sign up, or log in, and come back to this item.
 *  AUD31-68: a listing that takes no offers (accepts_offers false, Buy now only) never mentions an offer. */
export function DeclutterGuestJoin({ free, offers = true }: { free: boolean; offers?: boolean }) {
  const location = useLocation();
  // AUD31-67 follow-up (lead 10-31): at desktop width the guest top bar already carries the logo, Log in and Sign up,
  // so the panel keeps only its item-specific message there. Phone widths have no bar and keep everything.
  const barShown = useIsWebDesktop();
  const label = free ? "Ask for this item" : offers ? "Buy or make an offer" : "Buy this item";
  return (
    <section data-guest-join="" aria-label={label} className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{free ? "Sign up to ask for it." : offers ? "Sign up to buy it or make an offer." : "Sign up to buy it."}</p>
        {!barShown && <GuestBrand />}
      </div>
      {!barShown && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild size="wrap" className="w-full rounded-full">
            <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
          </Button>
          <Button asChild size="wrap" variant="outline" className="w-full rounded-full">
            <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">It's free. You come back to this item after.</p>
    </section>
  );
}

/** Above a guest's Browse (BUY-16): one line and the two ways in, coming back to Browse after. */
export function DeclutterGuestBrowseJoin() {
  const location = useLocation();
  // AUD31-67 follow-up (lead 10-31): the desktop guest top bar has the logo and both buttons; the line stays.
  const barShown = useIsWebDesktop();
  return (
    <section data-guest-join="browse" aria-label="Join to buy or sell" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card p-3">
      {!barShown && <GuestBrand />}
      <p className="min-w-0 flex-1 basis-48 text-sm">
        <span className="font-semibold">Sign up to buy, make offers or sell.</span>{" "}
        <span className="text-muted-foreground">It's free.</span>
      </p>
      {!barShown && (
        <div className="flex shrink-0 gap-2">
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full">
            <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * A guest's seller line (BUY-16): the first name only, never the full name, no avatar, no link to the profile (a
 * member's page). Nothing while it loads, on a failed read, or with no name: the listing reads the same without it.
 */
export function DeclutterGuestSeller({ itemId }: { itemId: string }) {
  const first = useQuery({ queryKey: ["declutter", "guest-seller", itemId], queryFn: () => fetchGuestSellerFirstName(itemId) });
  if (!first.data) return null;
  return (
    <p data-guest-seller="" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">
        {first.data.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">Sold by</span>
        <span className="block truncate font-semibold">{first.data}</span>
      </span>
    </p>
  );
}
