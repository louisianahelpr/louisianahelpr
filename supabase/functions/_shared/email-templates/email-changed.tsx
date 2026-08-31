/// <reference types="npm:@types/react@18.3.1" />

// The two "your login email is changing" security notices, both sent to the
// OLD address — the only warning an account owner gets that their login
// identity moved.
//
//  * AdminEmailChangedEmail    — admin-update-email (an administrator did it)
//  * SelfEmailChangeNoticeEmail — notify-email-change (a session did it)
//
// Both were hand-built HTML strings inside their edge functions, wrapped in a
// `<div style="max-width:480px;margin:0 auto">` that Outlook's Word engine
// cannot centre, so a security notice arrived left-aligned and stretched to
// the reading-pane width. `<Container>` renders as a centred `<table>`, which
// Word does honour.
//
// The addresses used to be run through htmlEscape() by hand before being
// interpolated into the string. As JSX children React escapes them for us, so
// the rule cannot be forgotten. NOTE this is a defence-in-depth layer only:
// notify-email-change still validates `newEmail` against an address shape
// BEFORE it reaches this template, because escaping alone would let an
// attacker post arbitrary prose into a Helpr-branded security notice.

import * as React from 'npm:react@18.3.1'
import { Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { h1, text as textStyle } from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'
import { SUPPORT_EMAIL } from '../resend.ts'

export interface EmailChangedProps {
  /** The address being notified — the current/previous login email. */
  oldEmail: string
  /** The address the account is moving to. */
  newEmail: string
}

/**
 * A bare email address, NOT an `<a href="mailto:…">`.
 *
 * react-email's plaintext renderer prints an anchor as "text href", so
 * `<Link href="mailto:admin@x">admin@x</Link>` arrives in the text/plain part
 * as "admin@x admin@x" — which reads as a bug in the one email whose whole job
 * is to be trusted. Every mail client that matters auto-links a bare address,
 * so nothing is lost by printing it plainly and the text twin reads correctly.
 * (A `<Link>` to a real URL is fine — there the printed href is useful.)
 */
const SupportAddress = () => <>{SUPPORT_EMAIL}</>

const HEADING = 'Your email address was changed'

/** An ADMIN changed the login email out from under the account owner. */
export const AdminEmailChangedEmail = ({ oldEmail, newEmail }: EmailChangedProps) => (
  <BaseLayout
    preheader="An administrator changed the login email on your Helpr account."
    footer={
      <TransactionalFooter>
        Questions? Just reply to this email — it reaches our support team at <SupportAddress />.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={h1}>
      {HEADING}
    </Heading>
    <Text className="e-text" style={textStyle}>
      An administrator updated the email address on your Helpr account from{' '}
      <strong>{oldEmail}</strong> to <strong>{newEmail}</strong>.
    </Text>
    <Text className="e-text" style={textStyle}>
      Use <strong>{newEmail}</strong> to log in going forward. If you did not authorise this change,
      contact us immediately at <SupportAddress />.
    </Text>
  </BaseLayout>
)

/** Someone with a session started a self-service email change. */
export const SelfEmailChangeNoticeEmail = ({ oldEmail, newEmail }: EmailChangedProps) => (
  <BaseLayout
    preheader="Your Helpr login email is being changed — confirm it was you."
    footer={
      <TransactionalFooter>
        Questions? Contact us at <SupportAddress />.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={h1}>
      {HEADING}
    </Heading>
    <Text className="e-text" style={textStyle}>
      Someone signed in to your Helpr account and started changing your login email from{' '}
      <strong>{oldEmail}</strong> to <strong>{newEmail}</strong>. To finalize the change, the new
      address will need to confirm the request.
    </Text>
    <Text className="e-text" style={textStyle}>
      <strong>Was this you?</strong> No action needed — the confirmation link was sent to your new
      address.
    </Text>
    <Text className="e-text" style={textStyle}>
      <strong>Was this NOT you?</strong> Reset your password immediately and contact us at{' '}
      <SupportAddress />.
    </Text>
  </BaseLayout>
)
