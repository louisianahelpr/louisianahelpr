/** Spanish for enDeclPanels.ts (F260q). "Declutter" and "Helpr" stay as they are. */
import type { enDeclPanels } from "./enDeclPanels";

export const esDeclPanels: Record<keyof typeof enDeclPanels, string> = {
  "dp.timeUp": "se acabó el tiempo",
  "dp.daysLeft": "quedan {n} días",
  "dp.hourLeft": "queda 1 hora",
  "dp.hoursLeft": "quedan {n} horas",
  "dp.minuteLeft": "queda 1 minuto",
  "dp.minutesLeft": "quedan {n} minutos",
  "dp.byTime": "antes de {time}",

  "dp.dropThisEvening": "esta tarde a las {time}",
  "dp.dropTomorrow": "mañana a las {time}",
  "dp.dropDay": "el {day} a las {time}",
  "dp.nextDrop": "Próxima rebaja posible: {price}, {when}",
  "dp.dropRuleMine": "Cada tarde puede bajar un {pct}%, redondeado a un dólar entero. Nunca baja de su precio más bajo y puede parar antes.",
  "dp.dropRule": "Cada tarde puede bajar un {pct}%, redondeado a un dólar entero, hasta llegar a un precio que eligió el vendedor.",

  "dp.hintAria": "Precios de ventas recientes",
  "dp.hintNearYou": "La mayoría de los artículos como este se vendieron por {range} cerca de usted",
  "dp.hintInArea": "La mayoría de los artículos como este se vendieron por {range} en esta zona",
  "dp.hintBasis": "Según {n}+ ventas en Declutter de artículos de la misma categoría y estado, a unas 25 millas, en el último año.",

  "dp.sizeSmall": "Pequeño o mediano",
  "dp.sizeLarge": "Grande",
  "dp.sizeXl": "Muy grande",
  "dp.perMile": "{base} + {mile} por milla",
  "dp.aboutMile": "Cerca de 1 milla · {price}",
  "dp.aboutMiles": "Cerca de {n} millas · {price}",

  "dp.tradeSent": "Oferta de intercambio enviada. El vendedor tiene 48 horas para responder.",
  "dp.youOffered": "Ofreció su {title} a cambio",
  "dp.yourListing": "artículo",
  "dp.waitingSeller": "Esperando al vendedor.",
  "dp.seeInBuying": "Verlo en Comprando",
  "dp.offerTrade": "Ofrecer un intercambio",
  "dp.tradeWhat": "Cambie uno de sus artículos por este. No se paga dinero y cada uno recoge el artículo del otro.",
  "dp.tradePick": "Elija uno de sus artículos para cambiar por \"{title}\". No se paga dinero. El vendedor tiene 48 horas para responder.",
  "dp.loadingListings": "Cargando sus artículos…",
  "dp.noListings": "No tiene artículos publicados para intercambiar.",
  "dp.listAnItem": "Publique un artículo",
  "dp.first": "primero.",
  "dp.tradeListLabel": "Su artículo para intercambiar",
  "dp.cancel": "Cancelar",
  "dp.sending": "Enviando…",
  "dp.sendTrade": "Enviar oferta de intercambio",
};
