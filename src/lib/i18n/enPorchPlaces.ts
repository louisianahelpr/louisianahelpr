/**
 * The buyer's pickup-place picker and the order's pickup place in English (F260q): DeclutterPorchPlaces.tsx. One panel's
 * words, imported by that panel only, so they are inlined into its chunk (Q178); it rides with the item page's buy,
 * trade and free-claim screens and the order views, which load different dictionaries. Spanish: esPorchPlaces.ts.
 */
import { addEnglish } from "./enRegistry";

export const enPorchPlaces = {
  "ppk.loadErr": "We couldn't load the pickup places.",
  "ppk.loadOneErr": "We couldn't load the pickup place.",
  "ppk.loading": "Loading them…",
  "ppk.helprPicks": "Where the Helpr picks it up",
  "ppk.place": "Pickup place",
  "ppk.pick": "Pick a pickup place",
  "ppk.afterPay": "You get the exact address after you pay.",
  "ppk.afterConfirm": "You get the exact address once you confirm.",
  "ppk.orderPlace": "Pickup place:",
} as const;

addEnglish(enPorchPlaces);
