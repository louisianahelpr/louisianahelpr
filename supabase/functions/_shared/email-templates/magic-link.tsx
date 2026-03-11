/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Helpr login link</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>Helpr</Text>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Click the button below to log in to Helpr. This link will expire shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Log In to Helpr
        </Button>
        <Text style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px' }
const logo = { fontSize: '28px', fontWeight: 'bold' as const, color: 'hsl(158, 45%, 42%)', margin: '0 0 24px', fontFamily: "'Fraunces', Georgia, serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: 'hsl(160, 10%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '15px', color: 'hsl(160, 6%, 50%)', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: 'hsl(158, 45%, 42%)', color: '#ffffff', fontSize: '15px', borderRadius: '12px', padding: '14px 28px', textDecoration: 'none', fontWeight: '600' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
