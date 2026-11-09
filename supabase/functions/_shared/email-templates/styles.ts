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
  /** Headline ink — the brand text colour #2E2F22 (owner's UI audit 11-09, F158; was #23231A). */
  inkDeep: '#2E2F22',
  /** --burnt-sienna  hsl(19 75% 35%) — warm accent / emphasis + inline links. 6.6:1 on white. */
  burntSienna: '#984216',
  /** --sage  hsl(78 9% 53%) — secondary accent. */
  sage: '#8C947D',
  /** Page canvas: the brand's warm off-white #F7F5F1 (F158: was the cool grey #F0F2F4). */
  parchment: '#F7F5F1',
  /** Body copy: the brand's secondary text #615E56 (F158: was the blue-grey #55656D). 6.3:1 on white. */
  bodyOlive: '#615E56',
  /** 12–13px legal/footer copy: the same brand secondary text (F158: was #6E7C83). 6.3:1 on white. */
  footerOlive: '#615E56',
  /** Card border / hairline rule: the brand border #E6E2DA (F158: was the cool #CBCFD8). */
  hairline: '#E6E2DA',
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
 * Brand mark image URL — THE H MARK, and it carries a VERSION for a reason.
 *
 * Served by the `brand-asset` edge function rather than by the marketing site:
 * www.louisianahelpr.com sits behind Vercel's security checkpoint, and Gmail's
 * and Apple Mail's image proxies both receive a 429 challenge page instead of
 * the PNG. Confirmed from two separate networks.
 *
 * ── WHY THE `?v=` IS LOAD-BEARING ────────────────────────────────────────
 * The owner asked for the H mark instead of the wordmark on 2026-08-27, and
 * `32d670c9f` delivered it — by swapping the BYTES behind this URL while
 * deliberately keeping the URL itself stable ("only the bytes changed"), so
 * that every caller kept working.
 *
 * That is precisely what made the fix invisible. `brand-asset` answers with
 *
 *     cache-control: public, max-age=31536000, immutable
 *
 * A YEAR, and `immutable` — which tells a cache never to revalidate, not even
 * with an If-None-Match. Gmail does not hotlink an email image; it proxies and
 * caches it under googleusercontent.com, keyed by URL. Every proxy that had
 * fetched the wordmark before the swap therefore went on serving the wordmark,
 * and would have done for a year.
 *
 * So the origin was right and the inbox was wrong, which is why the owner
 * reported it again on 2026-09-20 having already reported it once: verified
 * that day, the live URL returns the 160×138 H mark, while mail sent that same
 * morning still rendered the old wordmark.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 * `immutable` and a stable URL are a correct pairing ONLY if the bytes never
 * change. They do change. So the URL carries the version instead:
 *
 *   **If you change what `brand-asset` serves, bump this token in the same
 *   commit.** A new token is a new cache key, which is the only thing that
 *   reaches an inbox that has already cached the old image.
 *
 * `src/test/emailLogoIsVersioned.test.ts` fails if this is missing, and pins
 * the token to the bytes the function actually serves.
 */
export const LOGO_VERSION = 'h-mark-2026-08-27'

export const LOGO_URL =
  `https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset?v=${LOGO_VERSION}`

/**
 * Body face. Montserrat is the app's sans; degrades to the usual grotesques. EmailHead loads it (and Bodoni Moda) from
 * Google Fonts for the clients that honour a webfont link (Apple Mail, iOS Mail, some webmail); Gmail and Outlook
 * strip it and fall back down this stack (owner's UI audit 11-09, F158: it was named but never loaded).
 */
const bodyFontStack =
  "'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif"

/** Headline face (F158): Bodoni Moda, the site's display serif, with Georgia where webfonts are stripped. */
export const headingFontStack = "'Bodoni Moda', Georgia, 'Times New Roman', serif"

/** The one webfont request: Bodoni Moda 700 for headlines, Montserrat 400/600 for text. */
export const EMAIL_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@700&family=Montserrat:wght@400;600&display=swap'


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
    .e-logo { background-color:#F7F5F1 !important; }
  }
`

/**
 * H mark IMAGE styling. It is an <Img>, not text — see the note above for
 * why. Width is set on the element too (Outlook ignores CSS width on
 * images), and `display:block` kills the baseline gap.
 */
export const logo = {
  display: 'block' as const,
  // Kept in sync with the `width="80"` attribute every template's <Img> also
  // sets (Outlook ignores CSS width on images, so both must agree). This was
  // 150px — nearly double the intended size — so any client honouring CSS
  // over the HTML attribute (Mailinator's renderer, some webmail) rendered
  // the H mark oversized.
  width: '80px',
  maxWidth: '80px',
  height: 'auto' as const,
  margin: '0 0 24px',
  // The dark iron H on a light rounded tile of its own (owner's UI audit 11-09, F155): on a dark-mode client's dark
  // card the mark all but disappeared. White on the white light card shows nothing; EMAIL_CSS's dark block keeps the
  // tile light (.e-logo) where a client would otherwise darken it.
  backgroundColor: '#FFFFFF',
  padding: '6px',
  borderRadius: '12px',
  border: '0',
  outline: 'none',
  textDecoration: 'none',
}

export const h1 = {
  fontFamily: headingFontStack,
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

const button = {
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
