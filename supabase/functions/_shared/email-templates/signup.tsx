/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  main,
  container,
  logo,
  h1,
  text,
  subtext,
  linkStyle,
  button,
  footer,
} from './styles.ts'

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
        <Img src="https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset" alt="Helpr" width="80" style={logo} />
        <Heading style={h1}>Confirm your email to get started.</Heading>
        <Text style={text}>
          Tap the button below to verify your email so we can finish setting up your{' '}
          <Link href={siteUrl} style={linkStyle}>
            <strong>Helpr</strong>
          </Link>{' '}
          account.
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
