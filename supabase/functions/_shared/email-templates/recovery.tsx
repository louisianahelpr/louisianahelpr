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
  <BaseLayout preheader="Reset your Helpr password">
      <Heading className="e-h1" style={h1}>Reset Your Password</Heading>
      <Text className="e-text" style={text}>
        We received a request to reset your password. Click the button below to choose a new one.
      </Text>
      <BrandButton href={confirmationUrl} label="Reset Password" />
      <TransactionalFooter>
        If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.
      </TransactionalFooter>
  </BaseLayout>
)

export default RecoveryEmail
