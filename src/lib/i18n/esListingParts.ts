/** Spanish for enListingParts.ts (F260q): keep it up, make it free after, how long it stays up, the price-drop strip. */
import type { enListingParts } from "./enListingParts";

export const esListingParts: Record<keyof typeof enListingParts, string> = {
  "lp.keepUpTitle": "Mantenerlo publicado hasta que se venda",
  "lp.keepUpExplainer": "Se renueva cada 30 días hasta que alguien lo compre. Puede apagar esto cuando quiera.",
  "lp.keepUpOn": "Encendido. Se renueva cada 30 días hasta que alguien lo compre, sin recordatorios.",
  "lp.keepUpOff": "Apagado. Está publicado 30 días a la vez, hasta 4 veces (unos 4 meses). Le avisaremos antes de que termine cada ronda.",
  "lp.keepUpToastOn": "Se renueva cada 30 días hasta que se venda.",
  "lp.keepUpToastOff": "Vuelve a estar publicado 30 días a la vez, hasta 4 veces.",
  "lp.loadFail": "No pudimos cargar este ajuste.",
  "lp.afLabel": "Si no se vende, hacerlo gratis después de",
  "lp.afNeverOption": "Nunca hacerlo gratis",
  "lp.afDays": "{n} días",
  "lp.afNever": "No se hará gratis por sí solo.",
  "lp.afExplainer": "Si no se ha vendido para el día {n}, pasa a ser gratis y cualquiera cerca puede pedirlo. ¿Ya pasó el día {n}? Pasa a ser gratis esta noche.",
  "lp.afSaved": "Si no se ha vendido para el día {n}, pasa a ser gratis.",
  "lp.afWins": "Esto gana sobre un precio detenido: el día {n} es gratis.",
  "lp.life": "30 días. Si no se ha vendido, vuelve a publicarse solo hasta 3 veces más (unos 4 meses). Le avisaremos antes de que termine cada ronda.",
  "lp.lifeKeepUp": "Hasta que se venda. Se renueva solo cada 30 días, sin recordatorios.",
  "lp.dropsSwitch": "Bajar el precio con el tiempo",
  "lp.dsHead": "Si no se vende",
  "lp.dsEach": "{pct}% menos cada tarde, {time}",
  "lp.dsAria": "Lo más bajo que podría estar cada tarde",
  "lp.dsFoot": "La primera bajada llega cuando lleva 12 horas publicado. Nunca baja de {floor} y puede detenerse antes.",
};
