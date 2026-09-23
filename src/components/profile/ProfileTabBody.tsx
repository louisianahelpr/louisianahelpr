import type { CSSProperties, ReactNode } from "react";

/**
 * ProfileTabBody — the ONE box every Profile tab renders into.
 *
 * WHY THIS EXISTS (owner, 2026-09-19, twice in one evening):
 * "do all profile tabs share the same shell as gift card and home history?
 * bc those 2 pages dont have the gaps like the other pages and i dont want
 * the other profile tabs to have that."
 *
 * Until now the answer was "by convention". Twenty-five tabs each hand-typed
 * `<div className="space-y-4">` above their own `<ProfileTabHeader>`, bound
 * together by nothing but a comment repeated in eight files saying "the
 * canonical Profile-tab body". A comment is not a binding: on 2026-09-19 a
 * lane added `px-3` to GiftCard.tsx's copy of that div and shipped it, and
 * gift_card alone rendered 12px narrower than the other twenty-four —
 * measured at 1440 as a 36px gutter against everybody else's 24px. Nothing
 * failed, because there was no single definition for anything to disagree
 * with.
 *
 * So the value lives here, once, and the tabs render this instead of a div.
 * The component takes NO `className` and NO `style` on purpose: an escape
 * hatch that accepts arbitrary classes is how `px-3` got in, and would let
 * the next one in the same way. A tab that genuinely needs the box to differ
 * adds a NAMED prop here — the project rule is "add a prop rather than fork
 * one" (CLAUDE.md, UI) — so the variation is declared in this file where
 * every other tab can see it, rather than hidden in one page's JSX.
 *
 * `bottomClearance` is the first and so far only such prop: Profile Edit and
 * Legal both float a save bar / dock over the end of a long scroll and need
 * the last card to clear it. That is a vertical concern and cannot reopen the
 * horizontal gutter the owner reported.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN: the horizontal inset itself. That
 * comes from Profile.tsx's shared panel (`.animate-ds-page-in`), one layer
 * up, which is also what keeps Profile agreeing with Dashboard / Posts /
 * Jobs / Messages. This box just refuses to add to it.
 *
 * Guarded by profileTabShell.test.ts (static: every tab in the real `Tab`
 * registry renders through this primitive, and no tab hand-rolls a wrapper)
 * and e2e/journeys/profile-tab-shell-parity.spec.ts (pixels: all tabs agree
 * on one gutter at 1440 and 375).
 */

/**
 * The tab body's own classes. Exported ONLY so the guard can assert what it
 * is; render `<ProfileTabBody>`, never this string.
 */
export const PROFILE_TAB_BODY_CLASS = "space-y-4";

export interface ProfileTabBodyProps {
  children: ReactNode;
  /**
   * Extra room under the last card, for tabs that float something over the
   * end of the scroll (a save bar, the legal dock). A CSS length; it is
   * applied as `padding-bottom` and nothing else.
   */
  bottomClearance?: string;
  /** Passed through for decorative-only bodies (the Earnings skeleton). */
  "aria-hidden"?: boolean;
  /** Passed through for the few bodies a test targets directly. */
  "data-testid"?: string;
}

export const ProfileTabBody = ({
  children,
  bottomClearance,
  "aria-hidden": ariaHidden,
  "data-testid": testId,
}: ProfileTabBodyProps) => {
  const style: CSSProperties | undefined = bottomClearance
    ? { paddingBottom: bottomClearance }
    : undefined;
  return (
    <div
      className={PROFILE_TAB_BODY_CLASS}
      style={style}
      aria-hidden={ariaHidden}
      data-testid={testId}
    >
      {children}
    </div>
  );
};

