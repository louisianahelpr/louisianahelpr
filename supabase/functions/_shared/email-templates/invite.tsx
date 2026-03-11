/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

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
    <Head />
    <Preview>You've been invited to join Helpr</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>Helpr</Text>
        <Heading style={h1}>You've been invited! 🤝</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={linkStyle}>
            <strong>Helpr</strong>
          </Link>
          . Click the button below to accept and create your account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px' }
const logo = { fontSize: '28px', fontWeight: 'bold' as const, color: 'hsl(158, 45%, 42%)', margin: '0 0 24px', fontFamily: "'Fraunces', Georgia, serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: 'hsl(160, 10%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '15px', color: 'hsl(160, 6%, 50%)', lineHeight: '1.6', margin: '0 0 20px' }
const linkStyle = { color: 'hsl(158, 45%, 42%)', textDecoration: 'underline' }
const button = { backgroundColor: 'hsl(158, 45%, 42%)', color: '#ffffff', fontSize: '15px', borderRadius: '12px', padding: '14px 28px', textDecoration: 'none', fontWeight: '600' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
