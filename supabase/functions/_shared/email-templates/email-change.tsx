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
  linkStyle,
} from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <BaseLayout preheader="Confirm Your Email Change on Helpr">
      <Heading className="e-h1" style={h1}>Confirm Your Email Change</Heading>
      <Text className="e-text" style={text}>
        You requested to change your email from{' '}
        <Link href={`mailto:${email}`} className="e-accent" style={linkStyle}>
          {email}
        </Link>{' '}
        to{' '}
        <Link href={`mailto:${newEmail}`} className="e-accent" style={linkStyle}>
          {newEmail}
        </Link>
        .
      </Text>
      <BrandButton href={confirmationUrl} label="Confirm Email Change" />
      <TransactionalFooter>
        If you didn't request this change, please secure your account immediately.
      </TransactionalFooter>
  </BaseLayout>
)

export default EmailChangeEmail
