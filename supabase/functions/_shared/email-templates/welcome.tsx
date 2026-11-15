/// <reference types="npm:@types/react@18.3.1" />

// COMMERCIAL MAIL. The welcome emails (owner 11-14, "Yes do that"): day 1 and
// day 3 after sign-up, each with up to three open jobs and three things for
// sale near the member. The words live in `_shared/welcomeEmail.ts` (so a
// vitest can hold the copy rules); this file only lays them out. Sent by
// `welcome-emails/index.ts`.
//
// Commercial, like everything in `drip.tsx`: it asks someone to use a
// marketplace, so it is sent only with marketing consent (Q2299) and carries
// the recipient's signed one-click unsubscribe in <MarketingFooter>.
//
// A job row shows its title and town, never its pay: what a Helpr takes home
// depends on the job's fee stamp (JobPrice in the app), and an email that
// guessed it could promise the wrong amount. The job page shows the real one.

import * as React from 'npm:react@18.3.1'
import { Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter } from './components.tsx'
import {
  WELCOME_COPY,
  WELCOME_REASON,
  WELCOME_UNSUBSCRIBE,
  type WelcomeLang,
  type WelcomeStep,
  welcomeGreeting,
} from '../welcomeEmail.ts'

/** One row of a list: what it is, where, and the page it opens. */
export interface WelcomeListing {
  title: string
  /** Town, parish or area ("Mid City"), and for an item its price ("$40 · Mid City"). */
  detail: string
  url: string
}

const subHeading = {
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  color: brand.bodyOlive,
  margin: '20px 0 8px',
}
const rowTitle = { color: brand.inkDeep, fontWeight: 700, textDecoration: 'none' }
const rowDetail = { fontSize: '14px', color: brand.bodyOlive, margin: '0 0 10px', lineHeight: '1.5' }

const Listings = ({ heading, rows }: { heading: string; rows: WelcomeListing[] }) =>
  rows.length === 0 ? null : (
    <>
      <Text className="e-text" style={subHeading}>
        {heading}
      </Text>
      {rows.map((r) => (
        <Text key={r.url} className="e-text" style={rowDetail}>
          <Link href={r.url} style={rowTitle}>
            {r.title}
          </Link>
          <br />
          {r.detail}
        </Text>
      ))}
    </>
  )

export const WelcomeEmail = ({
  step,
  lang,
  fullName,
  jobs,
  items,
  appUrl,
  unsubscribeUrl,
}: {
  step: WelcomeStep
  lang: WelcomeLang
  fullName: string | null
  /** Up to three open jobs near the member (may be empty). */
  jobs: WelcomeListing[]
  /** Up to three live Declutter items near the member (may be empty). */
  items: WelcomeListing[]
  /** Where the button goes (the member's Home). */
  appUrl: string
  /** The recipient's signed one-click unsubscribe URL. Always pass it. */
  unsubscribeUrl: string
}) => {
  const copy = WELCOME_COPY[lang][step]
  return (
    <BaseLayout
      lang={lang}
      preheader={copy.preheader}
      footer={
        <MarketingFooter
          unsubscribeUrl={unsubscribeUrl}
          reasonLine={WELCOME_REASON[lang]}
          unsubscribeLabel={WELCOME_UNSUBSCRIBE[lang]}
        />
      }
    >
      <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
        {copy.heading}
      </Heading>
      <Text className="e-text" style={textStyle}>
        {welcomeGreeting(fullName, lang)}
      </Text>
      {copy.intro.map((p) => (
        <Text key={p} className="e-text" style={textStyle}>
          {p}
        </Text>
      ))}
      {jobs.length === 0 && items.length === 0 ? (
        <Text className="e-text" style={textStyle}>
          {copy.nothingNear}
        </Text>
      ) : (
        <>
          <Listings heading={copy.jobsHeading} rows={jobs} />
          <Listings heading={copy.itemsHeading} rows={items} />
        </>
      )}
      <BrandButton href={appUrl} label={copy.button} widthPx={240} />
      <Text className="e-text" style={textStyle}>
        {copy.closing}
      </Text>
    </BaseLayout>
  )
}
