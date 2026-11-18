/**
 * The guest's way in (design audit r2 #37: "Log in / Join free / Sign up to buy..." were English in Spanish): the
 * public header (Navbar) and Declutter's guest buttons and cards (DeclutterGuest.tsx). Drawn through wordInLang, so the
 * guest bundle needs no hook. Spanish: esGuest.ts.
 */
import { addEnglish } from "./enRegistry";

export const enGuest = {
  "g.signedOut": "You've been signed out. Log in again to manage this listing.",
  "g.askItem": "Ask for this item",
  "g.buyOrOffer": "Buy or make an offer",
  "g.buyItem": "Buy this item",
  "g.makeOffer": "Make offer",
  "g.buyNow": "Buy now",
  "g.signUpAsk": "Sign up to ask for it",
  "g.freeJoin": "Signing up is free. We'll bring you back to this item.",
  "g.trades": "Sign in and list an item to offer a trade.",
  "g.want.offer": "Log in to see your offer",
  "g.want.order": "Log in to see your order",
  "g.want.sales": "Log in to see your sales",
  "g.want.post": "Log in to post what you want",
  "g.want.wanted": "Log in to see your Wanted posts",
  "g.joinAria": "Join to buy or sell",
  "g.newHere": "New here?",
  "g.signUpToBuy": "Sign up to buy, make offers or sell.",
  "g.itsFree": "It's free.",
} as const;

addEnglish(enGuest);
