/// <reference types="npm:@types/react@18.3.1" />

// The three account-decision emails: approved, identity-verified, denied.
//
// These were hand-built HTML strings inside send-account-status-email/index.ts,
// wrapped in a `<div style="max-width:480px;margin:0 auto">` shell. Outlook
// renders with the WORD engine, which does not implement `margin:0 auto` on a
// block element, so the single most consequential email in the product — "your
// account is approved" — left-aligned and stretched to the reading-pane width
// there. `<Container>` renders as a centred `<table>` instead, which Word can
// actually centre.
//
// Each one also carried a hand-maintained plaintext twin that had already
// drifted from the HTML (the denial text promised a support team the HTML
// note phrased differently, and the verified text said "Welcome to the Helpr
// community!" where the HTML said something else). Both parts now come from
// this one component via `renderEmail`.
//
// Every interpolated value is escaped by React itself. In particular the
// denial `reason` is admin-supplied free text that lands in a stranger's mail
// client: it used to be interpolated raw, so a single stray tag (or a
// deliberate one) rendered as markup inside a Helpr-branded notice. As a JSX
// child it is escaped by construction — no htmlEscape() call to forget.

import * as React from 'npm:react@18.3.1'
import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, subtext, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton } from './components.tsx'

export type AccountStatus = 'approved' | 'verified' | 'denied'

export interface AccountStatusEmailProps {
  status: AccountStatus
  /** Already run through the greeting allow-list — "there" when unusable. */
  greetingName: string
  /** Absolute, click-tracked destination for the CTA. */
  ctaUrl: string
  /** Open-rate beacon URL. Rendered outside the card so it cannot take layout space. */
  pixelUrl: string
  /** Admin-supplied denial reason. Escaped by React; only shown for `denied`. */
  reason?: string
}

/** Per-status copy. One table so the three notices can never drift apart. */
const COPY = {
  approved: {
    preheader: 'Your Helpr account is approved — you can log in now.',
    heading: "You're approved.",
    cta: 'Log In Now',
    ctaWidthPx: 200,
    note:
      "Welcome to the Helpr community! If you have any questions, don't hesitate to reach out to our support team.",
  },
  verified: {
    preheader: 'Your identity check passed. Your Helpr account is ready.',
    heading: 'Verification successful',
    cta: 'Go to Dashboard',
    ctaWidthPx: 200,
    note: "Welcome in. You're set to post jobs and help neighbors across Louisiana.",
  },
  denied: {
    preheader: 'An update on your Helpr account application.',
    heading: 'An update on your account',
    cta: 'Update My Profile',
    ctaWidthPx: 220,
    note: 'If you believe this was a mistake, please contact our support team.',
  },
} as const

/** The warm-accent emphasis word ("approved" / "verified"). */
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
  reason,
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

      {status === 'approved' && (
        <Text className="e-text" style={textStyle}>
          Great news — your account has been reviewed and <Accent>approved</Accent>! You now have
          full access to the Helpr platform.
        </Text>
      )}

      {status === 'verified' && (
        <Text className="e-text" style={textStyle}>
          Your identity has been <Accent>verified</Accent> and your Helpr account is fully approved.
          You're cleared to post jobs and start helping your neighbors across Louisiana.
        </Text>
      )}

      {status === 'denied' && (
        <>
          <Text className="e-text" style={textStyle}>
            We've reviewed your account application and unfortunately we're{' '}
            <strong>unable to approve it</strong> at this time.
          </Text>
          {reason ? (
            <Text className="e-text" style={textStyle}>
              <strong>Reason:</strong> {reason}
            </Text>
          ) : null}
          <Text className="e-text" style={textStyle}>
            You can update your profile and resubmit for review:
          </Text>
        </>
      )}

      <BrandButton href={ctaUrl} label={copy.cta} widthPx={copy.ctaWidthPx} />

      <Text className="e-text e-rule" style={subtext}>
        {copy.note}
      </Text>
    </BaseLayout>
  )
}

export default AccountStatusEmail
