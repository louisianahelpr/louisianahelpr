/// <reference types="npm:@types/react@18.3.1" />

// COMMERCIAL MAIL. The come-back emails (owner said yes, 2026-10-21): a note
// from the founder to a member who signed up and never came back. Step 1 about
// day 3, step 2 about day 10, never a third. The words live in
// `_shared/comeBackEmail.ts` (so a vitest can hold the copy rules); this file
// only lays them out. Sent by `come-back-emails/index.ts`.
//
// Commercial, like everything in `drip.tsx`: it asks someone to come back to
// a marketplace, so it is sent only with marketing consent and carries the
// recipient's signed one-click unsubscribe in <MarketingFooter>.
//
// A plain letter on purpose: a greeting, short paragraphs, at most a two-line
// list, one button and the founder's name. No heading: a heading reads as a
// newsletter, and this is meant to read as a note from a person.

import * as React from 'npm:react@18.3.1'
import { Text } from 'npm:@react-email/components@0.0.22'
import { brand, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter } from './components.tsx'
import {
  COME_BACK_COPY,
  COME_BACK_REASON,
  type ComeBackStep,
  comeBackGreeting,
  FOUNDER_NAME,
} from '../comeBackEmail.ts'

const listStyle = {
  fontSize: '15px',
  color: brand.bodyOlive,
  lineHeight: '1.8',
  paddingLeft: '20px',
  margin: '0 0 16px',
}

export const ComeBackEmail = ({
  step,
  fullName,
  appUrl,
  unsubscribeUrl,
}: {
  step: ComeBackStep
  fullName: string | null
  /** Where the button goes (the member's home screen). */
  appUrl: string
  /** The recipient's signed one-click unsubscribe URL. Always pass it. */
  unsubscribeUrl: string
}) => {
  const copy = COME_BACK_COPY[step]
  return (
    <BaseLayout
      preheader={copy.preheader}
      footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} reasonLine={COME_BACK_REASON} />}
    >
      <Text className="e-text" style={textStyle}>
        {comeBackGreeting(fullName)}
      </Text>
      {copy.intro.map((p) => (
        <Text key={p} className="e-text" style={textStyle}>
          {p}
        </Text>
      ))}
      {copy.bullets.length > 0 ? (
        <ul className="e-text" style={listStyle}>
          {copy.bullets.map(([lead, rest]) => (
            <li key={lead}>
              <strong style={{ color: brand.inkDeep }}>{lead}</strong> {rest}
            </li>
          ))}
        </ul>
      ) : null}
      <BrandButton href={appUrl} label={copy.button} widthPx={230} />
      <Text className="e-text" style={textStyle}>
        {copy.closing}
        <br />
        {FOUNDER_NAME}
        <br />
        Founder, Louisiana Helpr
      </Text>
    </BaseLayout>
  )
}
