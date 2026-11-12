/**
 * BUY-16 (audit 10-30, High). Owner 10-30: "Guests see Declutter Browse and item pages; sign up to buy or offer; no
 * seller full name or address." Every Declutter link, shared listings and "Post to Facebook" included, went to the
 * login wall. A signed-out visitor now reads a listing while Declutter is open to everyone (features_open_to_everyone,
 * the landing's own answer); the server reads are the anon policies of 20261031060656_declutter_guest_read.sql.
 * While Declutter is not open to everyone, a guest still gets the login wall, as before. A read that FAILED (H2, audit
 * 11-08) shows the page: the wall is only for a definite "not open".
 */
import { useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IdCard, Star } from "lucide-react";
import { fetchGuestSellerCard, pickupsLabel } from "@/lib/declutter/api";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { HelprMark } from "@/components/HelprMark";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { DESKTOP_BAR_PAD_TOP } from "@/lib/desktopBar";
import { useMarkGuestTopBarOn } from "@/lib/guestTopBar";

function here(location: { pathname: string; search: string }): string {
  return encodeURIComponent(location.pathname + location.search);
}

/**
 * F359o (audit 11-10): the seller was reading their OWN listing when the session ended (sign-out elsewhere, token
 * expiry). The page quietly turned into the guest view ("Signing up is free..."), as if they had never had an
 * account. Remember that this viewer owned the listing earlier in this page view; once signed out, say so instead.
 */
export function useSignedOutOwner(ownListing: boolean, signedIn: boolean): boolean {
  const ownedBefore = useRef(false);
  if (ownListing) ownedBefore.current = true;
  return !signedIn && ownedBefore.current;
}

/** F359o: what the signed-out seller sees in place of the guest join line; Log in brings them back here. */
export function DeclutterSignedOutOwner() {
  const location = useLocation();
  return (
    <div data-signed-out-owner="" role="status" className="space-y-2 rounded-2xl border border-border bg-card p-3 text-sm">
      <p>You've been signed out. Log in again to manage this listing.</p>
      <Button asChild size="sm">
        <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
      </Button>
    </div>
  );
}

/** DeclutterGate's signed-out branch: the page while Declutter is open to everyone, the login wall otherwise. */
export function DeclutterGuestGate({ children, skeleton }: { children: ReactNode; skeleton: ReactNode }) {
  const location = useLocation();
  const { open, settled, failed } = useSectionsOpen(true);
  if (!settled) return <>{skeleton}</>;
  // H2 (audit 11-08): a failed read (after its retries) FAILS OPEN to the public page, never the login wall. The
  // server's anon reads still refuse anything while Declutter is not open to everyone.
  if (failed || open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>;
  return <Navigate to={`/login?redirect=${here(location)}`} replace />;
}

/**
 * AUD31-67 (Guests on Declutter): a guest who opened a shared Declutter link had no brand and no way to the rest of
 * Louisiana Helpr. The H mark, a link to the landing page, sits in each guest join panel (Browse and item).
 */
function GuestBrand() {
  return (
    <span data-guest-brand="" className="inline-flex shrink-0">
      {/* The H alone, as everywhere else (owner 2026-11-03, Q2042 option 1). */}
      <HelprMark to="/" size="sm" emblemOnly />
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
  // F047: AppShell keeps this bar's room while it is drawn, so the page's header sits below it, never under it.
  useMarkGuestTopBarOn(isWebDesktop);
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

/**
 * A guest's Buy now / Make an offer (or Ask for it). Owner pick 1 (11-08, design audit B §5.6): a visitor from a
 * Facebook link sees the REAL buttons in the same sticky bar as a member; a tap goes to sign up and comes back to this
 * item (?redirect). Before, a sign-up card stood where the Buy button should be. One quiet line under the price block
 * says joining is free, with a Log in link for members on another device.
 * AUD31-68: a listing that takes no offers (accepts_offers false, Buy now only) never mentions an offer.
 */
export function DeclutterGuestJoin({ free, offers = true, trades = false }: { free: boolean; offers?: boolean; trades?: boolean }) {
  const location = useLocation();
  // AUD31-67 follow-up (lead 10-31): at desktop width the guest top bar already carries the logo, so the brand shows
  // only on a phone.
  const barShown = useIsWebDesktop();
  const label = free ? "Ask for this item" : offers ? "Buy or make an offer" : "Buy this item";
  const signup = `/signup?redirect=${here(location)}`;
  return (
    <section data-guest-join="" aria-label={label} className="space-y-3 lg:contents">
      <StickyActionBar label={label} spacer={false} data-guest-buttons="" pinWide>
        {!free && offers && (
          <Button asChild variant="outline" size="wrap" className="rounded-full px-3 font-semibold">
            <Link to={signup} data-guest-offer="">Make offer</Link>
          </Button>
        )}
        <Button asChild size="wrap" className="rounded-full px-3">
          <Link to={signup} data-guest-buy="">{free ? "Sign up to ask for it" : "Buy now"}</Link>
        </Button>
      </StickyActionBar>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {/* F048 / F059 (owner UI audit 11-09, newest wording): it is SIGNING UP that is free, never read as the item. */}
          Signing up is free. We'll bring you back to this item.
        </p>
        {/* The desktop guest bar already has Log in (AUD31-67 follow-up): only a phone gets it here. Audit 1110 F318: as
            an inline underlined word it measured 36x14px; it is a 44px (h-11) outline pill now, like the Browse card's. */}
        {!barShown && (
          <div className="flex shrink-0 items-center gap-2" data-guest-login="">
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
            </Button>
            <GuestBrand />
          </div>
        )}
      </div>
      {/* Trades audit 11-08 #3: a trade is one of the member's own listings, so a guest needs both. */}
      {trades && <p data-guest-trades="" className="text-xs text-muted-foreground">Sign in and list an item to offer a trade.</p>}
    </section>
  );
}

/**
 * Audit 11-10 F402: what a signed-out order, offer or order-talk link (from an email or text) is asking for, in words;
 * null for a plain Browse visit. The link already comes back here after log in; the card just has to say so.
 */
function guestWants(search: string): string | null {
  const q = new URLSearchParams(search);
  if (q.has("offer")) return "Log in to see your offer";
  if (q.has("order") || q.has("order_talk") || q.get("tab") === "buying") return "Log in to see your order";
  if (q.get("tab") === "selling") return "Log in to see your sales";
  // F359k: the "post what you want" link (?tab=wanted&post=1) and the Wanted tab itself.
  if (q.has("post")) return "Log in to post what you want";
  if (q.get("tab") === "wanted") return "Log in to see your Wanted posts";
  return null;
}

/** Above a guest's Browse (BUY-16): one line and the two ways in, coming back to Browse after. */
export function DeclutterGuestBrowseJoin() {
  const location = useLocation();
  const want = guestWants(location.search);
  // AUD31-67 follow-up (lead 10-31): the desktop guest top bar has the logo; the H stays on the phone only.
  const barShown = useIsWebDesktop();
  // Owner 11-10: at desktop width the guest top bar already carries Log in / Sign up, so this card is not repeated there.
  if (barShown) return null;
  return (
    <section data-guest-join="browse" aria-label="Join to buy or sell" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card p-3">
      {!barShown && <GuestBrand />}
      <p className="min-w-0 flex-1 basis-48 text-sm">
        {want ? (
          // F402: the link is to something of theirs; Log in is the main button, Sign up the aside.
          <>
            <span className="font-semibold">{want}</span>{" "}
            <span className="text-muted-foreground">New here?</span>
          </>
        ) : (
          <>
            <span className="font-semibold">Sign up to buy, make offers or sell.</span>{" "}
            <span className="text-muted-foreground">It's free.</span>
          </>
        )}
      </p>
      <div className="flex shrink-0 gap-2" data-guest-join-buttons="">
        <Button asChild size="sm" variant={want ? "default" : "outline"} className="rounded-full">
          <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
        </Button>
        <Button asChild size="sm" variant={want ? "outline" : "default"} className="rounded-full">
          <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * A guest's seller card (BUY-16; F227/F319, owner 11-11: "first name + last initial, rating, ID-checked badge (no
 * photo, no profile page)"). From declutter_guest_seller_card: "Ann S.", stars only when the seller has reviews, and
 * "ID checked" only when the server says so, and (F359d) "12 pickups" when they have any. A monogram, never the photo; not a link (a member's page is for members).
 * Nothing while it loads, on a failed read, or with no row: the listing reads the same without it.
 */
export function DeclutterGuestSeller({ itemId, free = false }: { itemId: string; free?: boolean }) {
  const card = useQuery({ queryKey: ["declutter", "guest-seller-card", itemId], queryFn: () => fetchGuestSellerCard(itemId) });
  const c = card.data;
  if (!c) return null;
  return (
    <div data-guest-seller="" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">
        {c.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        {/* F049 (UI audit 11-09): a giveaway is given, not sold. */}
        <span className="block text-xs text-muted-foreground">{free ? "Given by" : "Sold by"}</span>
        <span className="block truncate font-semibold">{c.name}</span>
        {c.avg !== null && c.count > 0 && (
          <span data-guest-seller-rating="" className="flex items-center gap-1 text-xs text-foreground">
            <Star className="h-3.5 w-3.5 fill-primary text-primary" aria-hidden />
            <span className="font-semibold">{c.avg.toFixed(1)}</span>
            <span className="text-muted-foreground">
              <span className="sr-only"> stars from </span>
              <span aria-hidden>·</span> {c.count} review{c.count === 1 ? "" : "s"}
            </span>
          </span>
        )}
        {/* F359d (owner 11-11): the completed pickup count, nothing else about them; none at 0. */}
        {c.pickups > 0 && <span data-guest-seller-pickups="" className="block text-xs text-foreground">{pickupsLabel(c.pickups)}</span>}
        {c.idChecked && (
          <span data-guest-seller-id="" className="mt-1 inline-flex items-center gap-1 rounded-full bg-[hsl(var(--bark)/0.08)] px-2 py-0.5 text-xs font-semibold text-foreground">
            <IdCard className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ID checked
          </span>
        )}
      </span>
    </div>
  );
}
