/// <reference types="npm:@types/react@18.3.1" />

// The highest-volume email in the product: one notification row → one email.
//
// Was a hand-built HTML string in send-notification-email/index.ts, wrapped in
// `<div style="max-width:480px;margin:0 auto">` (which Outlook's Word engine
// cannot centre), with no preheader — so every Helpr notification previewed in
// the inbox as "Hey there," — and a footer that said "Manage your preferences
// in your profile settings" with NO link, while the plaintext part right below
// it carried one.
//
// Every interpolated value is now escaped by React itself. The old string
// version had to call htmlEscape() on each one by hand, which is a rule
// someone eventually forgets.

import * as React from 'npm:react@18.3.1'
import { Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter, TransactionalFooter } from './components.tsx'

export interface NotificationEmailProps {
  title: string
  message: string
  /** Absolute, already-sanitized destination for the CTA. */
  actionUrl: string
  userName: string
  /** Deep link to the notification preferences tab. */
  prefsUrl: string
  /** Bare host, e.g. "www.louisianahelpr.com" — used in the footer sentence. */
  host: string
  /**
   * Set ONLY for a `promotion`-type notification — the one `TYPE_MAP` entry in
   * send-notification-email that is commercial rather than transactional.
   *
   * Almost every notification here is transactional (a job update, a payment,
   * a message) and gets the plain preferences footer. But the `promotion` type
   * exists in the map, is gated on `email_promotions`, and would otherwise ship
   * promotional copy through the product's highest-volume email path with a
   * transactional footer, no unsubscribe link and no `List-Unsubscribe` — a
   * commercial send with no opt-out. Nothing in the repo creates one today;
   * this closes the hole before something does.
   *
   * When set, the footer becomes <MarketingFooter> with this signed one-click
   * URL, and the sender additionally sets the List-Unsubscribe headers.
   */
  unsubscribeUrl?: string
}

/** Body sign-off. NOT a sender identity — the From header is FROM_DEFAULT. */
const SIGNOFF = 'The Helpr Team'

export const NotificationEmail = ({
  title,
  message,
  actionUrl,
  userName,
  prefsUrl,
  host,
  unsubscribeUrl,
}: NotificationEmailProps) => (
  <BaseLayout
    preheader={`${title} — open Helpr for the details.`}
    footer={
      unsubscribeUrl ? (
        <MarketingFooter unsubscribeUrl={unsubscribeUrl} />
      ) : (
        <TransactionalFooter>
          You're receiving this because you enabled email notifications on {host}.{' '}
          <Link
            href={prefsUrl}
            className="e-footer"
            style={{ color: brand.footerOlive, textDecoration: 'underline' }}
          >
            Manage your notification preferences
          </Link>
          .
        </TransactionalFooter>
      )
    }
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '20px' }}>
      {title}
    </Heading>
    <Text className="e-text" style={{ ...textStyle, margin: '0 0 8px' }}>
      Hey {userName || 'there'},
    </Text>
    <Text className="e-text" style={textStyle}>
      {message}
    </Text>
    <BrandButton href={actionUrl} label="View Details" widthPx={190} />
    <Text className="e-text" style={{ ...textStyle, fontSize: '14px', margin: '28px 0 4px' }}>
      — {SIGNOFF}
    </Text>
  </BaseLayout>
)

export default NotificationEmail
