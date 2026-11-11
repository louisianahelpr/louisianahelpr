/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
  Link,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  linkStyle,
} from './styles.ts'
import { EMAIL_CHANGE_WORDS, wordsFor, type EmailLang } from './authEmailWords.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'
import { getAppUrl } from '../appUrl.ts'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
  /** F260q: the recipient's language; English when omitted. */
  lang?: EmailLang
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
  lang,
}: EmailChangeEmailProps) => {
  const w = wordsFor(EMAIL_CHANGE_WORDS, lang)
  return (
  <BaseLayout lang={lang} preheader={w.preheader}>
      {/* Owner's message review 11-09, F159: sentence case. */}
      <Heading className="e-h1" style={h1}>{w.heading}</Heading>
      <Text className="e-text" style={text}>
        {w.from}{' '}
        <Link href={`mailto:${email}`} className="e-accent" style={linkStyle}>
          {email}
        </Link>{' '}
        {w.to}{' '}
        <Link href={`mailto:${newEmail}`} className="e-accent" style={linkStyle}>
          {newEmail}
        </Link>
        .
      </Text>
      <BrandButton href={confirmationUrl} label={w.button} />
      <TransactionalFooter>
        {/* F462 (audit 11-10): the "not you" line names the step and links it. */}
        {w.notYou}{' '}
        <Link href={`${getAppUrl()}/forgot-password`} className="e-accent" style={linkStyle}>
          {w.reset}
        </Link>
        . - Louisiana Helpr
      </TransactionalFooter>
  </BaseLayout>
  )
}

export default EmailChangeEmail
