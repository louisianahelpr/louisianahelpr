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
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>You've been invited to join Helpr</Preview>
    <Body className="e-bg" style={main}>
      <Container className="e-card" style={container}>
        <Wordmark />
        <Heading className="e-h1" style={h1}>You've been invited to Helpr.</Heading>
        <Text className="e-text" style={text}>
          A neighbor invited you to join{' '}
          <Link href={siteUrl} className="e-accent" style={linkStyle}>
            <strong>Helpr</strong>
          </Link>
          . Tap below to accept and set up your account.
        </Text>
        <BrandButton href={confirmationUrl} label="Accept Invitation" />
        <Text className="e-footer" style={footer}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
