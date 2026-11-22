/**
 * Gift lists words used only by screens that load on demand (the Save for someone sheet, the My lists sheet, My Wish
 * List, the gift planner, a list's Stop sharing and Delete), kept out of src/content/giftWishList.ts, which every guide
 * page loads (lander3, train 1121i: /gift-guides/:slug was over its critical-path budget).
 */
export const LISTS = {
  stopSharing: "Stop sharing this link",
  sharingStopped: "Link stopped. It doesn't open anymore.",
  deleteMyListTitle: "Delete your wish list?",
  deleteMyListBody: "This deletes your list and its link from your account and this device. Anyone you sent the link to won't be able to open it. It can't be undone.",
  deleteMyListDone: "Your list and its link are deleted.",
  deleteMyListFailed: "We couldn't delete your list just now. Try again.",
  deleteMyList: "Delete my list",
  /** Holiday audit 1121 (#11): Add with no name, or at the 50-person limit, says why instead of doing nothing. */
  nameFirst: "Type a name first.",
  peopleFull: "You can plan for up to 50 people. Remove someone to add another.",
  /** A list gift with a store link but no price we can show (a deal): where its price is (holiday audit 1121 #5). */
  priceAtStore: "Price at store",
  /** Holiday audit 1121 (#8): what has been marked Bought, after the list's count, total and budget ("· $12 bought"). */
  listBought: (amount: string) => `${amount} bought`,
} as const;
