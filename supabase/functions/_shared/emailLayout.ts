// The ONE raw-HTML email layout.
//
// Why a table, not a div: every Helpr template used to be
// `<div style="max-width:480px;margin:0 auto">`. Outlook 2007–2021 renders
// HTML with the WORD engine, which does not implement `margin:0 auto` on a
// block element — so in Outlook every Helpr email left-aligned and stretched
// to the full window width, at whatever width the reading pane happened to be.
// The fix is the boring, universally-supported one: an outer 100%-width table
// with `align="center"` on its cell, holding a fixed-width inner table.
//
// The CTA additionally ships an `<!--[if mso]>` VML fallback, because Word
// also ignores `border-radius` and `padding` on an inline anchor — an Outlook
// reader otherwise sees a bare blue-ish text link where everyone else sees a
// button.
//
// Dark mode: none of the templates handled it at all, so a client applying
// forced inversion (Outlook.com, Gmail on Android, Apple Mail on a dark
// system) was free to invert the card background and leave the dark body text
// dark — i.e. invisible. Every template now declares `color-scheme`, ships a
// `prefers-color-scheme: dark` block with an explicit palette, and sets
// `bgcolor` attributes so the client has a stated colour to work from instead
// of guessing.

import { brand } from "./email-templates/styles.ts";
import { POSTAL_ADDRESS, SUPPORT_EMAIL, UNSUBSCRIBE_MAILBOX } from "./resend.ts";
import { getAppUrl } from "./appUrl.ts";

/**
 * Wordmark. Served by the `brand-asset` edge function rather than the
 * marketing site — www.louisianahelpr.com sits behind Vercel's security
 * checkpoint and Gmail's/Apple's image proxies get a 429 challenge page
 * instead of the PNG.
 */
export const LOGO_URL = "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset";

/** Standard email content width. 600px is the long-settled safe maximum. */
export const EMAIL_WIDTH = 600;

/**
 * Dark palette. Mirrors the light tokens in `email-templates/styles.ts` one
 * for one so a client that honours `prefers-color-scheme` gets a deliberate
 * design instead of an algorithmic inversion.
 */
export const darkBrand = {
  page: "#14150F",
  surface: "#1F2018",
  hairline: "#3B3D2F",
  heading: "#F2F2E9",
  body: "#D3D6CA",
  footer: "#A7AD9C",
  accent: "#E08B57",
  cta: "#94A06D",
  ctaText: "#14150F",
} as const;

/**
 * Logo `<img>`. The `width` ATTRIBUTE and the CSS width must agree — Outlook
 * ignores CSS width on images, other clients prefer it, and for a long time
 * these said 80 and 150 respectively, so the same wordmark rendered at two
 * different sizes depending on the client. 80px is the documented value
 * (`email-templates/styles.ts`).
 */
export function emailLogo(): string {
  return `<img src="${LOGO_URL}" alt="Louisiana Helpr" width="80" height="auto" style="display:block;width:80px;max-width:80px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />`;
}

export const emailH1 = (t: string) =>
  `<h1 class="e-h1" style="font-size:24px;font-weight:bold;color:${brand.inkDeep};line-height:1.3;margin:0 0 16px">${t}</h1>`;

export const emailH2 = (t: string) =>
  `<h1 class="e-h1" style="font-size:20px;font-weight:bold;color:${brand.inkDeep};line-height:1.3;margin:0 0 12px">${t}</h1>`;

export const emailP = (t: string) =>
  `<p class="e-text" style="font-size:15px;color:${brand.bodyOlive};line-height:1.6;margin:0 0 20px">${t}</p>`;

/** Quiet 13px note above the footer rule. */
export const emailNote = (t: string) =>
  `<p class="e-note" style="font-size:13px;color:${brand.bodyOlive};line-height:1.5;margin:24px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">${t}</p>`;

/**
 * A bulletproof CTA button: VML for the Word engine, an ordinary rounded
 * anchor for everyone else.
 *
 * `widthPx` sizes the Outlook-only VML rectangle (Word cannot shrink-wrap
 * one); give it roughly `label.length * 9 + 60`.
 */
export function emailButton(href: string, label: string, widthPx = 240): string {
  return `<div style="margin:0 0 4px">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${widthPx}px;" arcsize="26%" strokecolor="${brand.bark}" fillcolor="${brand.bark}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a class="e-cta" href="${href}" style="display:inline-block;background-color:${brand.bark};color:#ffffff;font-size:15px;line-height:20px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">${label}</a>
<!--<![endif]-->
</div>`;
}

/**
 * Transactional footer — no unsubscribe (you cannot opt out of "your password
 * was reset"), no postal address requirement.
 */
export function transactionalFooter(bodyHtml: string): string {
  return `<p class="e-footer" style="font-size:12px;color:${brand.footerOlive};line-height:1.6;margin:28px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">${bodyHtml}</p>`;
}

/**
 * Commercial / lifecycle footer.
 *
 * CAN-SPAM §7704(a)(5) requires a physical postal address on this class of
 * mail. `POSTAL_ADDRESS` comes from the `HELPR_POSTAL_ADDRESS` secret and is
 * empty until the owner sets it — the line is omitted rather than faked, and
 * `resend.ts` carries the instructions.
 */
export function marketingFooter(opts?: { reasonLine?: string; unsubscribeUrl?: string }): string {
  const unsubUrl = opts?.unsubscribeUrl ?? `${getAppUrl()}/profile?tab=notifications`;
  const reason = opts?.reasonLine ?? `You're receiving this because you signed up at ${getAppUrl().replace(/^https?:\/\//, "")}.`;
  const postal = POSTAL_ADDRESS
    ? `<br /><span class="e-footer">${POSTAL_ADDRESS}</span>`
    : "";
  return `<p class="e-footer" style="font-size:12px;color:${brand.footerOlive};line-height:1.6;margin:28px 0 0;padding:16px 0 0;border-top:1px solid ${brand.hairline}">
    ${reason}<br />
    <a class="e-footer-link" href="${unsubUrl}" style="color:${brand.footerOlive};text-decoration:underline">Unsubscribe from these emails</a>
    &nbsp;·&nbsp; <a class="e-footer-link" href="mailto:${UNSUBSCRIBE_MAILBOX}" style="color:${brand.footerOlive};text-decoration:underline">unsubscribe by email</a>${postal}
  </p>`;
}

/** Plaintext twin of `marketingFooter` — keep the two in step. */
export function marketingFooterText(): string {
  const unsub = `${getAppUrl()}/profile?tab=notifications`;
  return `\n\n—\nYou're receiving this because you signed up at ${getAppUrl().replace(/^https?:\/\//, "")}.\nUnsubscribe: ${unsub}${POSTAL_ADDRESS ? `\n${POSTAL_ADDRESS}` : ""}`;
}

/** List-Unsubscribe headers for commercial / lifecycle mail. */
export function unsubscribeHeaders(): Record<string, string> {
  return {
    "List-Unsubscribe": `<${getAppUrl()}/profile?tab=notifications>, <mailto:${UNSUBSCRIBE_MAILBOX}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface EmailShellOptions {
  /**
   * Inbox preview line. Without one, clients fall back to the first words of
   * the body — which for most Helpr mail was literally "Hey there,".
   */
  preheader: string;
  /** Card contents (already-escaped HTML). */
  body: string;
  /** Optional `<title>`; defaults to the preheader. */
  title?: string;
  /** Card width in px. */
  width?: number;
  /** Extra markup after the card (tracking pixel, etc). */
  trailing?: string;
}

/**
 * Wrap body HTML in the shared table layout.
 *
 * Structure is deliberately the boring canonical one:
 *   table[100%] > td[align=center] > table[600] > td > content
 */
export function emailShell(opts: EmailShellOptions): string {
  const width = opts.width ?? EMAIL_WIDTH;
  const title = opts.title ?? opts.preheader;
  // Padded with zero-width joiners so the preview line isn't followed by the
  // first line of the body in the inbox list.
  const preheaderPad = "&#8203;&nbsp;".repeat(30);

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${title}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
  img { -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
  @media only screen and (max-width:${width + 40}px) {
    .e-card { width:100% !important; max-width:100% !important; }
    .e-pad { padding:24px 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .e-bg { background-color:${darkBrand.page} !important; }
    .e-card { background-color:${darkBrand.surface} !important; border-color:${darkBrand.hairline} !important; }
    .e-h1 { color:${darkBrand.heading} !important; }
    .e-text, .e-note { color:${darkBrand.body} !important; }
    .e-text strong, .e-note strong { color:${darkBrand.heading} !important; }
    .e-accent { color:${darkBrand.accent} !important; }
    .e-footer, .e-footer a, .e-footer-link { color:${darkBrand.footer} !important; }
    .e-cta { background-color:${darkBrand.cta} !important; color:${darkBrand.ctaText} !important; }
    .e-rule { border-color:${darkBrand.hairline} !important; }
  }
</style>
</head>
<body class="e-bg" bgcolor="${brand.parchment}" style="background-color:${brand.parchment};font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:0;width:100%">
<div style="display:none;font-size:1px;color:${brand.parchment};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${opts.preheader}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-bg" bgcolor="${brand.parchment}" style="background-color:${brand.parchment};width:100%">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" class="e-card" bgcolor="${brand.surface}" style="width:${width}px;max-width:${width}px;background-color:${brand.surface};border:1px solid ${brand.hairline};border-radius:14px">
        <tr>
          <td class="e-pad" align="left" style="padding:32px 28px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif">
${emailLogo()}
${opts.body}
          </td>
        </tr>
      </table>${opts.trailing ?? ""}
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Convenience: the support mailbox as an inline link. */
export function supportLink(): string {
  return `<a class="e-accent" href="mailto:${SUPPORT_EMAIL}" style="color:${brand.burntSienna}">${SUPPORT_EMAIL}</a>`;
}
