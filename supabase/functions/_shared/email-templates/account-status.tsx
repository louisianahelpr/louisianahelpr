/// <reference types="npm:@types/react@18.3.1" />

// The account-status email: identity verified.
//
// It used to carry three notices — approved, identity-verified, denied. The
// approved and denied ones were sent only by the admin Approve / Deny actions,
// which were removed with the approval states themselves (Q193, owner
// 2026-09-23: every signup is auto-approved and bans are automated). The
// verified notice is still sent by stripe-idv-webhook.
//
// These were hand-built HTML strings inside send-account-status-email/index.ts,
// wrapped in a `<div style="max-width:480px;margin:0 auto">` shell. Outlook
// renders with the WORD engine, which does not implement `margin:0 auto` on a
// block element, so the email left-aligned and stretched to the reading-pane
// width there. `<Container>` renders as a centred `<table>` instead, which
// Word can actually centre. HTML and plaintext both come from this one
// component via `renderEmail`, so they cannot drift.

import * as React from 'npm:react@18.3.1'
import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

type AccountStatus = 'verified'

export interface AccountStatusEmailProps {
  status: AccountStatus
  /** Already run through the greeting allow-list — "there" when unusable. */
  greetingName: string
  /** Absolute, click-tracked destination for the CTA. */
  ctaUrl: string
  /** Open-rate beacon URL. Rendered outside the card so it cannot take layout space. */
  pixelUrl: string
}

const COPY = {
  verified: {
    // F166 (owner's message review 11-09): no "fully approved" (sign-up says no approval wait), Declutter named,
    // the button names the app, and no closing line repeating the paragraph.
    preheader: 'Your ID check is done. Your Louisiana Helpr account is ready.',
    heading: 'Your ID check is done',
    cta: 'Open Louisiana Helpr',
    ctaWidthPx: 240,
  },
} as const

/** The warm-accent emphasis word ("verified"). */
const Accent = ({ children }: { children: React.ReactNode }) => (
  <strong className="e-accent" style={{ color: brand.burntSienna }}>
    {children}
  </strong>
)

export const AccountStatusEmail = ({
  status,
  greetingName,
  ctaUrl,
  pixelUrl,
}: AccountStatusEmailProps) => {
  const copy = COPY[status]

  return (
    <BaseLayout
      preheader={copy.preheader}
      trailing={<img src={pixelUrl} width="1" height="1" style={{ display: 'none' }} alt="" />}
      /* The one branded email that had no footer, so no postal address either (UI audit 11-09, F167). */
      footer={<TransactionalFooter>Questions? Reply to this email and a real person on our team will answer.</TransactionalFooter>}
    >
      <Heading className="e-h1" style={h1}>
        {copy.heading}
      </Heading>
      <Text className="e-text" style={textStyle}>
        Hey {greetingName},
      </Text>

      <Text className="e-text" style={textStyle}>
        Your ID check is <Accent>done</Accent>, so you&apos;re all set to post jobs, take jobs, and buy and sell on
        Declutter.
      </Text>

      <BrandButton href={ctaUrl} label={copy.cta} widthPx={copy.ctaWidthPx} />
    </BaseLayout>
  )
}

export default AccountStatusEmail
