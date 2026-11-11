/**
 * The notice email's one button names where it goes (audit 2026-10-31, AUD31-20: every notice said "View Details",
 * whatever it was about). Read from the notice's own same-origin link, so no producer has to send a label.
 * Guard: src/test/noticeEmailNamesItsAction.test.ts.
 */
export function notificationActionLabel(link: string | null | undefined, title?: string | null): string {
  // Owner's message review 11-09 (F174, F175, F180): where a notice asks for one action, the button names THAT action,
  // not the page ("See the job" under "tap to confirm you're still on"). Keyed on the notice's exact title.
  const byTitle = title ? ACTION_BY_TITLE[title.trim()] : undefined;
  if (byTitle) return byTitle;
  const path = (link ?? "").split(/[?#]/)[0];
  if (path.startsWith("/declutter/item/")) return "See the item";
  if (path.startsWith("/declutter")) {
    if (/[?&](tab|view)=buying\b/.test(link ?? "")) return "See your order";
    if (/[?&](tab|view)=selling\b/.test(link ?? "")) return "See your sale";
    if (/[?&]view=cart\b/.test(link ?? "")) return "See your cart";
    return "Open Declutter";
  }
  if (path.startsWith("/messages")) return "Read the message";
  // Shops emails (shops audit 11-08 #7): the buyer's orders and the shop's dashboard.
  if (path.startsWith("/shops/orders")) return "See your order";
  if (path.startsWith("/shops/dashboard")) return "See your shop's orders";
  if (path.startsWith("/jobs") || path.startsWith("/posts")) return "See the job";
  if (path.startsWith("/profile") && /[?&]tab=earnings\b/.test(link ?? "")) return "See your earnings";
  return "Open Louisiana Helpr";
}

/** Notice titles whose email asks for one action, and that action's button (F174, F175, F180). */
const ACTION_BY_TITLE: Record<string, string> = {
  "Still on for tomorrow?": "Confirm I'm still on",
  "A dispute was opened": "Add your side",
  "Your Helpr needs another day": "Answer the request",
  "New counteroffer": "Answer the counteroffer",
  "New trade offer": "Answer the trade offer",
  "Your listings are live": "See your listings",
};

/**
 * The button's words in Spanish, for a member who picked Spanish (F260q, owner 11-11 "Spanish everything"). Keyed on
 * the English label notificationActionLabel returns; one with no entry stays English. Brand names stay as they are.
 */
const ACTION_LABEL_ES: Record<string, string> = {
  "Confirm I'm still on": "Confirmar que sigo en pie",
  "Add your side": "Agregar mi versión",
  "Answer the request": "Responder la solicitud",
  "Answer the counteroffer": "Responder la contraoferta",
  "Answer the trade offer": "Responder la oferta de cambio",
  "See your listings": "Ver mis anuncios",
  "See the item": "Ver el artículo",
  "See your order": "Ver mi pedido",
  "See your sale": "Ver mi venta",
  "See your cart": "Ver mi carrito",
  "Open Declutter": "Abrir Declutter",
  "Read the message": "Leer el mensaje",
  "See your shop's orders": "Ver los pedidos de mi tienda",
  "See the job": "Ver el trabajo",
  "See your earnings": "Ver mis ganancias",
  "Open Louisiana Helpr": "Abrir Louisiana Helpr",
};

export function actionLabelInLanguage(label: string, lang: "en" | "es"): string {
  return lang === "es" ? (ACTION_LABEL_ES[label] ?? label) : label;
}

/** The notice email's sign-off: the site's own name (AUD31-20: it read "The Helpr Team"). */
export const NOTICE_SIGNOFF = "Louisiana Helpr";

/**
 * "7-day", "24-hour", "2-week": the number and its unit never split at the hyphen (audit 2026-10-31, AUD31-21: the
 * notice email broke "7-" / "day pickup deadline" across lines at 1440). A non-breaking hyphen (U+2011) holds them.
 */
export function keepNumberUnitsTogether(text: string): string {
  return text.replace(/(\d)-(day|days|hour|hours|minute|minutes|week|weeks|month|months)\b/g, "$1\u2011$2");
}
