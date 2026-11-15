/**
 * Welcome emails (owner 11-14, "Yes do that"): the words, in one place.
 *
 * Two emails to a new member: day 1 (a day after sign-up) and day 3. Each
 * shows up to three open jobs and three things for sale near the member, so
 * the first email after sign-up is about real things nearby, not a tour.
 * Measured on prod 2026-11-14 (read-only, 14 days): of 37 real new members,
 * 18 only ever saw Home, 0 posted, and 8 came back after day 1.
 *
 * WHO gets one is decided in SQL (public.claim_welcome_emails, migration
 * welcome_emails); this file is only what the email says, in English and in
 * Spanish (profiles.language 'es', F260q "Spanish everything"). The template
 * is email-templates/welcome.tsx and the sender is welcome-emails/index.ts.
 * These two replace the old drip's day 1 and day 3 steps in
 * engagement-automations (its day 7 tips email stays).
 *
 * Zero imports on purpose, so a vitest can load it
 * (src/test/welcomeEmails.test.ts holds the copy rules).
 */

export type WelcomeStep = 1 | 3;
export type WelcomeLang = "en" | "es";

/** email_send_log.template_name and the queue label for each step. */
export function welcomeTemplateName(step: WelcomeStep): string {
  return `welcome_day_${step}`;
}

export interface WelcomeCopy {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  heading: string;
  /** Paragraphs after "Hi <name>,". */
  intro: string[];
  jobsHeading: string;
  itemsHeading: string;
  /** Shown instead of the two lists when nothing is open nearby. */
  nothingNear: string;
  button: string;
  /** The last line, before the footer. */
  closing: string;
}

export const WELCOME_COPY: Record<WelcomeLang, Record<WelcomeStep, WelcomeCopy>> = {
  en: {
    1: {
      subject: "Welcome to Louisiana Helpr. Here's what's near you.",
      preheader: "Open jobs and things for sale near you, picked for your first day.",
      heading: "Welcome to Louisiana Helpr",
      intro: [
        "Your account is set up. One account lets you hire help, find work, and buy or sell with neighbors.",
        "Here's what's open near you right now:",
      ],
      jobsHeading: "Jobs near you",
      itemsHeading: "For sale near you",
      nothingNear: "Nothing is listed near you yet. Post a job or list something, and neighbors will see it first.",
      button: "Open Louisiana Helpr",
      closing: "Questions? Just reply to this email. - Louisiana Helpr",
    },
    3: {
      subject: "New near you on Louisiana Helpr",
      preheader: "A few more jobs and finds near you this week.",
      heading: "New near you this week",
      intro: [
        "Neighbors keep posting. Here's what's open near you now.",
        "Got stuff you don't need? List it on Declutter in a minute: snap a photo and set a garage-sale price.",
      ],
      jobsHeading: "Jobs near you",
      itemsHeading: "For sale near you",
      nothingNear: "Nothing is listed near you yet. Post a job or list something, and neighbors will see it first.",
      button: "See what's near you",
      closing: "Questions? Just reply to this email. - Louisiana Helpr",
    },
  },
  es: {
    1: {
      subject: "Bienvenido a Louisiana Helpr. Esto es lo que hay cerca de ti.",
      preheader: "Trabajos abiertos y cosas a la venta cerca de ti, para tu primer día.",
      heading: "Bienvenido a Louisiana Helpr",
      intro: [
        "Tu cuenta está lista. Con una sola cuenta puedes contratar ayuda, encontrar trabajo y comprar o vender con tus vecinos.",
        "Esto es lo que hay abierto cerca de ti ahora:",
      ],
      jobsHeading: "Trabajos cerca de ti",
      itemsHeading: "A la venta cerca de ti",
      nothingNear: "Todavía no hay nada publicado cerca de ti. Publica un trabajo o algo para vender, y tus vecinos lo verán primero.",
      button: "Abrir Louisiana Helpr",
      closing: "¿Preguntas? Solo responde a este correo. - Louisiana Helpr",
    },
    3: {
      subject: "Novedades cerca de ti en Louisiana Helpr",
      preheader: "Algunos trabajos y hallazgos más cerca de ti esta semana.",
      heading: "Novedades cerca de ti esta semana",
      intro: [
        "Tus vecinos siguen publicando. Esto es lo que hay abierto cerca de ti ahora.",
        "¿Tienes cosas que no necesitas? Publícalas en Declutter en un minuto: toma una foto y pon un precio de venta de garaje.",
      ],
      jobsHeading: "Trabajos cerca de ti",
      itemsHeading: "A la venta cerca de ti",
      nothingNear: "Todavía no hay nada publicado cerca de ti. Publica un trabajo o algo para vender, y tus vecinos lo verán primero.",
      button: "Ver lo que hay cerca",
      closing: "¿Preguntas? Solo responde a este correo. - Louisiana Helpr",
    },
  },
};

/** "Hi Pat," / "Hola Pat," from "Pat Smith"; "there" / no name when there is none. */
export function welcomeGreeting(fullName: string | null | undefined, lang: WelcomeLang): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (lang === "es") return first ? `Hola ${first},` : "Hola,";
  return `Hi ${first || "there"},`;
}

/** Why the recipient got it, in the footer above the unsubscribe link. */
export const WELCOME_REASON: Record<WelcomeLang, string> = {
  en: "You're receiving this because you have a Louisiana Helpr account and agreed to emails from us.",
  es: "Recibes este correo porque tienes una cuenta en Louisiana Helpr y aceptaste recibir correos nuestros.",
};

/** The unsubscribe link's words. */
export const WELCOME_UNSUBSCRIBE: Record<WelcomeLang, string> = {
  en: "Unsubscribe from these emails",
  es: "Cancelar la suscripción a estos correos",
};

/** An item's list price, as Declutter's card shows it big: "$40" from 4000 cents, "$12.50" from 1250, "Free" at 0. */
export function welcomePriceLabel(cents: number, lang: WelcomeLang): string {
  if (!(cents > 0)) return lang === "es" ? "Gratis" : "Free";
  const whole = cents % 100 === 0;
  return `$${whole ? String(cents / 100) : (cents / 100).toFixed(2)}`;
}

/** profiles.language -> the email's language: Spanish only on an exact 'es' (as the Declutter seller email reads it). */
export function welcomeLang(language: string | null | undefined): WelcomeLang {
  return language === "es" ? "es" : "en";
}
