/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  codeStyle,
} from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <BaseLayout preheader="Your Helpr verification code">
      <Heading className="e-h1" style={h1}>Verify Your Identity</Heading>
      <Text className="e-text" style={text}>Use the code below to confirm your identity:</Text>
      <Text className="e-h1" style={codeStyle}>{token}</Text>
      <TransactionalFooter>
        This code will expire shortly. If you didn't request this, you can safely ignore this email.
      </TransactionalFooter>
  </BaseLayout>
)

export default ReauthenticationEmail
