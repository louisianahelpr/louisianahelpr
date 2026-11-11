/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the account emails (sign-up confirm, password reset, code, email
 * change) in the recipient's language. English is the text these templates always sent; Spanish says the same thing.
 * Brand names ("Louisiana Helpr", "Declutter") are never translated. Plain module (no npm: imports) so the words and
 * the language pick can be tested without Deno.
 *
 * The language: auth-email-hook passes `authEmailLang(...)` (sign-up metadata `lang`, written by the sign-up form from
 * the visitor's English/Español switch or browser language, then profiles.language; anything else is English).
 */
export type EmailLang = 'en' | 'es'

/** 'es' only for an exact 'es'; anything missing, unknown or malformed reads English (the old behaviour). */
export function authEmailLang(metaLang: unknown, profileLang?: unknown): EmailLang {
  if (metaLang === 'es' || metaLang === 'en') return metaLang
  return profileLang === 'es' ? 'es' : 'en'
}

/** Subjects, per Supabase email_action_type. */
export const AUTH_EMAIL_SUBJECTS: Record<EmailLang, Record<string, string>> = {
  en: {
    signup: 'Confirm your email',
    // F188 (owner's message review 11-09): "Louisiana Helpr" in every subject.
    invite: "You've been invited to Louisiana Helpr",
    magiclink: 'Your Louisiana Helpr code',
    recovery: 'Reset your Louisiana Helpr password',
    email_change: 'Confirm your new email',
    email_change_current: 'Email change requested',
    email_change_new: 'Confirm your new email',
    reauthentication: 'Your confirmation code',
  },
  es: {
    signup: 'Confirme su correo',
    // Invite mail goes to someone with no account and no language yet: it stays English (no Spanish key).
    magiclink: 'Su código de Louisiana Helpr',
    recovery: 'Restablezca su contraseña de Louisiana Helpr',
    email_change: 'Confirme su nuevo correo',
    email_change_current: 'Se pidió un cambio de correo',
    email_change_new: 'Confirme su nuevo correo',
    reauthentication: 'Su código de confirmación',
  },
}

/** The subject for this email type in this language; a type with no Spanish subject keeps the English one. */
export function authEmailSubject(type: string, lang: EmailLang): string {
  return AUTH_EMAIL_SUBJECTS[lang][type] ?? AUTH_EMAIL_SUBJECTS.en[type] ?? 'Notification'
}

export const SIGNUP_WORDS = {
  en: {
    preheader: 'Confirm your email to get started on Louisiana Helpr',
    heading: 'Confirm your email',
    body: 'Tap the button below to confirm your email and finish setting up your Louisiana Helpr account.',
    button: 'Confirm my email',
    idNote:
      "Confirming takes a moment and you're in. We'll only ask for an ID check the first time you post a job, take a job, list an item or buy one.",
    footer: "If you didn't create an account on Louisiana Helpr, you can safely ignore this email.",
  },
  es: {
    preheader: 'Confirme su correo para empezar en Louisiana Helpr',
    heading: 'Confirme su correo',
    body: 'Toque el botón de abajo para confirmar su correo y terminar de crear su cuenta de Louisiana Helpr.',
    button: 'Confirmar mi correo',
    idNote:
      'Confirmar toma un momento y ya está dentro. Solo le pediremos una verificación de identidad la primera vez que publique un trabajo, acepte un trabajo, publique un artículo o compre uno.',
    footer: 'Si no creó una cuenta en Louisiana Helpr, puede ignorar este correo.',
  },
} as const

export const RECOVERY_WORDS = {
  en: {
    preheader: 'Reset your Louisiana Helpr password',
    heading: 'Reset your password',
    body: 'We got a request to reset your password. Tap the button below to choose a new password.',
    button: 'Choose a new password',
    footer: "If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.",
  },
  es: {
    preheader: 'Restablezca su contraseña de Louisiana Helpr',
    heading: 'Restablezca su contraseña',
    body: 'Recibimos una solicitud para restablecer su contraseña. Toque el botón de abajo para elegir una nueva.',
    button: 'Elegir una nueva contraseña',
    footer: 'Si no pidió restablecer su contraseña, puede ignorar este correo. Su contraseña no cambiará.',
  },
} as const

export const MAGIC_LINK_WORDS = {
  en: {
    preheader: 'Your Louisiana Helpr code',
    heading: 'Your Louisiana Helpr code',
    body: "Enter this code in the app to confirm it's you:",
    footer: "This code expires soon. If you didn't ask for it, you can ignore this email; nothing changes without the code.",
  },
  es: {
    preheader: 'Su código de Louisiana Helpr',
    heading: 'Su código de Louisiana Helpr',
    body: 'Escriba este código en la app para confirmar que es usted:',
    footer: 'Este código vence pronto. Si no lo pidió, puede ignorar este correo; nada cambia sin el código.',
  },
} as const

export const REAUTH_WORDS = {
  en: {
    preheader: 'Your Louisiana Helpr confirmation code',
    heading: 'Your confirmation code',
    body: "Enter this code in the app to confirm it's you:",
    footer: "It expires soon. If you didn't ask for it, you can ignore this email; nothing changes without the code.",
  },
  es: {
    preheader: 'Su código de confirmación de Louisiana Helpr',
    heading: 'Su código de confirmación',
    body: 'Escriba este código en la app para confirmar que es usted:',
    footer: 'Vence pronto. Si no lo pidió, puede ignorar este correo; nada cambia sin el código.',
  },
} as const

export const EMAIL_CHANGE_WORDS = {
  en: {
    preheader: 'Confirm your email change on Louisiana Helpr',
    heading: 'Confirm your email change',
    from: 'You requested to change your email from',
    to: 'to',
    button: 'Confirm the change',
    notYou: "Didn't ask for this? Don't confirm it, and reset your password so no one else can sign in:",
    reset: 'reset my password',
  },
  es: {
    preheader: 'Confirme el cambio de correo en Louisiana Helpr',
    heading: 'Confirme el cambio de correo',
    from: 'Pidió cambiar su correo de',
    to: 'a',
    button: 'Confirmar el cambio',
    notYou: '¿No lo pidió? No lo confirme y restablezca su contraseña para que nadie más pueda entrar:',
    reset: 'restablecer mi contraseña',
  },
} as const

/** Pick a words block; an unknown language reads English. */
export function wordsFor<T extends { en: unknown; es: unknown }>(words: T, lang: unknown): T['en'] {
  return (lang === 'es' ? words.es : words.en) as T['en']
}
