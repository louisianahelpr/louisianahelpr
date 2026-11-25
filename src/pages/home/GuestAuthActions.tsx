import { Link } from "react-router-dom";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { wordInLang } from "@/lib/i18n/inLang";

/**
 * Owner 11-25 ("there is no way for signed out people to see the gift guides", on the app's signed-out Jobs and
 * Declutter): the gift icon, then ONE "Join / Log in" pill (owner 11-22's phone header words, Navbar), in place of
 * the separate "Log in" and "Join free" this used to draw. The notes below are the history of the pair.
 * Guard: src/test/phoneCompactBrowse1125.test.tsx.
 *
 * The guest feed's trailing controls — the signed-out counterpart to Home's
 * notification bell, occupying the same slot at the end of the title bar's
 * single row.
 *
 * "Log in" is a plain text control; "Join free" is the SOLID primary button,
 * matching the marketing nav's signup CTA (Navbar.tsx) so the one conversion
 * action on the site looks the same wherever a guest meets it. That parity is
 * the point — /jobs and /browse are the two guest browse surfaces, and V9 of
 * the 2026-08-24 visual audit found them disagreeing about how to draw it.
 *
 * This button used to be a quiet bark-tinted OUTLINE pill, on the stated
 * grounds that "the only solid-green element on the guest feed stays the
 * bottom '+' FAB". That rationale was already void when it was written:
 * MobileNav.tsx returns null for guests (`if (isGuest) return null`), so the
 * guest feed has no dock and no FAB. There was nothing to avoid competing
 * with — the screen simply had no primary-weight target at all.
 *
 * The fill itself comes from the `default` variant's `btn-grad-primary` — a
 * background-IMAGE gradient, not a background-color, so `backgroundColor`
 * computes as transparent on this button and a probe that samples only that
 * property will wrongly report it unfilled. Check the gradient or the pixels.
 *
 * The inline parchment `color` is belt-and-braces on top of the variant's own
 * `!text-…` pinning, kept for the reason Navbar documents: the
 * text-primary-foreground → --parchment token chain has repeatedly resolved
 * dark-on-olive in the iOS WebView, and this is the guest surface that WebView
 * actually shows.
 *
 * These two are the entire conversion path of the screen, so they stay
 * full-width labelled controls at every breakpoint: never collapsed to icons,
 * never folded into an overflow menu, never below the 44px tap floor. What
 * yields first if the row ever runs out of room is the emblem (see
 * DashboardTitleBar) — a visitor can find the front door again; they cannot
 * guess a hidden CTA. With no search/filter icons sharing the row, the pair
 * has room to spare even at 320.
 *
 * Tight horizontal padding rather than the button default (`sm` = px-4): it is
 * the only slack in this row that costs nothing — the labels and the 44px tap
 * heights are untouched. "Log in" keeps `px-2` (a text control needs no box);
 * the solid "Join free" (once "Get started", owner 2026-10-21) takes `px-3` so its filled pill has room to read as
 * a button rather than a label with a background.
 *
 * Measured at 375 after the change: the title card is 335px wide, "Log in" is
 * 51px at x=190, and "Get started" is 88px ending at x=334 — 21px of card
 * padding still to spare, and documentElement.scrollWidth === clientWidth.
 * Going solid cost the button 6px (82 → 88); the row absorbed it.
 */
export function GuestAuthActions({ onSignup }: { onSignup: () => void }) {
  return (
    <>
      {/* A plain 44px-tall link with no circle (search-is-an-icon), named "Gift guides", like the web phone bar's
          (Navbar, nav-gift-guides-phone). */}
      <Link
        to="/gift-guides"
        aria-label={wordInLang("pub.giftGuides", "Gift guides")}
        data-testid="top-bar-gift-guides"
        className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-foreground btn-press hover:text-[hsl(var(--bark))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Gift aria-hidden className="h-5 w-5" />
      </Link>
      <Button
        size="sm"
        onClick={onSignup}
        data-testid="top-bar-join"
        className="text-ds-11 h-11 px-3 font-sans font-semibold btn-press whitespace-nowrap"
        style={{ color: "hsl(var(--parchment))" }}
      >
        {wordInLang("g.joinOrLogIn", "Join / Log in")}
      </Button>
    </>
  );
}
