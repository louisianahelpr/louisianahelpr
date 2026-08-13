// Single source of truth for transactional-email styling.
//
// Every auth template in this folder imports from here so the brand can never
// drift between them again (before this module each template redeclared its own
// near-identical `main`/`container`/`logo`/`h1`/`text`/`button`/`footer`, and
// they had all silently rotted onto the pre-2026 kelly-green brand).
//
// Values are LITERAL hex — mail clients don't resolve CSS custom properties, so
// `hsl(var(--bark))` is not an option here. These mirror the light-mode tokens
// in `src/index.css`; when a token changes there, change it here too.
//
// react-email requires plain inline style objects (no classes, no CSS vars),
// so everything below is a POJO spread straight onto a component's `style`.

/** Brand palette — literal light-mode values from `src/index.css`. */
export const brand = {
  /** --bark  hsl(70 20% 33%) — deep olive. Primary CTA / wordmark. 6.1:1 on white. */
  bark: '#5E6544',
  /** --olivewood  hsl(64 16% 16%) — primary text / dark ground. */
  olivewood: '#2E2F22',
  /** --ink-deep  hsl(64 16% 12%) — deep olivewood for headlines. 15.8:1 on white. */
  inkDeep: '#23231A',
  /** --burnt-sienna  hsl(19 75% 35%) — warm accent / emphasis + inline links. 6.6:1 on white. */
  burntSienna: '#984216',
  /** --sage  hsl(78 9% 53%) — secondary accent. */
  sage: '#8C947D',
  /** --parchment  hsl(220 14% 95%) — page canvas. */
  parchment: '#F0F2F4',
  /** Muted olive body copy — readable at 15px on white (6.5:1). Replaces the old cool grey. */
  bodyOlive: '#5E5F4E',
  /** Softer olive for 12–13px legal/footer copy — still passes AA (5.2:1). */
  footerOlive: '#6A6F5D',
  /** Hairline rule / card border in the olive family. */
  hairline: '#E3E4DD',
  /** Card + email surface. */
  surface: '#ffffff',
} as const

/**
 * Wordmark face — NO LONGER USED FOR THE WORDMARK ITSELF (Q1).
 *
 * The templates used to render "Helpr" as live text in this stack. There is no
 * @font-face and there usefully cannot be one: Gmail strips webfonts and
 * Outlook desktop ignores them, so the fallback chain decided the brand. On a
 * Mac it landed on Didot and looked close; on Gmail for Android and on Windows
 * — very likely most recipients — it landed on Times New Roman. The single
 * brand element in every transactional email, and the main thing separating an
 * approval notice from a phishing attempt, rendered as the default word
 * -processor serif.
 *
 * All eleven wordmarks are now <img> tags pointing at /helpr-wordmark.png with
 * alt="Louisiana Helpr", which is standard email practice and also settles P3
 * (the alt text is the full name, not the short one).
 *
 * This stack is kept for genuine display TEXT inside a template, where a serif
 * fallback is acceptable because the words are content rather than logo.
 */
export const displayFontStack =
  "'Bodoni Moda', Didot, 'Times New Roman', Georgia, serif"

/** Body face. Montserrat is the app's sans; degrades to the usual grotesques. */
export const bodyFontStack =
  "'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif"

export const main = {
  backgroundColor: brand.surface,
  fontFamily: bodyFontStack,
}

export const container = { padding: '32px 28px', maxWidth: '480px' }

export const logo = {
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: brand.bark,
  margin: '0 0 24px',
  fontFamily: displayFontStack,
}

export const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: brand.inkDeep,
  margin: '0 0 16px',
}

export const text = {
  fontSize: '15px',
  color: brand.bodyOlive,
  lineHeight: '1.6',
  margin: '0 0 20px',
}

export const subtext = {
  fontSize: '13px',
  color: brand.bodyOlive,
  lineHeight: '1.5',
  margin: '24px 0 0',
  padding: '16px 0 0',
  borderTop: `1px solid ${brand.hairline}`,
}

export const linkStyle = {
  color: brand.burntSienna,
  textDecoration: 'underline',
}

export const button = {
  backgroundColor: brand.bark,
  color: '#ffffff',
  fontSize: '15px',
  borderRadius: '12px',
  padding: '14px 28px',
  textDecoration: 'none',
  fontWeight: '600' as const,
}

export const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: brand.bark,
  margin: '0 0 30px',
  letterSpacing: '4px',
}

export const footer = {
  fontSize: '12px',
  color: brand.footerOlive,
  margin: '24px 0 0',
}
