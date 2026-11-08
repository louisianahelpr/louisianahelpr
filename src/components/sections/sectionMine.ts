/**
 * A section's "My …" menu (owner 11-08, the Vinted header): the section's own lists (Declutter: Buying, Selling,
 * Deliver, Wanted, Free) and its settings left the top of the screen for one sheet opened from the profile photo.
 * Each row keeps its to-do count; the photo wears a dot while any row has one.
 */
interface SectionMineItem {
  key: string;
  label: string;
  to: string;
  /** A to-do count, drawn as the alert badge. */
  count?: number;
  /** A plain number (Selling: how many items are for sale), drawn quietly. */
  quiet?: number;
}

export interface SectionMineMenu {
  /** "My Declutter". */
  title: string;
  items: SectionMineItem[];
  /** The section's settings (the gear that used to end the tabs row). */
  settings?: { label: string; to: string };
}

/** How many to-dos the menu holds: the photo's dot shows while this is above 0. */
export function mineToDoCount(menu: SectionMineMenu | undefined): number {
  return menu ? menu.items.reduce((n, i) => n + (i.count && i.count > 0 ? i.count : 0), 0) : 0;
}
