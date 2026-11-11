/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
} from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'
import { RECOVERY_WORDS, wordsFor, type EmailLang } from './authEmailWords.ts'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  /** F260q: the recipient's language; English when omitted. */
  lang?: EmailLang
}

export const RecoveryEmail = ({
  confirmationUrl,
  lang,
}: RecoveryEmailProps) => {
  const w = wordsFor(RECOVERY_WORDS, lang)
  return (
  <BaseLayout lang={lang} preheader={w.preheader}>
      {/* Owner's message review 11-09: F159 sentence case, F162 "Tap" like every other email. */}
      <Heading className="e-h1" style={h1}>{w.heading}</Heading>
      <Text className="e-text" style={text}>{w.body}</Text>
      <BrandButton href={confirmationUrl} label={w.button} />
      <TransactionalFooter>{w.footer}</TransactionalFooter>
  </BaseLayout>
  )
}

export default RecoveryEmail
