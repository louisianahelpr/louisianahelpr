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
  syncFailed: "Couldn't save to your account just now. It's kept on this device and we'll try again.",
  syncRetry: "Try again",
  stopSharing: "Stop sharing this link",
  sharingStopped: "Link stopped. It doesn't open anymore.",
  deleteMyList: "Delete my list",
  deleteMyListTitle: "Delete your wish list?",
  deleteMyListBody: "This deletes your list and its link from your account and this device. Anyone you sent the link to won't be able to open it. It can't be undone.",
  deleteMyListDone: "Your list and its link are deleted.",
  deleteMyListFailed: "We couldn't delete your list just now. Try again.",
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
  // Save for someone and My lists (owner 2026-11-21: "save items per person ... it shows the total amount they have
  // added, and they can add/remove stuff as they are browsing the guides"; "they should also be able to share all lists").
  /** The heart's label on a gift, now that it asks for whom. */
  saveForLabel: (name: string) => `Save ${name} for someone`,
  saveForTitle: "Save for someone",
  saveForMe: "Me",
  saveForMeSub: (n: number) => `My Wish List · ${n === 1 ? "1 gift" : `${n} gifts`}`,
  saveForLoading: "Loading your lists…",
  saveForFull: "That list is full (30). Remove one to add more.",
  saveForAdd: "Add a person",
  saveForName: "Name",
  saveForBudget: "Budget (optional)",
  saveForAddButton: "Add",
  saveForDone: "Done",
  saveForPick: (name: string, gift: string) => `Save ${gift} for ${name}`,
  saveForUnpick: (name: string, gift: string) => `Remove ${gift} from ${name}'s list`,
  /** "3 gifts · $54" (no amount while nothing on it has a price). */
  listCount: (gifts: number, amount: string | null) => `${gifts === 1 ? "1 gift" : `${gifts} gifts`}${amount ? ` · ${amount}` : ""}`,
  myLists: "My lists",
  myListsOpen: (summary: string) => `My lists: ${summary}`,
  listBudget: (amount: string, budget: string) => `${amount} of ${budget} budget`,
  listOver: (over: string) => `${over} over budget`,
  listEmpty: "Nothing saved for them yet.",
  listRemove: (gift: string, name: string) => `Remove ${gift} from ${name}'s list`,
  // Managing a list (owner 2026-11-21: "How do they edit or remove items in the list or delete the list? I entered the
  // budget as 100 but it doesn't say how much I have left to spend or how much I'm over").
  /** "$63.25 over" / "$36.75 left", after the list's count and total (owner 11-21: "Remove 'your $100'. Just save the number and overs"). */
  listOverYour: (over: string) => `${over} over`,
  listLeft: (left: string) => `${left} left`,
  viewList: "View list",
  listOf: (name: string) => `${name}'s list`,
  editList: "Edit",
  editListOf: (name: string) => `Edit ${name}'s name and budget`,
  openListOf: (name: string) => `Open ${name}'s list`,
  deleteListOf: (name: string) => `Delete ${name}'s list`,
  editName: "Name",
  editBudget: "Budget (optional)",
  editSave: "Save",
  editCancel: "Cancel",
  editBadBudget: "Type an amount like 100 or 100.50, or leave it empty.",
  deleteList: "Delete list",
  deleteListTitle: (name: string) => `Delete ${name}'s list?`,
  deleteListBody: (name: string, gifts: number) => `This removes ${name} and ${gifts === 1 ? "the 1 gift" : `the ${gifts} gifts`} saved for them, here and in your gift planner. It can't be undone.`,
  clearList: "Clear list",
  clearListTitle: "Clear My Wish List?",
  clearListBody: (gifts: number) => `This takes ${gifts === 1 ? "the 1 gift" : `all ${gifts} gifts`} off your wish list. It can't be undone.`,
  keepList: "Keep it",
  removedGift: (gift: string) => `Removed ${gift}`,
  savedFor: (names: string) => `Saved for ${names}`,
  openWishList: "Open My Wish List",
  myWishListName: "My Wish List",
  /** The picker's check: on the list (tap to take it off) or not. */
  onListHint: "On the list · tap to remove",
  openPlanner: "Open planner",
  shareThisList: "Share this list",
  shareAllLists: "Share all my lists",
  shareListsMessage: "Here are my gift lists from the Louisiana Helpr gift guides.",
  shareListsNote: "Anyone with the link can see these names and gifts for 90 days. Budgets and Bought marks are never shared.",
  sharePrivate: (n: number) => (n === 1 ? "1 gift you typed in stays private: only gifts from our guides are shared." : `${n} gifts you typed in stay private: only gifts from our guides are shared.`),
  /** A shared page holding several people's lists. */
  sharedListsLead: "Someone shared their gift lists with you",
  sharedListsTitle: "Gift lists",
  // Amazon Buy Now (owner 2026-11-21): Amazon's add-to-cart form, credited to our tag (src/lib/retailerCart.ts).
  amazonCartList: (name: string) => `Add ${name.trim().endsWith("s") ? `${name.trim()}'` : `${name.trim()}'s`} Amazon items to my cart`,
  // Add from any store (owner 2026-11-21): paste a link or type an idea (src/pages/info/giftGuides/AnyStoreAdd.tsx).
  anyLabel: (name: string) => `Type a gift idea or paste a link for ${name || "them"}`,
  anyPlaceholder: "Type a gift idea or paste a link",
  anyGo: "Add",
  anyName: "What is it?",
  anyAdd: "Add it",
  anyAmazon: "We'll use our Amazon link for it.",
  anyPlain: "We'll make our own link for it soon. Until then it keeps the link you pasted.",
  anyShort: "Short links aren't opened, so give it a name. We'll make our own link for it soon.",
  anyAddedLink: (gift: string) => `Added ${gift}. We'll make our own link for it soon.`,
  anyAddedIdea: (gift: string) => `Added ${gift}. We'll look for a link for it.`,
  anyQueueFailed: "Added. We couldn't send it to look for our link just now.",
  sharedAnySoon: "Link coming soon",
  anyBadLink: "Paste a link that starts with https://, or type an idea.",
  anyClosest: "Closest from our guides:",
  anyPick: (gift: string) => `Add ${gift}`,
  anyWords: "Add my words instead",
  anyAdded: (gift: string) => `Added ${gift}.`,
  sharedSupports: "Buying through these links supports Louisiana Helpr.",
  sharedListTotal: (gifts: number, amount: string | null) => `${gifts === 1 ? "1 gift" : `${gifts} gifts`}${amount ? ` · about ${amount}` : ""}`,
} as const;

/** The how-to hints (dismissible, shown once). */
export const HINTS = {
  firstHeart: "Saved to your wish list.",
  firstHeartShort: "Saved ♥",
  seeListShort: "View list",
  seeList: "See my list",
  budget: "Tap a price to see gifts in your budget.",
  share: "Send your list by text, Messenger or a link. They don't need to sign in.",
} as const;
