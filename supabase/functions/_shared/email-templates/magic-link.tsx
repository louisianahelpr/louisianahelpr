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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Your Helpr login link</Preview>
    <Body className="e-bg" style={main}>
      <Container className="e-card" style={container}>
        <Wordmark />
        <Heading className="e-h1" style={h1}>Your Login Link</Heading>
        <Text className="e-text" style={text}>
          Click the button below to log in to Helpr. This link will expire shortly.
        </Text>
        <BrandButton href={confirmationUrl} label="Log In to Helpr" />
        <Text className="e-footer" style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
