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
  // #55656D — the exact hex of --stormy-sky (198 12% 38%), the app's
  // secondary-text token. Was #5E5F4E, an olive-grey that existed nowhere
  // in the app, so email and product disagreed about what quiet text looks
  // like (Q5).
  bodyOlive: '#55656D',
  /** Softer olive for 12–13px legal/footer copy — still passes AA (5.2:1). */
  // Same family, one step quieter. Was #6A6F5D — a second invented olive.
  footerOlive: '#6E7C83',
  /** Hairline rule / card border in the olive family. */
  // #CBCFD8 — the hex of --border (220 14% 82%). Was #E3E4DD, warm.
  hairline: '#CBCFD8',
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
 * Every wordmark is an <Img> with alt="Louisiana Helpr", which is standard
 * email practice and also settles P3 (the alt text is the full name, not the
 * short one). This note used to claim that had already happened while all six
 * auth templates still rendered `<Text style={logo}>Helpr</Text>` — the fix was
 * described but never applied, so the emails kept shipping in Times New Roman.
 *
 * The image is served by the `brand-asset` edge function rather than by the
 * marketing site: www.louisianahelpr.com sits behind Vercel's security
 * checkpoint, and Gmail's and Apple Mail's image proxies both receive a 429
 * challenge page instead of the PNG. Confirmed from two separate networks.
 *
 * The Bodoni/Didot stack that used to live here is gone with the last text
 * wordmark. It was kept "in case a template wants display text", nothing ever
 * did, and leaving it invited the next person to reach for a face that mail
 * clients cannot load.
 */

/**
 * Wordmark image URL.
 *
 * Served by the `brand-asset` edge function rather than by the marketing site:
 * www.louisianahelpr.com sits behind Vercel's security checkpoint, and Gmail's
 * and Apple Mail's image proxies both receive a 429 challenge page instead of
 * the PNG. Confirmed from two separate networks.
 */
export const LOGO_URL =
  'https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset'

/** Body face. Montserrat is the app's sans; degrades to the usual grotesques. */
export const bodyFontStack =
  "'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif"

export const main = {
  backgroundColor: brand.parchment,
  fontFamily: bodyFontStack,
  margin: '0',
  padding: '24px 12px',
}

/**
 * The card. react-email's <Container> renders as a centred `<table>` (not a
 * `<div style="margin:0 auto">`), which is what makes it survive Outlook's
 * Word rendering engine — Word does not implement `margin:0 auto` on a block
 * element, so every hand-rolled div-based Helpr template left-aligned and
 * stretched there. Width raised 480 → 600 so the whole product — the six auth
 * emails and the nine templates ported off hand-built HTML strings — renders
 * at one width.
 */
export const container = {
  padding: '32px 28px',
  width: '600px',
  maxWidth: '600px',
  backgroundColor: brand.surface,
  border: `1px solid ${brand.hairline}`,
  borderRadius: '14px',
}

/**
 * Dark-mode + client-reset CSS injected into every auth template's <Head>.
 *
 * None of the eleven Helpr templates handled dark mode at all. A client
 * applying forced inversion (Outlook.com, Gmail on Android, Apple Mail on a
 * dark system) was free to darken the card while leaving the already-dark body
 * text dark — i.e. invisible. Declaring `color-scheme` and shipping an
 * explicit dark palette takes that decision back.
 *
 * The class names (`e-bg`, `e-card`, `e-h1`, `e-text`, `e-note`, `e-rule`,
 * `e-footer`, `e-cta`, `e-accent`) are applied by the shared components in
 * `components.tsx`; every template must carry them or it will not invert.
 */
export const EMAIL_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
  @media only screen and (max-width:640px) {
    .e-card { width:100% !important; max-width:100% !important; padding:24px 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .e-bg { background-color:#14150F !important; }
    .e-card { background-color:#1F2018 !important; border-color:#3B3D2F !important; }
    .e-h1 { color:#F2F2E9 !important; }
    .e-text { color:#D3D6CA !important; }
    .e-text strong { color:#F2F2E9 !important; }
    .e-accent, .e-text a { color:#E08B57 !important; }
    .e-footer, .e-footer a { color:#A7AD9C !important; }
    .e-cta { background-color:#94A06D !important; color:#14150F !important; }
    .e-rule, .e-footer { border-color:#3B3D2F !important; }
  }
`

/**
 * Wordmark IMAGE styling. The wordmark is an <Img>, not text — see the note
 * above for why. Width is set on the element too (Outlook ignores CSS width on
 * images), and `display:block` kills the baseline gap.
 */
export const logo = {
  display: 'block' as const,
  // Kept in sync with the `width="80"` attribute every template's <Img> also
  // sets (Outlook ignores CSS width on images, so both must agree). This was
  // 150px — nearly double the intended size — so any client honouring CSS
  // over the HTML attribute (Mailinator's renderer, some webmail) rendered
  // the wordmark oversized.
  width: '80px',
  maxWidth: '80px',
  height: 'auto' as const,
  margin: '0 0 24px',
  border: '0',
  outline: 'none',
  textDecoration: 'none',
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
