// The Messages header row's icon-button classes, moved out of
// ConversationList.tsx (component-size ratchet) unchanged.

/**
 * The header row's icon buttons — search, the tab disclosure, the overflow
 * menu — as ONE class, copied verbatim from PostsHeader's / JobsHeader's
 * non-inline buttons.
 *
 * Cross-screen: My Posts / My Jobs put the same search + chevron pair in the
 * same corner of the same card, and two identical clusters in two different
 * inks is the kind of difference a reader feels without being able to name it.
 * Within the row: the chevron must not be a different weight of grey from the
 * magnifier eight pixels away.
 *
 * `h-11` is 44px, the HIG target index.css already floors every button at.
 */
export const HEADER_ICON_BUTTON_BASE_CLASS =
  "rounded-ds-md flex items-center justify-center btn-press transition " +
  "hover:bg-secondary/60 h-11 w-11";
/** The resting ink. Split out ONLY so the disclosure chevron can darken to
 *  `--bark` while a non-default slice is on without two `text-*` utilities
 *  fighting in one class string (the loser is decided by CSS order, not by
 *  which one you wrote last — the trap documented on `btn-grad-primary`). */
export const HEADER_ICON_BUTTON_INK_CLASS = "text-muted-foreground hover:text-foreground";
export const HEADER_ICON_BUTTON_CLASS =
  `${HEADER_ICON_BUTTON_BASE_CLASS} ${HEADER_ICON_BUTTON_INK_CLASS}`;
/**
 * The desktop website's row, copied from PostsHeader's `inlineFilters` buttons
 * (`h-7 w-7 !min-h-0 !min-w-0`, a 3.5 glyph). Q1558 (owner 2026-10-08: "same
 * positioning, box sizes"): looked at on prod 2026-10-12 at 1440, the Messages
 * tab row was 53px tall around 44px buttons while My Posts / My Jobs' was 43px
 * around 28px ones, so the Messages panel and its empty state sat 5-10px lower.
 */
export const HEADER_ICON_BUTTON_DESKTOP_CLASS =
  "rounded-ds-md flex items-center justify-center btn-press transition " +
  `hover:bg-secondary/60 h-7 w-7 !min-h-0 !min-w-0 ${HEADER_ICON_BUTTON_INK_CLASS}`;
