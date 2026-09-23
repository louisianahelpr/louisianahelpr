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
import { brand, h1, subtext, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton } from './components.tsx'

export type AccountStatus = 'verified'

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
    preheader: 'Your identity check passed. Your Helpr account is ready.',
    heading: 'Verification successful',
    cta: 'Go to Dashboard',
    ctaWidthPx: 200,
    note: "Welcome in. You're set to post jobs and help neighbors across Louisiana.",
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
    >
      <Heading className="e-h1" style={h1}>
        {copy.heading}
      </Heading>
      <Text className="e-text" style={textStyle}>
        Hey {greetingName},
      </Text>

      <Text className="e-text" style={textStyle}>
        Your identity has been <Accent>verified</Accent> and your Helpr account is fully approved.
        You're cleared to post jobs and start helping your neighbors across Louisiana.
      </Text>

      <BrandButton href={ctaUrl} label={copy.cta} widthPx={copy.ctaWidthPx} />

      <Text className="e-text e-rule" style={subtext}>
        {copy.note}
      </Text>
    </BaseLayout>
  )
}

export default AccountStatusEmail
