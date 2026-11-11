/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  subtext,
} from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'
import { SIGNUP_WORDS, wordsFor, type EmailLang } from './authEmailWords.ts'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  /** F260q: the recipient's language (sign-up metadata); English when omitted. */
  lang?: EmailLang
}

export const SignupEmail = ({
  confirmationUrl,
  lang,
}: SignupEmailProps) => {
  const w = wordsFor(SIGNUP_WORDS, lang)
  return (
  <BaseLayout lang={lang} preheader={w.preheader}>
      {/* Owner's message review 11-09: F159 sentence case; F160 plain text, no stray "Helpr" link or repeated
          address line; F161 the ID check timing names Declutter too (owner's ID-check rule). */}
      <Heading className="e-h1" style={h1}>{w.heading}</Heading>
      <Text className="e-text" style={text}>{w.body}</Text>
      <BrandButton href={confirmationUrl} label={w.button} />
      {/* This line used to read: "Once verified, our team will review your
          profile and ID. This usually takes 24–48 hours. We'll email you when
          you're approved!"
          Every clause of it was false, and had been since manual review was
          removed:
            • `complete-signup/index.ts` set `approval_status: "approved"`
              unconditionally, with its own comment saying "Auto-approve —
              there's no manual admin review step anymore".
            • There is therefore no 24–48 hour window. Prod, 2026-08-31: 30 of
              30 profiles are `approved`, 0 pending, 0 denied — nobody has ever
              sat in a review queue.
            • No approval email is sent on this path at all;
              `send-account-status-email` fires only on an explicit admin action
              or the IDV webhook.
            • Signup collects no ID document on this path, so "review your
              profile and ID" named an artefact that does not exist yet.
          It also contradicted the in-app screen, which promises "under 2 hours"
          — two different invented numbers for the same non-existent step. The
          copy now describes what the code actually does. */}
      <Text className="e-text e-rule" style={subtext}>{w.idNote}</Text>
      <TransactionalFooter>{w.footer}</TransactionalFooter>
  </BaseLayout>
  )
}

export default SignupEmail
