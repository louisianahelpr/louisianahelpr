import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

/**
 * AppPage — the shell every signed-in sub-screen wears.
 *
 * The point of this file is that Host Automation and Gift Card render through
 * the SAME component as Schedule, Availability, Saved Helprs and Licensed &
 * Insured (owner, 2026-08-30: "all of them should be the same though ... what
 * does schedule availability saved helpr license and insured use? that's what
 * host gift and benefits needs to use"). Benefits & Perks was the third page
 * in that quote; it was deleted on 2026-08-31 (no partner agreements behind
 * it), which changes nothing about why the shell is shared.
 *
 * Those four are Profile TABS: they render inside Profile.tsx's AppShell, in a
 * `container` → `page-measure` scroll column, with `ProfileTabHeader` as their
 * title. The standalone ROUTES had each hand-assembled a near-copy of that
 * arrangement — which is how they drifted (different paddings, one missing
 * `topInsetHandled`, all of them on a `min-h-screen` document-scroll wrapper
 * the tabs never had).
 *
 * So this replicates the tab shell verbatim rather than inventing a third
 * layout. Every class string below is copied from Profile.tsx; if that shell
 * changes, this changes with it.
 *
 * What it owns, and what a page must therefore NOT re-implement:
 *
 *  1. THE VIEWPORT. {@link AppShell} is the single fixed-viewport primitive
 *     (CLAUDE.md) — the 100dvh lock, the internal scroll container, the bottom
 *     nav clearance. `scrollable={false}` + `contentClassName="overflow-hidden"`
 *     because the scrolling happens in the inner column below, exactly as on
 *     the Profile tabs. A page using AppPage must NOT also be listed in
 *     `DOCUMENT_SCROLL_ROUTES`: that stacks `html { overflow: hidden }` on top
 *     of this scroller, the iOS double-rubber-band that list warns about.
 *
 *  2. THE SAFE-AREA INSET, applied in exactly ONE layer — `pt-safe-top` on the
 *     AppShell, which is where PageScaffold puts it too. The container below
 *     deliberately carries no top padding of its own: doing that is what put
 *     36px above a Profile tab title against 16px below it.
 *
 *  3. THE TITLE, via ProfileTabHeader → PageHeader, so the 24px of air above
 *     and below it is the app-wide value and moves in one place.
 */
interface AppPageProps {
  /** Page title — the one `h1`. */
  title: string;
  /**
   * Where the back chevron goes when there is no in-app history (a deep link
   * or a cold open). Most sub-screens are reached from the Profile landing.
   */
  backTo?: string;
  /**
   * Custom back handler, for a page whose "back" is not a route change.
   * PostJob uses it: its back steps the multi-step form backwards and only
   * leaves the route from the first step. Prefer `backTo` on a plain route —
   * see the note on ProfileTabHeader about an onClick short-circuiting
   * BackButton's history pop.
   */
  onBack?: () => void;
  /** Trailing actions on the title row (icon buttons, overflow menus). */
  titleActions?: ReactNode;
  /** Page content. */
  children: ReactNode;
}

function AppPage({ title, backTo, onBack, titleActions, children }: AppPageProps) {
  return (
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* NO `mx-auto` here, and that is the whole point of this line.
            `.page-measure` already centres itself (`margin-inline: auto`, one
            definition in index.css), so the utility was redundant — and it was
            not harmless: `mx-auto` and `-mx-3` both set margin-inline, and the
            utility layer resolved in `mx-auto`'s favour, so the negative
            margin that was supposed to CANCEL `px-3` never applied. The pair
            reads as a no-op bleed (pad 12, pull 12 back) and shipped as a
            naked +12px inset per side on every AppPage screen and every
            Profile tab.

            Measured at 375 (dev server, Chromium), first content card:
              Dashboard (PageScaffold) ... 335px wide at x=20
              Availability (AppPage) ..... 311px wide at x=32   ← 12px in
            and at 1440: 1096 @ x=48 vs 1072 @ x=60, the same 12px.
            The whole family of fixed-shell pages was inset one step further
            than its PageScaffold siblings, which is the "gap on the left and
            right / small shadow" the owner reported.

            `px-3` stays and is now genuinely cancelled: the padding is what
            keeps a card's focus ring and shadow off this scroll container's
            `overflow` clip. */}
        <div className="page-measure w-[calc(100%+1.5rem)] h-full overflow-y-auto px-3 -mx-3 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]">
          <div className="animate-ds-page-in">
            {/* `space-y-4` is the shared tab shell — the same wrapper every
                Profile tab uses, asserted byte-for-byte by
                profileTabShell.test.ts. ProfileTabHeader's `-mb-4` is keyed to
                this exact value to cancel the margin it would otherwise add
                below the title. */}
            <div className="space-y-4">
              <ProfileTabHeader title={title} backTo={backTo} onBack={onBack} rightSlot={titleActions} />
              {children}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default AppPage;
