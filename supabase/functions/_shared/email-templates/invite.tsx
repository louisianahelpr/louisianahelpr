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
  linkStyle,
  button,
  footer,
} from './styles.ts'

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
        <Img src="https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset" alt="Louisiana Helpr" width="150" style={logo} />
        <Heading style={h1}>You've been invited to Helpr.</Heading>
        <Text style={text}>
          A neighbor invited you to join{' '}
          <Link href={siteUrl} style={linkStyle}>
            <strong>Helpr</strong>
          </Link>
          . Tap below to accept and set up your account.
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
