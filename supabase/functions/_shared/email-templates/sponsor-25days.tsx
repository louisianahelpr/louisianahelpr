/// <reference types="npm:@types/react@18.3.1" />

// 25 Days of Louisiana Giveaways: the two emails a sponsor sign-up sends
// (sent by sponsor-25days/index.ts):
//   SponsorConfirmationEmail  to the brand: you're in, what happens next, how to reach Lexi.
//   SponsorAdminEmail         to admin@: every detail of the sign-up and the logo link.
//
// ESCAPING: every value is untrusted, unauthenticated input. Each one is a JSX
// child, so React escapes it. No dangerouslySetInnerHTML in this file.

import * as React from 'npm:react@18.3.1'
import { Column, Heading, Hr, Link, Row, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'

export interface SponsorEmailSignup {
  brandName: string
  contactName: string
  email: string
  phone: string | null
  website: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  prizeDescription: string
  prizeValue: number
  shipTo: 'winner' | 'helpr' | null
  notes: string | null
  /** "December 3 and 12" or "Any day". */
  daysLabel: string
  showOnWall: boolean
  ref: string | null
}

const labelCell = { padding: '4px 0', width: '120px', fontSize: '14px', color: brand.footerOlive, verticalAlign: 'top' as const }
const valueCell = { padding: '4px 0', fontSize: '14px', color: brand.olivewood, verticalAlign: 'top' as const }

const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Row>
    <Column className="e-footer" style={labelCell}>{label}:{' '}</Column>
    <Column className="e-text" style={valueCell}>{children}</Column>
  </Row>
)

// Owner 11-09: every prize ships to Louisiana Helpr.
const SHIP_ADDRESS = 'Louisiana Helpr, 314 Lynn Street, Delcambre, LA 70528'

const shipLabel = (s: SponsorEmailSignup['shipTo']) =>
  s === 'winner' ? 'The winner directly' : s === 'helpr' ? 'Louisiana Helpr' : 'Not chosen yet'

export const SponsorConfirmationEmail = ({ s, adminEmail }: { s: SponsorEmailSignup; adminEmail: string }) => (
  <BaseLayout
    preheader={`You're in for the 25 Days of Louisiana Giveaways: ${s.daysLabel}`}
    footer={
      <TransactionalFooter>
        You're getting this because {s.brandName} signed up to sponsor a day of the 25 Days of Louisiana Giveaways
        on louisianahelpr.com. Questions? Just reply, or email {adminEmail}.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={h1}>You're in! 🎉</Heading>
    <Text className="e-text" style={textStyle}>
      Hi {s.contactName}, thank you for signing {s.brandName} up for the 25 Days of Louisiana Giveaways!
    </Text>
    <Section style={{ width: '100%', margin: '0 0 16px' }}>
      <Detail label="Your day(s)">{s.daysLabel}</Detail>
      <Detail label="Your prize">{s.prizeDescription} (about ${s.prizeValue})</Detail>
      <Detail label="Ship your prize to">{SHIP_ADDRESS}</Detail>
    </Section>
    <Heading as="h2" className="e-h1" style={{ ...h1, fontSize: '18px' }}>What happens next</Heading>
    <Text className="e-text" style={textStyle}>
      1. Lexi will be in touch within 48 hours to confirm your day and the prize details.
      <br />
      2. We design your graphics, write and publish your post, tag and link your brand, run the entries and pick a
      winner at random.
      <br />
      3. A Louisiana neighbor wins your prize, and local families see your brand.
    </Text>
    <Text className="e-text" style={textStyle}>
      You're working directly with Lexi, a real person: reply to this email or write
      to <Link href={`mailto:${adminEmail}`}>{adminEmail}</Link> any time.
    </Text>
    <Text className="e-text" style={textStyle}>— Lexi, Founder, Louisiana Helpr</Text>
  </BaseLayout>
)

export const SponsorAdminEmail = ({ s, logoUrl }: { s: SponsorEmailSignup; logoUrl: string | null }) => (
  <BaseLayout
    preheader={`New 25 Days sponsor: ${s.brandName} (${s.daysLabel})`}
    footer={<TransactionalFooter>Reply directly to <strong>{s.email}</strong> to answer this sponsor.</TransactionalFooter>}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '20px' }}>New sponsor: {s.brandName}</Heading>
    <Section style={{ width: '100%', margin: '0 0 16px' }}>
      <Detail label="Day(s)">{s.daysLabel}</Detail>
      <Detail label="Contact">{s.contactName}</Detail>
      <Detail label="Email">{s.email}</Detail>
      <Detail label="Phone">{s.phone ?? '—'}</Detail>
      <Detail label="Website">{s.website ?? '—'}</Detail>
      <Detail label="Instagram">{s.instagram ?? '—'}</Detail>
      <Detail label="Facebook">{s.facebook ?? '—'}</Detail>
      <Detail label="TikTok">{s.tiktok ?? '—'}</Detail>
      <Detail label="Prize">{s.prizeDescription}</Detail>
      <Detail label="Prize value">${s.prizeValue}</Detail>
      <Detail label="Ship to">{shipLabel(s.shipTo)}</Detail>
      <Detail label="OK on wall">{s.showOnWall ? 'Yes' : 'No'}</Detail>
      <Detail label="Invite link">{s.ref ?? 'none (direct)'}</Detail>
      <Detail label="Logo">{logoUrl ? <Link href={logoUrl}>Download the logo (link works for 7 days)</Link> : 'none uploaded'}</Detail>
    </Section>
    {s.notes ? (
      <>
        <Hr className="e-rule" style={{ borderColor: brand.hairline, margin: '0 0 16px' }} />
        {s.notes.split('\n').map((line, i) => (
          <Text key={i} className="e-text" style={{ ...textStyle, margin: '0 0 6px' }}>{line || ' '}</Text>
        ))}
      </>
    ) : null}
    <Text className="e-text" style={textStyle}>
      It is also in the admin's 25 Days sponsors page, under its day(s).
    </Text>
  </BaseLayout>
)
