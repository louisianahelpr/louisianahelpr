/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  codeStyle,
} from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'

// Sent when the app calls supabase.auth.signInWithOtp, which today happens in
// one place: confirming it's you before deleting your account, for members
// with no password or who forgot it (A3-I5, src/lib/deleteAccountReauth.ts).
// It shows the 6-digit code and NO link, on purpose: the link and the code are
// one token, so a mail scanner that opens the link spends the code before the
// member can type it. Admin-minted magic links (generateLink) never come
// through this hook.
interface MagicLinkEmailProps {
  token: string
}

export const MagicLinkEmail = ({ token }: MagicLinkEmailProps) => (
  <BaseLayout preheader="Your Helpr code">
      <Heading className="e-h1" style={h1}>Your Helpr Code</Heading>
      <Text className="e-text" style={text}>Enter this code in the app to confirm it&apos;s you:</Text>
      <Text className="e-h1" style={codeStyle}>{token}</Text>
      <TransactionalFooter>
        This code expires soon. If you didn&apos;t ask for it, you can ignore this email; nothing changes without the code.
      </TransactionalFooter>
  </BaseLayout>
)

export default MagicLinkEmail
