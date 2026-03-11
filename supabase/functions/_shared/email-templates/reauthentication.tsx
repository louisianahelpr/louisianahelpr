/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Helpr verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>Helpr</Text>
        <Heading style={h1}>Verify your identity</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'DM Sans', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px' }
const logo = { fontSize: '28px', fontWeight: 'bold' as const, color: 'hsl(158, 45%, 42%)', margin: '0 0 24px', fontFamily: "'Fraunces', Georgia, serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: 'hsl(160, 10%, 12%)', margin: '0 0 16px' }
const text = { fontSize: '15px', color: 'hsl(160, 6%, 50%)', lineHeight: '1.6', margin: '0 0 20px' }
const codeStyle = { fontFamily: 'Courier, monospace', fontSize: '28px', fontWeight: 'bold' as const, color: 'hsl(158, 45%, 42%)', margin: '0 0 30px', letterSpacing: '4px' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
