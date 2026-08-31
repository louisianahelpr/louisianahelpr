/// <reference types="npm:@types/react@18.3.1" />

// "<donor> sent you a $X Helpr credit" — the directed Pay-It-Forward gift.
//
// Was a hand-built HTML string in `_shared/pifGiftEmail.ts`, wrapped in
// `<div style="max-width:480px;margin:0 auto">`. Outlook 2007–2021 renders HTML
// with the WORD engine, which does not implement `margin:0 auto` on a block
// element, so this email left-aligned and stretched to the reading-pane width
// there. `BaseLayout`'s `<Container>` is a centred `<table>` — the layout Word
// can actually centre — and it owns the wordmark, so the old hand-rolled <img>
// with `width="80"` fighting `style="width:150px"` (two sizes depending on the
// client) is gone.
//
// The donor name and the gift note are attacker-influenced free text. React
// escapes both as JSX children, replacing the hand-applied htmlEscape() calls
// the string version needed. The SUBJECT is a different problem — a header, not
// a body — and is still sanitized with sanitizeHeaderValue() by the caller.

import * as React from 'npm:react@18.3.1'
import { Heading, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

export interface PifGiftEmailProps {
  /** Donor display name, already run through sanitizeHeaderValue by the caller. */
  donorName: string
  /** Pre-formatted, e.g. "$25". */
  amount: string
  /** Absolute claim link carrying the opaque token (no email in the query string). */
  claimUrl: string
  /** Optional note the donor wrote. */
  note?: string | null
}

const noteBox = {
  margin: '0 0 24px',
  padding: '14px 16px',
  background: 'rgba(94,101,68,0.08)',
  borderRadius: '10px',
}

const noteText = {
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0',
  color: brand.olivewood,
  fontStyle: 'italic' as const,
}

export const PifGiftEmail = ({ donorName, amount, claimUrl, note }: PifGiftEmailProps) => (
  <BaseLayout
    preheader={`${donorName} sent you a ${amount} credit to spend on Helpr.`}
    footer={
      <TransactionalFooter>
        New to Helpr? The link will help you create an account and add the credit automatically. If
        you didn't expect this, you can ignore it.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={h1}>
      {donorName} sent you a {amount} Helpr credit
    </Heading>
    <Text className="e-text" style={textStyle}>
      Someone wants to help you get something done. Your{' '}
      <strong style={{ color: brand.olivewood }}>{amount} credit</strong> can go toward any job on
      Helpr — cleaning, yard work, handyman help, groceries, and more.
    </Text>
    {note ? (
      // Translucent olive wash, so unlike the admin-action callouts this one
      // reads correctly over the dark card too — hence it KEEPS `e-text` and
      // lets the dark-mode block recolour the quote.
      <Section style={noteBox}>
        <Text className="e-text" style={noteText}>
          “{note}”
        </Text>
      </Section>
    ) : null}
    <BrandButton href={claimUrl} label={`Claim your ${amount} credit`} widthPx={250} />
  </BaseLayout>
)

export default PifGiftEmail
