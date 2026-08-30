import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

/**
 * AppPage — the shell every signed-in sub-screen wears.
 *
 * The point of this file is that Host Automation, Gift Card and Benefits &
 * Perks render through the SAME component as Schedule, Availability, Saved
 * Helprs and Licensed & Insured (owner, 2026-08-30: "all of them should be the
 * same though ... what does schedule availability saved helpr license and
 * insured use? that's what host gift and benefits needs to use").
 *
 * Those four are Profile TABS: they render inside Profile.tsx's AppShell, in a
 * `container` → `page-measure` scroll column, with `ProfileTabHeader` as their
 * title. The other three were standalone ROUTES that had each hand-assembled a
 * near-copy of that arrangement — which is how they drifted (different
 * paddings, one missing `topInsetHandled`, all three on a `min-h-screen`
 * document-scroll wrapper the tabs never had).
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
  /** Trailing actions on the title row (icon buttons, overflow menus). */
  titleActions?: ReactNode;
  /** Page content. */
  children: ReactNode;
}

export function AppPage({ title, backTo, titleActions, children }: AppPageProps) {
  return (
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="w-full page-measure mx-auto h-full overflow-y-auto px-3 -mx-3 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]">
          <div className="animate-ds-page-in">
            {/* `space-y-4` is the shared tab shell — the same wrapper every
                Profile tab uses, asserted byte-for-byte by
                profileTabShell.test.ts. ProfileTabHeader's `-mb-4` is keyed to
                this exact value to cancel the margin it would otherwise add
                below the title. */}
            <div className="space-y-4">
              <ProfileTabHeader title={title} backTo={backTo} rightSlot={titleActions} />
              {children}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default AppPage;
