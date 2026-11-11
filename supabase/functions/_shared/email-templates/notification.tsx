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
import { NOTICE_SIGNOFF, keepNumberUnitsTogether } from './notificationAction.ts'
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
  /** The button's words, naming where it goes (notificationActionLabel). */
  actionLabel?: string
  /**
   * A receipt's breakdown under the message (F179, owner's message review 11-09: a Declutter receipt showed one total
   * and no item, fee, delivery or pickup). Display only: each line is a figure the order already recorded.
   */
  receipt?: EmailReceipt
  /**
   * The recipient's language (profiles.language; F260q, owner 11-11 "Spanish everything"). 'es' writes the email's
   * own words (preheader, greeting, footer) in Spanish; the sender passes the title and message already re-written.
   */
  lang?: 'en' | 'es'
}

/** The email's own words, per language. Brand names stay as they are. */
export const NOTICE_EMAIL_WORDS = {
  en: {
    preheader: 'open Louisiana Helpr for the details.',
    hey: 'Hey',
    there: 'there',
    why: "You're getting this because email alerts are on for this kind of notice.",
    change: 'Change which emails you get',
    open: 'Open Louisiana Helpr',
  },
  es: {
    preheader: 'abra Louisiana Helpr para ver los detalles.',
    hey: 'Hola',
    there: '',
    why: 'Recibe esto porque las alertas por correo están activadas para este tipo de aviso.',
    change: 'Cambiar qué correos recibe',
    open: 'Abrir Louisiana Helpr',
  },
} as const

/** A receipt's lines ([label, amount]), its total line, and an optional note under it (the pickup time). */
export interface EmailReceipt {
  lines: Array<[string, string]>
  total: [string, string]
  note?: string
}

const receiptCell = { padding: '4px 0', fontSize: '15px', color: brand.bodyOlive, lineHeight: '1.5' }

/**
 * One receipt line: label left, amount right. Each line is its own one-row table, so the plain-text part (react-email's
 * html-to-text, which runs a row's cells together) puts every line on its own line; the hidden ": " gives
 * "Service fee: $1.30" there and is never seen in the HTML.
 */
const ReceiptRow = ({ label, amount, total = false }: { label: string; amount: string; total?: boolean }) => {
  const cell = total ? { ...receiptCell, borderTop: `1px solid ${brand.hairline}`, paddingTop: '8px' } : receiptCell
  const words = (t: string) => (total ? <strong style={{ color: brand.inkDeep }}>{t}</strong> : t)
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td className={total ? 'e-text e-rule' : 'e-text'} style={cell}>
            {words(label)}
            <span style={{ display: 'none', fontSize: 0, lineHeight: 0, maxHeight: 0, overflow: 'hidden' }}>: </span>
          </td>
          <td className={total ? 'e-text e-rule' : 'e-text'} style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: '12px' }}>
            {words(amount)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/** The breakdown: its lines, a hairline, the total, then the note (the pickup time). */
const ReceiptBlock = ({ receipt }: { receipt: EmailReceipt }) => (
  <>
    <div style={{ margin: '0 0 12px' }}>
      {receipt.lines.map(([label, amount]) => (
        <ReceiptRow key={label} label={label} amount={amount} />
      ))}
      <ReceiptRow label={receipt.total[0]} amount={receipt.total[1]} total />
    </div>
    {receipt.note ? (
      <Text className="e-text" style={textStyle}>
        {receipt.note}
      </Text>
    ) : null}
  </>
)

/** Body sign-off. NOT a sender identity — the From header is FROM_DEFAULT. */
const SIGNOFF = NOTICE_SIGNOFF

export const NotificationEmail = ({
  title,
  message,
  actionUrl,
  userName,
  prefsUrl,
  host,
  unsubscribeUrl,
  actionLabel,
  receipt,
  lang = 'en',
}: NotificationEmailProps) => {
  const w = NOTICE_EMAIL_WORDS[lang]
  const name = userName || w.there
  return (
  <BaseLayout
    preheader={`${title} — ${w.preheader}`}
    footer={
      unsubscribeUrl ? (
        <MarketingFooter unsubscribeUrl={unsubscribeUrl} />
      ) : (
        <TransactionalFooter>
          {/* F173 (owner's message review 11-09): email alerts are ON by default, so "because you enabled" was untrue
              for most members. `host` stays in the props for callers; the sentence no longer needs it. */}
          {w.why}{' '}
          <Link
            href={prefsUrl}
            className="e-footer"
            style={{ color: brand.footerOlive, textDecoration: 'underline' }}
          >
            {w.change}
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
      {name ? `${w.hey} ${name},` : `${w.hey},`}
    </Text>
    <Text className="e-text" style={textStyle}>
      {keepNumberUnitsTogether(message)}
    </Text>
    {receipt ? <ReceiptBlock receipt={receipt} /> : null}
    <BrandButton href={actionUrl} label={actionLabel ?? w.open} widthPx={230} />
    <Text className="e-text" style={{ ...textStyle, fontSize: '14px', margin: '28px 0 4px' }}>
      — {SIGNOFF}
    </Text>
  </BaseLayout>
  )
}

export default NotificationEmail
