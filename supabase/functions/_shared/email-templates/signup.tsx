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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Verify your email to get started on Helpr</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>Helpr</Text>
        <Heading style={h1}>Welcome aboard! 🎉</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={linkStyle}>
            <strong>Helpr</strong>
          </Link>
          ! We're excited to have you.
        </Text>
        <Text style={text}>
          Please verify your email (
          <Link href={`mailto:${recipient}`} style={linkStyle}>
            {recipient}
          </Link>
          ) to continue setting up your account:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verify My Email
        </Button>
        <Text style={subtext}>
          Once verified, our team will review your profile and ID. This usually takes 24–48 hours. We'll email you when you're approved!
        </Text>
        <Text style={footer}>
          If you didn't create an account on Helpr, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px' }
const logo = { fontSize: '28px', fontWeight: 'bold' as const, color: 'hsl(158, 45%, 42%)', margin: '0 0 24px', fontFamily: "'Fraunces', Georgia, serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: 'hsl(160, 10%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '15px', color: 'hsl(160, 6%, 50%)', lineHeight: '1.6', margin: '0 0 20px' }
const subtext = { fontSize: '13px', color: 'hsl(160, 6%, 50%)', lineHeight: '1.5', margin: '24px 0 0', padding: '16px 0 0', borderTop: '1px solid hsl(150, 12%, 90%)' }
const linkStyle = { color: 'hsl(158, 45%, 42%)', textDecoration: 'underline' }
const button = { backgroundColor: 'hsl(158, 45%, 42%)', color: '#ffffff', fontSize: '15px', borderRadius: '12px', padding: '14px 28px', textDecoration: 'none', fontWeight: '600' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
