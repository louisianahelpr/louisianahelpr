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
  remove: "Remove",
  removeLabel: (name: string) => `Remove ${name} from your list`,
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
  shareRateLimited: "You've shared a lot just now. Try again in a few minutes.",
  shareMessage: (name: string) => `${name}: here's my wish list`,
  shareNote: "Anyone with the link can see this list. No sign-in needed.",
  syncedNote: "Saved to your account, so it's on every device you sign in on.",
  deviceNote: "Saved on this device. Sign in to keep it on all your devices.",
  /** The shared list's page. */
  sharedLead: "A wish list from Louisiana Helpr",
  sharedIntro: "Tap Shop to buy any gift. Prices and stock are on the store's site.",
  sharedMissing: "This list isn't here anymore, or the link is incomplete.",
  sharedFailed: "Couldn't load this list. Check your connection and try again.",
  retry: "Try again",
  sharedCta: "Make your own wish list",
  sharedEmpty: "This list is empty right now.",
} as const;

/** The how-to hints (dismissible, shown once). */
export const HINTS = {
  howTitle: "How to use the gift guides",
  steps: ["Pick a guide or take the quiz.", "Tap ♥ to save a gift to your wish list.", "Share your list, or tap Shop to buy."] as const,
  firstHeart: "Saved to your wish list.",
  seeList: "See my list",
  quiz: "Answer 3 quick questions and we'll pick 6 gifts for you.",
  budget: "Tap a price to see gifts in your budget.",
  share: "Send your list by text, Messenger or a link. They don't need to sign in.",
  deals: "Deals hide when they expire. Codes copy with a tap.",
} as const;
