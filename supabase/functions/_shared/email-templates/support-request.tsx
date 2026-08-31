/// <reference types="npm:@types/react@18.3.1" />

// The internal contact-form relay: one public support submission → one email
// in the support inbox. Sent by `contact-support/index.ts`, the only backend
// path a LOGGED-OUT visitor has to reach a human at Helpr.
//
// Was a hand-built HTML string inside that function. Two things were wrong with
// it and are fixed by building on `BaseLayout`:
//   • The body was `<div style="max-width:560px;margin:0 auto">`. Outlook
//     renders HTML with the WORD engine, which does not implement
//     `margin:0 auto` on a block element, so the support inbox got the ticket
//     left-aligned and stretched to the full reading-pane width. `<Container>`
//     inside `BaseLayout` renders as a centred `<table>`, which Word can
//     actually centre.
//   • The hand-rolled wordmark `<img>` had `width="80"` fighting
//     `style="width:150px"`, so it rendered at two different sizes depending on
//     whether the client honoured the attribute or the CSS. `BaseLayout` owns
//     the wordmark now and the two agree.
//
// The `e-text` / `e-footer` / `e-h1` class names are what the shared dark-mode
// stylesheet in `styles.ts` keys off; without them a forced-inversion client
// leaves dark text on a dark card. Keep them on every node below.
//
// ESCAPING: this body is assembled from untrusted, UNAUTHENTICATED input. The
// string version had to call `htmlEscape()` on each interpolated value by hand
// — a rule someone eventually forgets. Every value here is a JSX child, so
// React escapes it by construction. Do NOT reintroduce `dangerouslySetInnerHTML`
// in this file for any reason.

import * as React from 'npm:react@18.3.1'
import { Column, Heading, Hr, Row, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'

export interface SupportRequestEmailProps {
  /** Human label for the chosen topic, resolved from the allow-list. */
  topicLabel: string
  /** Sender's name — from their profile when signed in, else what they typed. */
  name: string
  /** Sender's email. Also becomes the Reply-To on the envelope. */
  email: string
  /** Subject line as typed; may be empty. */
  subject: string
  /** The message body. Line breaks are preserved — see below. */
  message: string
  /** "Signed in (user …)" / "Not signed in (guest)". */
  accountLine: string
}

/** Label column of the details grid. ~88px is the widest label ("Account"). */
const labelCell = {
  padding: '4px 0',
  width: '88px',
  fontSize: '14px',
  color: brand.footerOlive,
  verticalAlign: 'top' as const,
}

const valueCell = {
  padding: '4px 0',
  fontSize: '14px',
  color: brand.olivewood,
  verticalAlign: 'top' as const,
}

/**
 * One label/value line of the details grid.
 *
 * This was a `<table role="presentation">` — a real label/value grid and the
 * one shape every mail client agrees on. react-email's `<Row>`/`<Column>`
 * render exactly that (`<table><tr><td>`), so the client-compatible markup is
 * unchanged; it is just no longer a hand-concatenated string.
 */
const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Row>
    <Column className="e-footer" style={labelCell}>
      {/* Trailing colon+space: in the HTML the two cells are visually separated
          by the column gap, but react-email's plaintext renderer concatenates
          adjacent cells, which read as "FromAda Lovelace". */}
      {label}:{' '}
    </Column>
    <Column className="e-text" style={valueCell}>
      {children}
    </Column>
  </Row>
)

export const SupportRequestEmail = ({
  topicLabel,
  name,
  email,
  subject,
  message,
  accountLine,
}: SupportRequestEmailProps) => (
  <BaseLayout
    // Without a preheader the inbox list preview is the first words of the
    // body — here, "Submitted from the public contact form." for every single
    // ticket, which makes the queue unskimmable.
    preheader={`New ${topicLabel} from ${name}`}
    footer={
      <TransactionalFooter>
        Reply directly to <strong>{email}</strong> to answer this person.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '20px' }}>
      [{topicLabel}] {subject || 'No subject'}
    </Heading>
    <Text className="e-text" style={{ ...textStyle, fontSize: '13px', margin: '0 0 20px' }}>
      Submitted from the public contact form.
    </Text>

    <Section style={{ width: '100%', margin: '0 0 20px' }}>
      <Detail label="From">
        <strong>{name}</strong>
      </Detail>
      <Detail label="Email">{email}</Detail>
      <Detail label="Topic">{topicLabel}</Detail>
      <Detail label="Account">{accountLine}</Detail>
    </Section>

    <Hr className="e-rule" style={{ borderColor: brand.hairline, margin: '0 0 20px' }} />

    {/*
      The writer's line breaks are load-bearing — a support message with
      paragraphs is normal. The string version did
      `htmlEscape(message).replace(/\n/g, '<br />')`; that is exactly the
      pattern this rewrite exists to remove.

      One <Text> per line.
      `white-space: pre-wrap` alone is not enough: it holds the line breaks in
      the HTML part, but react-email's plaintext renderer collapses whitespace
      runs, so the text/plain twin arrived as a single run-on paragraph.
      Splitting here keeps the breaks in BOTH parts, and each line is still a
      plain JSX child — React escapes it, so no markup can come through.
    */}
    {message.split('\n').map((line, i) => (
      <Text
        key={i}
        className="e-text"
        style={{ ...textStyle, color: brand.olivewood, whiteSpace: 'pre-wrap', margin: '0' }}
      >
        {line || '\u00A0'}
      </Text>
    ))}
  </BaseLayout>
)

export default SupportRequestEmail
