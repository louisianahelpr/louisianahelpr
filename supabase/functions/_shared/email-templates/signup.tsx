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
      <Text className="e-text e-rule" style={subtext}>
        Once verified, our team will review your profile and ID. This usually takes 24–48 hours. We'll email you when you're approved!
      </Text>
      <TransactionalFooter>
        If you didn't create an account on Helpr, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default SignupEmail
