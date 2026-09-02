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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <BaseLayout preheader="Your Helpr login link">
      <Heading className="e-h1" style={h1}>Your Login Link</Heading>
      <Text className="e-text" style={text}>
        Click the button below to log in to Helpr. This link will expire shortly.
      </Text>
      <BrandButton href={confirmationUrl} label="Log In to Helpr" />
      <TransactionalFooter>
        If you didn't request this link, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default MagicLinkEmail
