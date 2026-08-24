import type { ReactNode } from "react";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";

interface DashboardTitleBarProps {
  /** Where the emblem links. Home points at itself; the signed-out guest
   *  feed points at the marketing landing, which is the page a visitor who
   *  taps the crest is actually looking for. */
  emblemTo?: string;
  /**
   * Live-state control rendered immediately before {@link trailing}.
   *
   * Home puts its in-progress / upcoming job pill here, so the reminder rides
   * the pinned band of chrome and stays reachable no matter how far the feed
   * is scrolled. The guest feed has no session and passes nothing.
   *
   * Kept separate from `trailing` rather than folded into it so the `-mr-2`
   * rule below still keys off "is the LAST control a bare icon button?" — the
   * pill is neither last nor an icon button.
   */
  status?: ReactNode;
  /**
   * Controls pinned to the trailing end of the row. Defaults to the
   * notification bell.
   *
   * The guest feed passes its "Log in" / "Get started" pair instead: a bell
   * is meaningless with no session, and those two ARE the signed-out screen's
   * entire conversion path, so they occupy the same slot the bell holds for a
   * signed-in user rather than being demoted to a second bar. They stay full
   * labelled controls — never icons, never behind a menu.
   */
  trailing?: ReactNode;
  /**
   * Screen controls (search · filters) placed in the SAME row as the bell,
   * immediately to its left. They used to live in a second header row under
   * this card, which cost a full 44px band that was visually empty whenever no
   * filter was active — the owner asked for them beside the bell instead.
   */
  actions?: ReactNode;
  /**
   * The search field, when search is open. Takes over the WHOLE row —
   * emblem, status, actions and trailing all step aside.
   *
   * The search icon that opens it lives in `actions`, i.e. in this card. The
   * input used to render one row down inside BrowseTasksToolbar, so tapping a
   * button in this panel made a field appear in a different container below
   * it. Taking over the bar it was launched from is the iOS pattern, and it is
   * what /legal's policy search does too.
   */
  searchBar?: ReactNode;
}

/**
 * The tighter title-card padding this row needs.
 *
 * PageScaffold's default `py-4 lg:py-5` is sized for a two-line greeting; a
 * single row of 44px controls floats in ~32px of dead space inside it. The
 * `!` is load-bearing — both are same-specificity utilities, so without it
 * stylesheet order (not class order) decides which `py` wins.
 */
export const TITLE_BAR_PADDING = "!py-2 lg:!py-2.5";

/**
 * The Browse feed's brand row — the emblem on the left, and at the right edge
 * one live-state control (`status`) plus one trailing control (`trailing`).
 *
 * Shared by BOTH browse surfaces, which differ only in what fills those two
 * slots: Home ends the row with its in-progress job pill and the notification
 * bell, the signed-out guest feed with its "Log in" / "Get started" pair.
 * Everything else — the emblem, the padding constant, the degradation
 * behaviour — is identical, which is the point: a visitor who signs up should
 * recognise the screen they were just on.
 *
 * The feed's action icons are NOT here. They live one row down, in
 * `BrowseTasksToolbar`'s header row, next to the "Browse Jobs" heading they
 * act on — owner decision, reverting the 2026-08-17 lift that had briefly
 * pulled them up here. There are TWO of them now (search · filters): the view
 * toggle and saved searches moved into the filter sheet, so the row below is a
 * 44px header of the same shape My Posts uses rather than a band of four
 * icons.
 *
 * This is a PageScaffold `titleCard` body, NOT an app bar. Home used to be the
 * last signed-in screen carrying a sticky `<DashboardHeader />`; Messages, My
 * Jobs and My Posts all dropped theirs because their page name already lives
 * in the panel's own toolbar, and Home's does too. The guest feed carried one
 * for the same non-reason and dropped it here.
 *
 * Deliberately emblem-only — no "Helpr · LA" wordmark. Home is where the user
 * already knows what app they're in; the crest is enough of a brand anchor.
 *
 * Renders NO heading element of any level — the screen's single `<h1>` is the
 * toolbar's, and the emblem takes its accessible name from the image `alt`.
 *
 * Measured fit — Chrome, seeded authed sweep, 2026-08-18. Every number below
 * is a real getBoundingClientRect from `e2e/happy-path/home-chrome.spec.ts`;
 * the arithmetic that used to sit here described the arrangement that carried
 * the four icons, and it is no longer what this row does.
 *
 *   Home 375  row = 293px (x41→334). Emblem 37px ends at x78; the trailing
 *             cluster runs x182→342 — pill 96, 8px gap, bell 56, the last 8px
 *             being the `-mr-2` overhang. 104px of slack between the two.
 *   Home 320  row = 238px (x41→279). Same three controls at x127→287, 49px of
 *             slack. The emblem no longer has to collapse at all — it did when
 *             this row also carried the icon cluster, and that is why it still
 *             has no `shrink-0`: it remains the element that yields first.
 *   Guest 375 emblem 37px, then "Log in" 48 + "Get started" 79 at x199→334
 *             (no `-mr-2`). 121px of slack.
 *   Guest 320 the same pair at x144→279. 66px of slack.
 *
 * Zero horizontal overflow on both surfaces at 320 / 375 / 1440, light+dark.
 */
export function DashboardTitleBar({
  emblemTo = "/dashboard",
  status,
  trailing,
  actions,
  searchBar,
}: DashboardTitleBarProps) {
  if (searchBar) {
    // Same row height, one control. Nothing else renders — a field sharing the
    // bar with the emblem and the bell has ~150px to work with on a 375px
    // phone, which is not a search field.
    return <div className="flex items-center gap-2">{searchBar}</div>;
  }
  return (
    <div className="flex items-center justify-between gap-1 sm:gap-2">
      {/* `dashboard-title-emblem` is hidden on web-desktop by index.css — the
          new full-bleed DashboardHeader above the title card now carries the
          emblem there, so showing it here too would say "Helpr" twice in one
          screen. Phone width and the native app keep it: they have no
          full-bleed header, so this is still the only emblem on screen.
          Gated to the DEFAULT path (no custom `trailing`) for the same reason
          as the bell below: the guest feed (custom `trailing`) has no
          full-bleed header of its own, so its emblem must never be hidden. */}
      {/* `shrink-0` is load-bearing, not decoration. This row is
          `flex`, the actions cluster beside it is already `shrink-0`, and the
          emblem was the only flexible item — so when the actions grew past the
          available width (the saved-jobs bookmark made it four icons plus the
          live pill), flexbox took the ENTIRE overflow out of the emblem. It
          did not shrink gracefully: measured at 375 the row had 293px to give
          and the actions alone wanted 311px, so the emblem resolved to 0x44
          and the H mark silently vanished from phone web while native still
          showed it (owner: "the phone webpage view needs to go back to how it
          was so it matches the ios app"). Nothing was hidden — CSS `display`
          was still `flex` — which is exactly why it did not look like a
          hiding bug. Pinning the emblem makes the actions cluster the thing
          that must fit instead. */}
      <HelprMark
        to={emblemTo}
        size="sm"
        emblemOnly
        className={`shrink-0 ${trailing ? "" : "dashboard-title-emblem"}`}
      />
      {/* The negative margin pulls a trailing ICON button's own inner padding
          back to the card's optical edge, so the bell lines up with the content
          below instead of sitting inset from it — and buys 8px of the row back.
          It is deliberately NOT applied to a custom `trailing`: the guest pair
          ends in a bordered pill whose border IS its visual edge, so pulling it
          out would hang it 8px proud of everything beneath it. */}
      {/* gap-1.5 below sm. Four gaps between five items, so the tighter rung
          reclaims 8px — small, but this row is decided by single-digit
          margins: at 375 the actions overran the card by 16px and the bell,
          being last, was the part that fell off the edge. */}
      <div className={`flex items-center gap-1.5 sm:gap-2 shrink-0${trailing ? "" : " -mr-2"}`}>
        {status}
        {actions}
        {/* Only the DEFAULT bell (no custom `trailing` passed) is hidden on
            web-desktop — same duplicate-chrome reasoning as the emblem above.
            The guest feed's custom `trailing` (Log In / Get Started) is never
            wrapped in this class, so it is untouched on every width. */}
        {trailing ?? (
          <span className="dashboard-title-bell">
            <NotificationPanel />
          </span>
        )}
      </div>
    </div>
  );
}

export default DashboardTitleBar;
