/**
 * Declutter item-page panels in English (F260q, owner 11-11 "Spanish everything"): deadlines ("19 hours left"), the
 * price-drop banner, the fair-price hint, Helpr delivery's price list and the trade offer. Importing this file
 * registers them with t() (enRegistry.ts). Spanish: esDeclPanels.ts. "Declutter" and "Helpr" stay as they are.
 */
import { addEnglish } from "./enRegistry";

export const enDeclPanels = {
  "dp.timeUp": "time is up",
  "dp.daysLeft": "{n} days left",
  "dp.hourLeft": "1 hour left",
  "dp.hoursLeft": "{n} hours left",
  "dp.minuteLeft": "1 minute left",
  "dp.minutesLeft": "{n} minutes left",
  "dp.byTime": "by {time}",

  "dp.dropThisEvening": "this evening at {time}",
  "dp.dropTomorrow": "tomorrow at {time}",
  "dp.dropDay": "{day} at {time}",
  "dp.nextDrop": "Next possible drop: {price}, {when}",
  "dp.dropRuleMine": "Each evening it can drop {pct}%, rounded down to a whole dollar. It never goes below your lowest price, and may stop sooner.",
  "dp.dropRule": "Each evening it can drop {pct}%, rounded down to a whole dollar, until it reaches a price the seller chose.",

  "dp.hintAria": "Recent sale prices",
  "dp.hintNearYou": "Most items like this sold for {range} near you",
  "dp.hintInArea": "Most items like this sold for {range} in this area",
  "dp.hintBasis": "Based on {n}+ Declutter sales of items in the same category and condition, within about 25 miles, in the last year.",

  "dp.sizeSmall": "Small or medium",
  "dp.sizeLarge": "Large",
  "dp.sizeXl": "Extra large",
  "dp.perMile": "{base} + {mile} a mile",
  "dp.aboutMile": "About 1 mile · {price}",
  "dp.aboutMiles": "About {n} miles · {price}",

  // Handover ways (handoverCopy.ts HANDOVER_TITLE / HANDOVER_WORDS, word for word; declutterPanelsInSpanish checks).
  "ho.title.porch": "Porch pickup",
  "ho.title.pickup_home": "Meet at the seller's home",
  "ho.title.seller_delivery": "Seller delivers",
  "ho.title.delivery": "Helpr delivery",
  "ho.title.meetup": "Meet at a safe spot",
  "ho.title.ship": "Ship it to me",
  "ho.words.porch": "The seller leaves it on their porch or another safe place, no need to meet. Address after you pay.",
  "ho.words.pickup_home": "Pick it up at the seller's door. Address after you pay.",
  "ho.words.seller_delivery": "The seller brings it to you at a time you pick.",
  "ho.words.delivery": "A local Helpr picks it up and brings it to you. Best for big items.",
  "ho.words.meetup": "Meet at a public place: the seller's own spot, or a police safe exchange spot Louisiana Helpr checked. No home address is shared.",
  "ho.words.ship": "The seller mails it to your Louisiana address. You pay the postage shown.",

  // The item page's pickup block (ItemPickupBlock.tsx).
  "pb.delivery": "Delivery",
  "pb.meetup": "Meetup",
  "pb.pickup": "Pickup",
  "pb.noteFreeSeller": "they'll see your exact address only once you pick them",
  "pb.noteSeller": "buyers see your exact address only after they pay",
  "pb.noteFree": "You'll get the exact address if {giver} picks you.",
  "pb.theGiver": "the giver",
  "pb.noteBuyer": "exact address after you pay",
  "pb.or": "or",
  "pb.also": "also",
  "pb.pickSpot": "you pick the spot at checkout",
  "pb.noWays": "The seller hasn't said how buyers can get it yet.",
  "pb.placesError": "We couldn't load the pickup places.",
  "pb.timesError": "We couldn't load the pickup times.",

  // The Sell form's summary card (SellSummaryCard.tsx).
  "sell.field.title": "title",
  "sell.field.price": "price",
  "sell.field.category": "category",
  "sell.field.condition": "condition",
  "sell.field.size": "size",
  "sell.field.description": "details",
  "sell.addField.title": "Add a title",
  "sell.addField.price": "Add a price",
  "sell.addField.category": "Add a category",
  "sell.addField.condition": "Add a condition",
  "sell.addField.size": "Add a size",
  "sell.addField.description": "Add details",
} as const;

addEnglish(enDeclPanels);
