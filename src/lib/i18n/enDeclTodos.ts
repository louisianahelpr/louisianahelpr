/**
 * Design audit area 02 #4 (11-18): the Declutter to-do rows on Home and the Buying "Needs you" group
 * (src/lib/declutter/declutterTodos.ts). That file carries each English line itself and reads these keys only for a
 * Spanish reader (wordInLang), so nothing on the /declutter path imports this table: it is here for the key type and
 * the en/es parity check. Spanish: esDeclTodos.ts.
 */
export const enDeclTodos = {
  "dt.selling": "Selling",
  "dt.buying": "Buying",
  "dt.by": "by {when}",
  "dt.problemTitle": "Add your side: the seller reported a problem with {item}",
  "dt.problemMeta": "Buying · the seller reported a problem",
  "dt.addSide": "Add your side",
  "dt.more": "{title} + {n} more",
  "dt.yourOrder": "your order",
  "dt.refundReq": "Answer a refund request",
  "dt.refundOffer": "Answer the seller's refund offer",
  "dt.answerReq": "Answer request",
  "dt.answerOffer": "Answer offer",
  "dt.offer": "Answer a {amount} offer",
  "dt.counter": "Answer the seller's {amount} counteroffer",
  "dt.checkoutOne": "Check out {item}",
  "dt.checkoutN": "Check out {n} items",
  "dt.checkout": "Check out",
  "dt.handOver": "Hand over {item}",
  "dt.pickUp": "Pick up {item}",
  "dt.handOverMeta": "Selling · sold, waiting for the handover",
  "dt.pickUpMeta": "Buying · paid, waiting for the pickup",
  "dt.openSale": "Open sale",
  "dt.openOrder": "Open order",
  "dt.pickWho": "Pick who gets {item}",
  "dt.freeAsked": "Free · {n} asked",
  "dt.pick": "Pick",
} as const;
