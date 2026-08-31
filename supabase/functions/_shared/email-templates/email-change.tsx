/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  main,
  container,
  h1,
  text,
  linkStyle,
  footer,
} from './styles.ts'
import { BrandButton, EmailHead, Wordmark } from './components.tsx'

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
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Confirm Your Email Change on Helpr</Preview>
    <Body className="e-bg" style={main}>
      <Container className="e-card" style={container}>
        <Wordmark />
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
        <Text className="e-footer" style={footer}>
          If you didn't request this change, please secure your account immediately.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
