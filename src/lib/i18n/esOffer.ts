/** Spanish for enOffer.ts (F260q): Declutter's offer box. Same money meaning as the English, word for word. */
import type { enOffer } from "./enOffer";

export const esOffer: Record<keyof typeof enOffer, string> = {
  "offer.cardNotSaved": "No se guardó ninguna tarjeta, así que todavía no pasó nada.",
  "offer.addCard": "Agregar una tarjeta",
  "offer.cardStepTitle": "Para enviar su oferta, primero agregue una tarjeta.",
  "offer.cardStepBody": "Guardamos su tarjeta ahora; solo se le cobra si el vendedor acepta y usted paga. Luego envía su oferta.",
  "offer.opening": "Abriendo…",
  "offer.notNow": "Ahora no",
  "offer.enterAmount": "Escriba una cantidad, como 25 o 25.50.",
  "offer.lessThanPrice": "Ofrezca menos que el precio. Para pagar el precio, toque Comprar ahora.",
  "offer.atLeast": "Las ofertas deben ser de al menos {min} (la mitad del precio).",
  "offer.cardSaved": "Tarjeta guardada. Ahora envíe su oferta.",
  "offer.quickAmounts": "Ofertas rápidas",
  "offer.chipAria": "{pct}% menos, una oferta de {amount} ({total})",
  "offer.pctOff": "{pct}% menos",
  "offer.custom": "Otra",
  "offer.customPlaceholder": "Otra cantidad, de al menos {min}",
  "offer.youPayIfYes": "Usted paga si el vendedor acepta",
  "offer.inclFee": "con la tarifa",
  "offer.help": "El vendedor tiene 48 horas para aceptar, decir que no o responder con otro precio. Si acepta, usted tiene 24 horas para pagar. No se cobra nada hasta que pague.",
  "offer.send": "Enviar oferta",
  "offer.cardCheckFailed": "No pudimos revisar su tarjeta guardada.",
  "offer.checkingCard": "Buscando su tarjeta…",
};
