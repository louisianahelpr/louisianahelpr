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
import { MAGIC_LINK_WORDS, wordsFor, type EmailLang } from './authEmailWords.ts'

// Sent when the app calls supabase.auth.signInWithOtp, which today happens in
// one place: confirming it's you before deleting your account, for members
// with no password or who forgot it (A3-I5, src/lib/deleteAccountReauth.ts).
// It shows the 6-digit code and NO link, on purpose: the link and the code are
// one token, so a mail scanner that opens the link spends the code before the
// member can type it. Admin-minted magic links (generateLink) never come
// through this hook.
interface MagicLinkEmailProps {
  token: string
  /** F260q: the recipient's language; English when omitted. */
  lang?: EmailLang
}

export const MagicLinkEmail = ({ token, lang }: MagicLinkEmailProps) => {
  const w = wordsFor(MAGIC_LINK_WORDS, lang)
  return (
  <BaseLayout lang={lang} preheader={w.preheader}>
      {/* Owner's message review 11-09: F159 sentence case, F188 the full name. */}
      <Heading className="e-h1" style={h1}>{w.heading}</Heading>
      <Text className="e-text" style={text}>{w.body}</Text>
      <Text className="e-h1" style={codeStyle}>{token}</Text>
      <TransactionalFooter>
        {w.footer}
        {/* F461 (audit 11-10): say who sent it. */}
        <br />- Louisiana Helpr
      </TransactionalFooter>
  </BaseLayout>
  )
}
