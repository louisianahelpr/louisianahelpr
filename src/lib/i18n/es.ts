/**
 * The app's words, Spanish (owner-approved 2026-10-29: many Louisiana Helprs
 * speak Spanish first). Plain, friendly, "usted". Loaded only when a member
 * picks Spanish (dynamic import in language.ts), so English users download none
 * of it. Money and legal meaning must match en.ts exactly; Terms/Privacy stay
 * in English and say so ("lang.legalInEnglish").
 */
import type { MsgKey } from "./en";

export const es: Record<MsgKey, string> = {
  "lang.label": "Idioma",
  "lang.english": "English",
  "lang.spanish": "Español",
  "lang.switchTo": "Cambiar el idioma a {lang}",
  "lang.legalInEnglish": "Los términos legales están en inglés.",

  "nav.home": "Inicio",
  "nav.posts": "Publicaciones",
  "nav.jobs": "Trabajos",
  "nav.messages": "Mensajes",
  "nav.profile": "Perfil",
  "nav.you": "Usted",
  "nav.explore": "Explorar",
  "nav.declutter": "Ventas",
  "nav.shops": "Tiendas",
  "nav.homes": "Casas",
  "nav.create": "Crear",
  "nav.primary": "Principal",
  "nav.bottom": "Navegación inferior",
  "nav.comingSoon": "{label}, muy pronto",
  "nav.isComingSoon": "{label} llega muy pronto",

  "hero.titleLead": "Su aliado local en",
  "hero.titleAccent": "Luisiana.",
  "hero.subhead": "Contrate ayuda o encuentre trabajo. Una cuenta, vecinos de verdad.",

  "login.title": "Iniciar sesión",
  "login.welcome": "Qué gusto verle de nuevo, vecino.",
  "login.email": "Correo electrónico",
  "login.password": "Contraseña",
  "login.forgot": "¿Olvidó su contraseña?",
  "login.emailInvalid": "Escriba un correo electrónico válido",
  "login.emailMissing": "Escriba su correo electrónico",
  "login.passwordMissing": "Escriba su contraseña",
  "login.showPassword": "Mostrar contraseña",
  "login.hidePassword": "Ocultar contraseña",
  "login.submit": "Iniciar sesión",
  "login.submitting": "Iniciando sesión…",
  "login.newHere": "¿Es nuevo en Helpr?",
  "login.createAccount": "Crear una cuenta",
  "login.mfaTitle": "Verificación en dos pasos",
  "login.mfaBody": "Escriba el código de 6 dígitos de su app de autenticación para terminar de iniciar sesión.",
  "login.mfaCode": "Código de autenticación",
  "login.verify": "Verificar",
  "login.verifying": "Verificando…",
  "login.differentAccount": "Usar otra cuenta",
  "login.confirmEmailFirst": "Revise su correo primero: debe confirmar su correo electrónico antes de iniciar sesión.",
  "login.mfaCheckFailed": "No pudimos verificar su configuración de seguridad. ¿Lo intenta de nuevo?",
  "login.tooManyAttempts": "Demasiados intentos. Inténtelo de nuevo en {minutes} min.",
  "login.mfaWrongCode": "Ese código no coincide. Revise su app e inténtelo de nuevo.",
};
