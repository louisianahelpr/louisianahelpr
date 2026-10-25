/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Heading, Text } from 'npm:@react-email/components@0.0.22'

import { h1, text, subtext } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'
import { CONFIRM_REMINDER_COPY, type ConfirmReminderStep } from '../confirmReminder.ts'

interface ConfirmReminderEmailProps {
  step: ConfirmReminderStep
  confirmationUrl: string
}

/**
 * The confirm-your-email reminder (confirm-reminders, lead 2026-10-25). The
 * words live in _shared/confirmReminder.ts so a vitest can hold them; the
 * button is a fresh scanner-safe link (_shared/confirmLink.ts).
 */
export const ConfirmReminderEmail = ({ step, confirmationUrl }: ConfirmReminderEmailProps) => {
  const copy = CONFIRM_REMINDER_COPY[step]
  return (
    <BaseLayout preheader={copy.preheader}>
      <Heading className="e-h1" style={h1}>{copy.heading}</Heading>
      {copy.body.map((p, i) => (
        <Text key={i} className="e-text" style={text}>{p}</Text>
      ))}
      <BrandButton href={confirmationUrl} label={copy.button} />
      <Text className="e-text e-rule" style={subtext}>{copy.after}</Text>
      <TransactionalFooter>
        If you didn't create an account on Helpr, you can safely ignore this email.
      </TransactionalFooter>
    </BaseLayout>
  )
}

