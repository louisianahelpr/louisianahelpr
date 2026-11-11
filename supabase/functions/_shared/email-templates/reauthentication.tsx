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
import { REAUTH_WORDS, wordsFor, type EmailLang } from './authEmailWords.ts'

interface ReauthenticationEmailProps {
  token: string
  /** F260q: the recipient's language; English when omitted. */
  lang?: EmailLang
}

export const ReauthenticationEmail = ({ token, lang }: ReauthenticationEmailProps) => {
  const w = wordsFor(REAUTH_WORDS, lang)
  return (
  <BaseLayout lang={lang} preheader={w.preheader}>
      {/* Owner's message review 11-09, F165: "Verify your identity" read like the photo-ID check; this is only a code. */}
      <Heading className="e-h1" style={h1}>{w.heading}</Heading>
      <Text className="e-text" style={text}>{w.body}</Text>
      <Text className="e-h1" style={codeStyle}>{token}</Text>
      <TransactionalFooter>
        {w.footer}
        {/* F460 (audit 11-10): say who sent it. */}
        <br />- Louisiana Helpr
      </TransactionalFooter>
  </BaseLayout>
  )
}
