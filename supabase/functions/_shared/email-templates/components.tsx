/// <reference types="npm:@types/react@18.3.1" />

// Shared pieces for the six react-email auth templates.
//
// They existed only as copy-pasted fragments before: every template hand-wrote
// its own `<Head />`, its own `<Img>` wordmark, and its own `<Button>`. That is
// how the `width="80"` vs `style="width:150px"` contradiction survived in ten
// places, and how all six shipped with no dark-mode handling and no Outlook
// fallback for the rounded CTA.

import * as React from 'npm:react@18.3.1'
import { Head } from 'npm:@react-email/components@0.0.22'
import { EMAIL_CSS, logo } from './styles.ts'
import { emailButton, LOGO_URL } from '../emailLayout.ts'

/**
 * `<head>` for every auth email: the viewport meta, the two color-scheme metas
 * that stop a client inventing its own inversion, and the shared reset +
 * dark-mode stylesheet.
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
 * The wordmark. The `width` attribute and the CSS width agree here (80px) —
 * Outlook ignores CSS width on images and other clients prefer it, so a
 * disagreement means the same logo renders at two sizes depending on client.
 */
export const Wordmark = () => (
  <img
    src={LOGO_URL}
    alt="Louisiana Helpr"
    width="80"
    height="auto"
    style={logo}
  />
)

/**
 * The CTA, rendered from the SAME builder the raw-HTML templates use
 * (`_shared/emailLayout.ts`), so both halves of the product get the identical
 * `<!--[if mso]>` VML fallback. Outlook's Word engine ignores `border-radius`
 * and `padding` on an inline anchor, so without the VML an Outlook reader sees
 * a bare text link where everyone else sees a button.
 *
 * Injected as raw HTML because a conditional comment cannot be expressed as a
 * React element — the `<!--[if !mso]><!-->` / `<!--<![endif]-->` pair has to
 * wrap the anchor, not sit beside it.
 */
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
    dangerouslySetInnerHTML={{
      __html: emailButton(href, label, widthPx ?? Math.max(180, label.length * 10 + 60)),
    }}
  />
)
