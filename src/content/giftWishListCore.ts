/**
 * The few gift wish list words a guide page itself shows (the page title, the shared-list lead and its load states,
 * the hearts' labels and their notes (HINTS, list full), the My list count, the sync note). Everything else in WISH (src/content/giftWishList.ts, which
 * spreads this in) is only for screens that load on demand, so no guide page downloads it (lander3, train 1121i:
 * /gift-guides/:slug was over its critical-path budget).
 */
export const WISH_CORE = {
  title: "My Wish List",
  loading: "Loading your list…",
  /** Above the list's name on a shared list: the name is the sender's own words, never ours (security review #4). */
  sharedLead: "Someone shared their wish list with you",
  sharedFailed: "Couldn't load this list. Check your connection and try again.",
  /** The heart's label on a gift, now that it asks for whom. */
  saveForLabel: (name: string) => `Save ${name} for someone`,
  /** The heart icon's label with its count. */
  countLabel: (n: number) => `My Wish List, ${n} saved`,
  syncFailed: "Couldn't save to your account just now. It's kept on this device and we'll try again.",
  /** The heart's label on a gift. */
  saveLabel: (name: string) => `Save ${name} to My Wish List`,
  /** The 101st heart (UX audit M2). */
  listFull: "Your list is full (100). Remove one to add more.",
  /** The same, on a narrow screen (verify audit H1: one line at 320). */
  listFullShort: "List full (100)",
} as const;

/** The how-to hints (dismissible, shown once). */
export const HINTS = {
  // Holiday audit 1121 (#12): the same words on a phone and a desktop ("Saved ♥ View list" vs "Saved to your wish
  // list. See my list"); only a very narrow screen (340 and under) takes the short form; the link says "View list" as the Done toast does.
  firstHeart: "Saved to your wish list",
  firstHeartShort: "Saved ♥",
  seeListShort: "View list",
  seeList: "View list",
  budget: "Tap a price to see gifts in your budget.",
  share: "Send your list by text, Messenger or a link. They don't need to sign in.",
} as const;
