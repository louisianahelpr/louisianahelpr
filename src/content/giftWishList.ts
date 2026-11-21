/**
 * The words of the gift guides' wish list, its share and the how-to hints (owner 2026-11-20: "add something that they
 * can add to their list and send their list to someone"; "add hints or things so they know how to use everything").
 * Short, friendly and human (owner's copy rules). Kept out of src/content/giftGuides.ts (the guide data file).
 */
export const WISH = {
  title: "My Wish List",
  /** The heart's label on a gift. */
  saveLabel: (name: string) => `Save ${name} to My Wish List`,
  /** The heart icon's label with its count. */
  countLabel: (n: number) => `My Wish List, ${n} saved`,
  nameLabel: "List name",
  namePlaceholder: "My Wish List",
  nameHelp: "Give it a name, like “Mom's Christmas List.”",
  empty: "Tap ♥ on any gift to save it here.",
  emptyCta: "Browse the gift guides",
  loading: "Loading your list…",
  guidesTitle: "Saved guides",
  giftsTitle: (n: number) => `Saved gifts (${n})`,
  /** The filled heart on a saved gift on My Wish List (owner 11-20: a heart, not a Remove button). */
  removeLabel: (name: string) => `Remove ${name} from wish list`,
  /** The toast after a heart takes a gift off (owner 11-20: "Removed · Undo", so a mis-tap isn't lost). */
  removedToast: "Removed",
  undo: "Undo",
  undoLabel: (name: string) => `Undo: put ${name} back on your wish list`,
  visit: "Visit",
  share: "Share my list",
  sharing: "Getting your link…",
  shareMenuLabel: "Share your list",
  copyLink: "Copy link",
  copied: "Link copied",
  text: "Text message",
  messenger: "Messenger",
  moreShare: "More ways to share",
  shareFailed: "Couldn't make your link just now. Try again in a minute.",
  /** The share sheet's and the text message's words (UX audit L3: never "My Wish List: here's my wish list"). */
  shareMessage: "Here's my wish list from the Louisiana Helpr gift guides.",
  sendWith: "Send with…",
  newLink: "Make a new link",
  newLinkDone: "New link made. The old link no longer works.",
  /** The 101st heart (UX audit M2). */
  listFull: "Your list is full (100). Remove one to add more.",
  /** The same, on a narrow screen (verify audit H1: one line at 320). */
  listFullShort: "List full (100)",
  /** Under the name field while it holds a link or phone number (it is not kept until it doesn't). */
  nameProblem: "Please use a name without a link or phone number.",
  /** Read out after Remove (UX audit M3). */
  removed: (name: string) => `Removed ${name}`,
  /** Gifts a list names that the guides no longer carry (UX audit M7). */
  clearMissing: "Remove them",
  missing: (n: number) => (n === 1 ? "1 gift isn't in our guides anymore." : `${n} gifts aren't in our guides anymore.`),
  shareNote: "Anyone with the link can see this list. No sign-in needed.",
  syncedNote: "Saved to your account, so it's on every device you sign in on.",
  deviceNote: "Saved on this device. Sign in to keep it on all your devices.",
  /** The shared list's page. */
  /** Above the list's name on a shared list: the name is the sender's own words, never ours (security review #4). */
  sharedLead: "Someone shared their wish list with you",
  /** Holiday audit C9: an unnamed (or default-named) shared list never shows the recipient "My Wish List". */
  sharedUnnamed: "A wish list for you",
  sharedMissingTitle: "List not found",
  sharedIntro: "Tap Shop to buy any gift. Prices and stock are on the store's site.",
  sharedMissing: "This list isn't here anymore, or the link is incomplete.",
  sharedFailed: "Couldn't load this list. Check your connection and try again.",
  retry: "Try again",
  sharedCta: "Make your own wish list",
  sharedEmpty: "This list is empty right now.",
} as const;

/** The how-to hints (dismissible, shown once). */
export const HINTS = {
  firstHeart: "Saved to your wish list.",
  firstHeartShort: "Saved ♥",
  seeListShort: "View list",
  seeList: "See my list",
  budget: "Tap a price to see gifts in your budget.",
  share: "Send your list by text, Messenger or a link. They don't need to sign in.",
  deals: "Deals hide when they expire. Codes copy with a tap.",
} as const;
