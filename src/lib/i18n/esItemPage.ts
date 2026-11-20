/** Spanish for enItemPage.ts (design audit r2 #35): Declutter item page and card words. */
import type { enItemPage } from "./enItemPage";

export const esItemPage: Record<keyof typeof enItemPage, string> = {
  "ip.inclFee": "con tarifa",
  "ip.protected": "Protegido: pague en la app, 24 horas para reportar un problema.",
  "ip.protectedPorch": "Protegido: pague en la app, recoja en el porche, 24 horas para reportar un problema.",
  "ip.demand.offers": "{n} ofertas esta semana",
  "ip.demand.saves": "{n} personas guardaron esto",
  "ip.demand.views": "{n} vistas hoy",
  "ip.demand.label": "Muy buscado",
  "ip.away.about": "A unos {n} mi",
  "ip.away.under1": "A menos de 1 mi",
  "ip.away.n": "A {n} mi",
  "ip.listed": "Publicado {when}",
  "ip.ago.now": "justo ahora",
  "ip.ago.min": "hace {n} min",
  "ip.ago.h": "hace {n} h",
  "ip.ago.yesterday": "ayer",
  "ip.ago.days": "hace {n} días",
  "ip.ago.week": "hace 1 semana",
  "ip.ago.weeks": "hace {n} semanas",
  "ip.badge.listsOften": "Publica seguido",
  "ip.badge.onTime": "Entregas a tiempo",
  "ip.badge.active": "Activo hoy",
  "ip.joined": "Se unió en {date}",
};
