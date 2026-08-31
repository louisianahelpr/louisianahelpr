/// <reference types="npm:@types/react@18.3.1" />

// The four emails an admin account action sends: manual_verify,
// request_id_reupload, reset_password and formal_warning.
//
// Was a local `wrapEmail()` HTML-string builder inside
// admin-user-actions/index.ts, built on `<div style="max-width:480px;margin:0
// auto">`. Outlook 2007–2021 renders HTML with the WORD engine, which does not
// implement `margin:0 auto` on a block element, so every admin email
// left-aligned and stretched to the reading-pane width there. `BaseLayout`'s
// `<Container>` is a centred `<table>`, which Word can actually centre — and it
// carries the viewport meta, the preheader and the dark-mode palette the
// hand-built version was missing, plus one wordmark at one size (the old markup
// had `width="80"` fighting `style="width:150px"`).
//
// Copy is passed in as DATA, not as markup. Every admin-authored value (the
// free-text `note`, the user's name) is escaped by React itself, so the
// hand-applied htmlEscape() calls the string version needed — a rule someone
// eventually forgets — are gone. Nothing here ever reaches
// dangerouslySetInnerHTML.

import * as React from 'npm:react@18.3.1'
import { Heading, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'
import { SUPPORT_EMAIL } from '../resend.ts'

/**
 * One run of copy inside a line: plain text, bold, or bold in the burnt-sienna
 * accent. Emphasis is expressed as data so the call sites never build markup.
 */
export type Run = string | { b: string } | { accent: string }

/** A paragraph: a bare string, or runs when part of it needs emphasis. */
export type Line = string | Run[]

const renderLine = (line: Line): React.ReactNode => {
  if (typeof line === 'string') return line
  return line.map((run, i) => {
    if (typeof run === 'string') return <React.Fragment key={i}>{run}</React.Fragment>
    if ('b' in run) return <strong key={i}>{run.b}</strong>
    return (
      <strong key={i} className="e-accent" style={{ color: brand.burntSienna }}>
        {run.accent}
      </strong>
    )
  })
}

/**
 * A callout box.
 *
 * - `note`  — the amber "admin note" box carrying admin free text.
 * - `alert` — the red final-warning / suspended box.
 * - `plain` — the quiet 14px escalation line (strike 1), no box.
 */
export type CalloutTone = 'note' | 'alert' | 'plain'

export interface AdminActionCallout {
  tone: CalloutTone
  body: Line
}

const calloutBox = {
  margin: '0 0 20px',
  padding: '12px',
  borderRadius: '8px',
}

const calloutInner = {
  fontSize: '14px',
  lineHeight: '1.6',
  margin: '0',
}

const Callout = ({ tone, body }: AdminActionCallout) => {
  if (tone === 'plain') {
    return (
      <Text className="e-text" style={{ ...textStyle, fontSize: '14px' }}>
        {renderLine(body)}
      </Text>
    )
  }
  const boxed =
    tone === 'alert'
      ? {
          ...calloutBox,
          backgroundColor: 'hsl(0,80%,97%)',
          border: '1px solid hsl(0,70%,90%)',
        }
      : {
          ...calloutBox,
          backgroundColor: 'hsl(45,90%,95%)',
          border: '1px solid hsl(45,80%,85%)',
        }
  const inner =
    tone === 'alert'
      ? { ...calloutInner, color: 'hsl(0,70%,45%)' }
      : { ...calloutInner, color: brand.bodyOlive }
  // NO `e-text` class on these two boxes, deliberately. They set an explicit
  // LIGHT background inline, which the dark-mode block cannot override; adding
  // `e-text` would repaint the type light and leave light-on-light — the exact
  // invisibility the dark palette exists to prevent. They stay light in both
  // schemes, which is legible in both.
  return (
    <Section style={boxed}>
      <Text style={inner}>{renderLine(body)}</Text>
    </Section>
  )
}

export interface AdminActionEmailProps {
  /** Inbox preview line. Without one the preview is literally "Hey there,". */
  preheader: string
  title: string
  /** Already defaulted to "there" by the caller. Escaped by React. */
  greetingName: string
  paragraphs: Line[]
  /** Rendered after the paragraphs, before the CTA. */
  callouts?: AdminActionCallout[]
  ctaUrl: string
  ctaLabel: string
}

export const AdminActionEmail = ({
  preheader,
  title,
  greetingName,
  paragraphs,
  callouts,
  ctaUrl,
  ctaLabel,
}: AdminActionEmailProps) => (
  <BaseLayout
    preheader={preheader}
    footer={
      // True as written: every send from admin-user-actions sets
      // `replyTo: SUPPORT_EMAIL`, so a plain reply really does reach support.
      <TransactionalFooter>
        {/* A bare address, not a mailto anchor: react-email's plaintext
            renderer prints an anchor as "text href", so a mailto link whose
            text IS the address arrives as "admin@x admin@x". Clients auto-link
            bare addresses, so nothing is lost. */}
        Questions? Just reply to this email — it reaches our support team at{' '}
        {SUPPORT_EMAIL}.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={h1}>
      {title}
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName},
    </Text>
    {paragraphs.map((p, i) => (
      <Text key={i} className="e-text" style={textStyle}>
        {renderLine(p)}
      </Text>
    ))}
    {(callouts ?? []).map((c, i) => (
      <Callout key={i} tone={c.tone} body={c.body} />
    ))}
    {/* widthPx 240 matches the width the hand-rolled emailButton() used for all
        four of these, so the Outlook-only VML rectangle does not change size. */}
    <BrandButton href={ctaUrl} label={ctaLabel} widthPx={240} />
  </BaseLayout>
)

export default AdminActionEmail
