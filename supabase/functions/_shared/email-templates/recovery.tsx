/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  main,
  container,
  h1,
  text,
  footer,
} from './styles.ts'
import { BrandButton, EmailHead, Wordmark } from './components.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Reset your Helpr password</Preview>
    <Body className="e-bg" style={main}>
      <Container className="e-card" style={container}>
        <Wordmark />
        <Heading className="e-h1" style={h1}>Reset Your Password</Heading>
        <Text className="e-text" style={text}>
          We received a request to reset your password. Click the button below to choose a new one.
        </Text>
        <BrandButton href={confirmationUrl} label="Reset Password" />
        <Text className="e-footer" style={footer}>
          If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
