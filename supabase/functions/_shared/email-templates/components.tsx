/// <reference types="npm:@types/react@18.3.1" />

// Shared react-email building blocks for EVERY Helpr email.
//
// WHY THIS EXISTS
// Eleven templates, two implementations. Six auth emails were react-email
// components; the other five were hand-built HTML strings shaped like
// `<div style="max-width:480px;margin:0 auto">`. Outlook renders HTML with the
// WORD engine, which does not implement `margin:0 auto` on a block element, so
// every hand-built Helpr email left-aligned and stretched to the reading-pane
// width there. They also had no preheader (the inbox preview was literally
// "Hey there,"), no `color-scheme` declaration, and three of them no viewport
// meta.
//
// None of that is worth re-solving by hand: `@react-email/components` was
// already a dependency of these functions. `<Container>` renders as a centred
// `<table>`, `<Preview>` emits a correct hidden preheader block, `<Head>`
// carries the metas, and `renderAsync(..., { plainText: true })` derives the
// text part from the same component instead of a regex over the HTML. So every
// template now builds on `BaseLayout` below.

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import {
  brand,
  container,
  EMAIL_CSS,
  footer as footerStyle,
  logo,
  LOGO_URL,
  main,
} from './styles.ts'
import { POSTAL_ADDRESS } from '../resend.ts'
import { getAppUrl } from '../appUrl.ts'

/**
 * `<head>` for every Helpr email: the viewport meta three templates were
 * missing, the two color-scheme metas that stop a client inventing its own
 * inversion, and the shared reset + dark-mode stylesheet.
 *
 * Dark mode is a `<style>` in `<Head>` because that is react-email's supported
 * mechanism for it — there is no component-level dark variant in email, and
 * `prefers-color-scheme` is the only thing Apple Mail / Outlook.com honour.
 */
export const EmailHead = () => (
  <Head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style dangerouslySetInnerHTML={{ __html: EMAIL_CSS }} />
  </Head>
)

/**
 * The wordmark. The `width` attribute and the CSS width agree here (80px).
 * They used to disagree — `width="80"` against `style="width:150px"` in ten
 * places — so the same logo rendered at two sizes depending on whether the
 * client honoured the attribute (Outlook) or the CSS (most webmail).
 */
export const Wordmark = () => (
  <img src={LOGO_URL} alt="Louisiana Helpr" width="80" height="auto" style={logo} />
)

/**
 * Outlook-only VML rectangle for the CTA.
 *
 * This is the ONE piece of raw markup left in the email layer, and it is here
 * because it cannot be expressed as a React element: a conditional comment is
 * an HTML comment, and the `<!--[if !mso]><!-->` / `<!--<![endif]-->` pair has
 * to WRAP the anchor rather than sit beside it. react-email's `<Button>` does
 * make padding work in Outlook (`mso-padding-alt`) but Word still squares off
 * `border-radius`, so without this the Outlook reader gets a rectangle where
 * everyone else gets Helpr's rounded button.
 */
function msoButtonHtml(href: string, label: string, widthPx: number): string {
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${widthPx}px;" arcsize="26%" strokecolor="${brand.bark}" fillcolor="${brand.bark}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a class="e-cta" href="${href}" style="display:inline-block;background-color:${brand.bark};color:#ffffff;font-size:15px;line-height:20px;border-radius:12px;padding:14px 28px;text-decoration:none;font-weight:600">${label}</a>
<!--<![endif]-->`
}

/** The one CTA button in the product. `label` is plain text, never markup. */
export const BrandButton = ({
  href,
  label,
  widthPx,
}: {
  href: string
  label: string
  widthPx?: number
}) => (
  <div
    style={{ margin: '0 0 4px' }}
    dangerouslySetInnerHTML={{
      __html: msoButtonHtml(href, label, widthPx ?? Math.max(180, label.length * 10 + 60)),
    }}
  />
)

/**
 * Footer for TRANSACTIONAL mail — a password reset, an account decision, a
 * security notice. No unsubscribe (you cannot opt out of these) and no postal
 * address requirement.
 */
export const TransactionalFooter = ({ children }: { children: React.ReactNode }) => (
  <Text className="e-footer" style={footerStyle}>
    {children}
  </Text>
)

/**
 * Footer for COMMERCIAL mail — the welcome drip, the win-back, an admin
 * campaign. It carries the two things CAN-SPAM asks of that class of message.
 *
 * 1. THE OPT-OUT (§7704(a)(3)-(4)). Pass `unsubscribeUrl` — the recipient's
 *    signed one-click link from `buildUnsubscribeUrl()` in
 *    `_shared/unsubscribe.ts`. One click on it opts that address out of every
 *    commercial send path; see `functions/email-unsubscribe/index.ts` for the
 *    hop-by-hop path.
 *
 *    OMITTING IT IS A DEGRADATION, NOT A DEFAULT. The fallback below is the
 *    logged-in preferences screen, which a signed-out recipient cannot use —
 *    it exists only so a footer still renders something when no signing
 *    secret is configured. Every real sender passes the URL.
 *
 * 2. THE POSTAL ADDRESS (§7704(a)(5)). `POSTAL_ADDRESS` is the single shared
 *    constant in `_shared/resend.ts` and is EMPTY today, so the block below
 *    renders nothing rather than printing a placeholder. Set the address in
 *    that one place and it appears here, in every commercial template, with
 *    no other edit. The full note on what counts as a valid address is at the
 *    top of `_shared/resend.ts`.
 */
export const MarketingFooter = ({
  reasonLine,
  unsubscribeUrl,
}: {
  reasonLine?: string
  /** The recipient's signed one-click URL. See note 1 above — always pass it. */
  unsubscribeUrl?: string
}) => {
  const unsubUrl = unsubscribeUrl ?? `${getAppUrl()}/profile?tab=notifications`
  const reason =
    reasonLine ?? `You're receiving this because you signed up at ${getAppUrl().replace(/^https?:\/\//, '')}.`
  return (
    <Text className="e-footer" style={footerStyle}>
      {reason}
      <br />
      <Link href={unsubUrl} className="e-footer" style={{ color: brand.footerOlive, textDecoration: 'underline' }}>
        Unsubscribe from these emails
      </Link>
      {POSTAL_ADDRESS ? (
        <>
          <br />
          {POSTAL_ADDRESS}
        </>
      ) : null}
    </Text>
  )
}

export interface BaseLayoutProps {
  /**
   * Inbox preview line. `<Preview>` renders the hidden preheader block for us.
   * Without one, clients fall back to the first words of the body — which for
   * most Helpr mail was literally "Hey there,".
   */
  preheader: string
  children: React.ReactNode
  /** Rendered inside the card, after the body. Use MarketingFooter / TransactionalFooter. */
  footer?: React.ReactNode
  /** Rendered after the card — the open-rate beacon, which must not take layout space. */
  trailing?: React.ReactNode
}

/**
 * The Helpr email shell: brand header, 600px centred card, footer.
 *
 * `<Container>` is the important part — react-email renders it as
 * `<table align="center">`, which is the layout Outlook's Word engine can
 * actually centre.
 */
export const BaseLayout = ({ preheader, children, footer, trailing }: BaseLayoutProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>{preheader}</Preview>
    <Body className="e-bg" style={main}>
      <Container className="e-card" style={container}>
        <Wordmark />
        {children}
        {footer}
      </Container>
      {trailing}
    </Body>
  </Html>
)
