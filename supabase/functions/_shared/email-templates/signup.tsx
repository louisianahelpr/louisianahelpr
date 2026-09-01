/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
  Link,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  subtext,
  linkStyle,
} from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <BaseLayout preheader="Verify your email to get started on Helpr">
      <Heading className="e-h1" style={h1}>Confirm Your Email to Get Started.</Heading>
      <Text className="e-text" style={text}>
        Tap the button below to verify your email so we can finish setting up your{' '}
        <Link href={siteUrl} className="e-accent" style={linkStyle}>
          <strong>Helpr</strong>
        </Link>{' '}
        account.
      </Text>
      <Text className="e-text" style={text}>
        Please verify your email (
        <Link href={`mailto:${recipient}`} className="e-accent" style={linkStyle}>
          {recipient}
        </Link>
        ) to continue setting up your account:
      </Text>
      <BrandButton href={confirmationUrl} label="Verify My Email" />
      {/* This line used to read: "Once verified, our team will review your
          profile and ID. This usually takes 24–48 hours. We'll email you when
          you're approved!"
          Every clause of it was false, and had been since manual review was
          removed:
            • `complete-signup/index.ts` sets `approval_status: "approved"`
              unconditionally, with its own comment saying "Auto-approve —
              there's no manual admin review step anymore".
            • There is therefore no 24–48 hour window. Prod, 2026-08-31: 30 of
              30 profiles are `approved`, 0 pending, 0 denied — nobody has ever
              sat in a review queue.
            • No approval email is sent on this path at all;
              `send-account-status-email` fires only on an explicit admin action
              or the IDV webhook.
            • Signup collects no ID document on this path, so "review your
              profile and ID" named an artefact that does not exist yet.
          It also contradicted the in-app screen, which promises "under 2 hours"
          — two different invented numbers for the same non-existent step. The
          copy now describes what the code actually does. */}
      <Text className="e-text e-rule" style={subtext}>
        Verifying takes a moment and you're in — no waiting on approval. Identity
        checks and payout setup come later, only when you first post or accept a
        job.
      </Text>
      <TransactionalFooter>
        If you didn't create an account on Helpr, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default SignupEmail
