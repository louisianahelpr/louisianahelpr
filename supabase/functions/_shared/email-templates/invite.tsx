/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
} from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  confirmationUrl,
}: InviteEmailProps) => (
  <BaseLayout preheader="You've been invited to join Louisiana Helpr">
      {/* Owner's message review 11-09: F159 sentence case, F160 plain text (no stray link), F188 the full name. */}
      <Heading className="e-h1" style={h1}>You've been invited to Louisiana Helpr</Heading>
      <Text className="e-text" style={text}>
        A neighbor invited you to join Louisiana Helpr. Tap below to accept and set up your account.
      </Text>
      <BrandButton href={confirmationUrl} label="Accept the invite" />
      <TransactionalFooter>
        If you weren't expecting this invitation, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default InviteEmail
