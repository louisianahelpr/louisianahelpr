/** Spanish for enGuest.ts (design audit r2 #37): the guest's way in. */
import type { enGuest } from "./enGuest";

export const esGuest: Record<keyof typeof enGuest, string> = {
  "g.signedOut": "Se cerró su sesión. Inicie sesión de nuevo para administrar esta publicación.",
  "g.askItem": "Pedir este artículo",
  "g.buyOrOffer": "Comprar o hacer una oferta",
  "g.buyItem": "Comprar este artículo",
  "g.makeOffer": "Hacer oferta",
  "g.buyNow": "Comprar ahora",
  "g.signUpAsk": "Regístrese para pedirlo",
  "g.freeJoin": "Registrarse es gratis. Lo traeremos de vuelta a este artículo.",
  "g.trades": "Inicie sesión y publique un artículo para ofrecer un intercambio.",
  "g.want.offer": "Inicie sesión para ver su oferta",
  "g.want.order": "Inicie sesión para ver su pedido",
  "g.want.sales": "Inicie sesión para ver sus ventas",
  "g.want.post": "Inicie sesión para publicar lo que busca",
  "g.want.wanted": "Inicie sesión para ver lo que busca",
  "g.joinAria": "Únase para comprar o vender",
  "g.newHere": "¿Es nuevo aquí?",
  "g.openJobs": "{n} trabajos abiertos",
  "g.openJob": "1 trabajo abierto",
};
