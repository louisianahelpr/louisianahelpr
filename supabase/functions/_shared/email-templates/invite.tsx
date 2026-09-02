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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <BaseLayout preheader="You've been invited to join Helpr">
      <Heading className="e-h1" style={h1}>You've been invited to Helpr.</Heading>
      <Text className="e-text" style={text}>
        A neighbor invited you to join{' '}
        <Link href={siteUrl} className="e-accent" style={linkStyle}>
          <strong>Helpr</strong>
        </Link>
        . Tap below to accept and set up your account.
      </Text>
      <BrandButton href={confirmationUrl} label="Accept Invitation" />
      <TransactionalFooter>
        If you weren't expecting this invitation, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default InviteEmail
