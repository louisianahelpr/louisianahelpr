/**
 * Declutter's offer cards in English (F260q, owner 11-11 "Spanish everything"): "Offers on your items" (Selling) and
 * "Your offers" (Buying), each card's words, its answers and its confirm sheets (DeclutterOffersSection.tsx). Importing
 * this file registers them with t() (enRegistry.ts). Spanish: esDeclOffers.ts. Money meaning matches word for word.
 */
import { addEnglish } from "./enRegistry";

export const enDeclOffers = {
  "dof.alreadyOffered": "They already offered {amount}. Answer with more than that, or tap Accept.",
  "dof.askingLess": "They're asking {amount}. Answer with less than that, or tap Accept.",
  "dof.mustBeBetween": "Your price has to be between {min} and {max}.",
  "dof.between": "Between {min} and {max}.",

  "dof.st.open": "Waiting",
  "dof.st.accepted": "Accepted",
  "dof.st.declined": "Declined",
  "dof.st.expired": "Ran out of time",
  "dof.st.withdrawn": "Taken back",
  "dof.st.voided": "Item went to someone else",

  "dof.inCart": "In your cart. Check out by {when}.",
  "dof.checkOut": "Check out",
  "dof.waitPay": "Waiting on the buyer to pay by {when}.",

  "dof.wantedClosed": "Your Wanted post is closed.",
  "dof.acceptedBuyer": "Accepted. Check out within 24 hours.",
  "dof.acceptedSeller": "Accepted. The buyer has 24 hours to pay.",
  "dof.countered": "Sent. They have 48 hours to answer.",
  "dof.withdrawn": "Offer taken back.",
  "dof.declined": "Declined.",

  "dof.wantedReply": "Reply to your Wanted",
  "dof.from": "From {name}",
  "dof.priceNow": "Price now {price}",
  "dof.theirOffer": "their offer",
  "dof.theirPrice": "their price",
  "dof.theirCounter": "their counter",
  "dof.yourOffer": "your offer",
  "dof.yourPrice": "your price",
  "dof.nothingCharged": "Nothing was charged.",
  "dof.seeItem": "See the item",
  "dof.underFloor": "This is under your lowest price ({price}). Only you can see that.",
  "dof.answerOffer": "Answer their offer",
  "dof.waitSeller": "Waiting on the seller to answer",
  "dof.waitBuyer": "Waiting on the buyer to answer",
  "dof.keepA": "If you accept and the buyer pays, you keep the whole ",
  "dof.keepB": ".",
  "dof.billPrice": "Their price",
  "dof.youPay": "You pay {phrase}",
  "dof.atMost": "At most. More items from this seller make it less.",

  "dof.sayNo": "Say no",
  "dof.answerPrice": "Answer with a price",
  "dof.accept": "Accept",
  "dof.yourPriceLabel": "Your price",
  "dof.send": "Send",
  "dof.takeBack": "Take back my offer",
  "dof.notNow": "Not now",

  "dof.sellFor": "Sell it for {price}?",
  "dof.buyFor": "Buy it for {price}?",
  "dof.aboveNow": "Their {offer} offer is above your price now, so it sells at {price}. ",
  "dof.sellBody": "\"{title}\": every other offer on it closes, and the buyer gets 24 hours to pay.",
  "dof.buyA": "\"{title}\": you pay at most ",
  "dof.buyB": " {phrase}. You'll have 24 hours to check out and pay, or you get a strike. Nothing is charged until you do.",
  "dof.wdTitle": "Take back your offer?",
  "dof.wdConfirm": "Take it back",
  "dof.wdKeep": "Keep my offer",
  "dof.wdBody": "\"{title}\": your offer of {amount} ends. Nothing is charged.",
  "dof.cwTitle": "Close your Wanted post?",
  "dof.cwConfirm": "Close it",
  "dof.cwKeep": "Keep it open",
  "dof.cwBody": "You're getting \"{title}\". Closing your Wanted post stops new matches and replies. You can post it again any time from Wanted.",
  "dof.noTitle": "Say no to {amount}?",
  "dof.noSeller": "\"{title}\": this offer ends, and the buyer is told you said no.",
  "dof.noReply": "\"{title}\": this reply ends, and the seller is told you said no. Nothing is charged.",
  "dof.noCounter": "\"{title}\": this counter ends. Nothing is charged.",

  "dof.onYourItems": "Offers on your items",
  "dof.yourOffers": "Your offers",
  "dof.loadError": "We couldn't load offers.",
  "dof.loading": "Loading offers…",
  "dof.toAnswer": "to answer",
  "dof.noneMade": "You haven't made any offers.",
  "dof.noneOpen": "No open offers.",
  "dof.hideClosed": "Hide closed offers",
  "dof.showClosed1": "Show {n} closed offer from the last 30 days",
  "dof.showClosedN": "Show {n} closed offers from the last 30 days",
} as const;

addEnglish(enDeclOffers);
