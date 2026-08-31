/// <reference types="npm:@types/react@18.3.1" />

// The admin marketing campaign, wrapped in the shared Helpr shell.
//
// Every other template in this folder BUILDS its body out of components. This
// one cannot: the campaign body is raw HTML the admin types into the blast tool
// (`send-marketing-blast`), so there is no structured content to render from —
// only a string. What this component adds is everything AROUND that string,
// which the campaign previously shipped without:
//   • the centred `<Container>` card (the raw HTML went out bare, so Outlook's
//     Word engine had nothing to centre and no width to respect),
//   • a preheader — the inbox preview used to be whatever words happened to
//     start the admin's HTML,
//   • the `color-scheme` metas and the dark-mode stylesheet,
//   • `<MarketingFooter>`, which carries the unsubscribe link, the mailto
//     unsubscribe, and the CAN-SPAM §7704(a)(5) POSTAL_ADDRESS. That footer is
//     now part of the shell rather than a string appended by the caller, so it
//     cannot be forgotten or double-appended.
//
// ─────────────────────────────────────────────────────────────────────────
// THE ONE LEGITIMATE `dangerouslySetInnerHTML` IN THE EMAIL LAYER.
//
// `bodyHtml` is the campaign HTML AUTHORED BY AN ADMIN. `send-marketing-blast`
// requires an Authorization header, resolves the user, and verifies them
// through the `has_role(_user_id, 'admin')` RPC before this component is ever
// constructed — an anonymous or ordinary authenticated caller gets a 401/403
// and never reaches the render. So the author of this markup is someone who
// already has the ability to mail every user on the platform; escaping their
// own HTML would only break the campaign they deliberately wrote.
//
// That reasoning applies HERE AND NOWHERE ELSE. Every other template renders
// untrusted or semi-trusted values (a support message from a logged-out
// stranger, an admin denial reason read by a customer, a notification body) as
// JSX children so React escapes them. Do not copy this pattern into one of
// those; if you find yourself wanting to, the value is not admin-authored.
// ─────────────────────────────────────────────────────────────────────────

import * as React from 'npm:react@18.3.1'
import { BaseLayout, MarketingFooter } from './components.tsx'

export interface MarketingBlastEmailProps {
  /** Inbox preview line — derived from the campaign subject by the caller. */
  preheader: string
  /** Admin-authored campaign HTML, already personalised ({{name}} substituted). */
  bodyHtml: string
}

export const MarketingBlastEmail = ({ preheader, bodyHtml }: MarketingBlastEmailProps) => (
  <BaseLayout preheader={preheader} footer={<MarketingFooter />}>
    {/* Admin-authored HTML — see the block comment at the top of this file. */}
    <div className="e-text" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  </BaseLayout>
)

export default MarketingBlastEmail
