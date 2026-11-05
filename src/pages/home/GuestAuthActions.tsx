import { Button } from "@/components/ui/button";

/**
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
export function GuestAuthActions({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={onLogin}
        className="text-ds-11 h-11 px-2 font-sans font-semibold"
        style={{ color: "hsl(var(--ink-deep) / 0.72)" }}
      >
        Log in
      </Button>
      <Button
        size="sm"
        onClick={onSignup}
        className="text-ds-11 h-11 px-3 font-sans font-semibold btn-press"
        style={{ color: "hsl(var(--parchment))" }}
      >
        Join free
      </Button>
    </>
  );
}
