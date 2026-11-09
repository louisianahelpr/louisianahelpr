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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <BaseLayout preheader="Reset your Louisiana Helpr password">
      {/* Owner's message review 11-09: F159 sentence case, F162 "Tap" like every other email. */}
      <Heading className="e-h1" style={h1}>Reset your password</Heading>
      <Text className="e-text" style={text}>
        We got a request to reset your password. Tap the button below to choose a new password.
      </Text>
      <BrandButton href={confirmationUrl} label="Choose a new password" />
      <TransactionalFooter>
        If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.
      </TransactionalFooter>
  </BaseLayout>
)

export default RecoveryEmail
