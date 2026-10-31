/// <reference types="npm:@types/react@18.3.1" />

// The internal `engagement-automations` email.
//
// Both were hand-built HTML strings assembled by a local `wrapEmail()` around
// `<div style="max-width:480px;margin:0 auto">` — the layout Outlook's Word
// engine cannot centre, so they left-aligned and stretched to the reading-pane
// width there. They also had no preheader, so the inbox preview was the first
// words of the body.
//
// SCOPE NOTE (2026-08-31, revised): the three welcome-drip steps and the "New
// jobs are open in your area." win-back are COMMERCIAL mail and live in
// `drip.tsx`, not here. This file holds the NON-commercial lifecycle email,
// and the split is the point — see its footer note. (The approval reminder
// that also lived here was deleted with the approval step, Q205b.)

import * as React from 'npm:react@18.3.1'
import { Column, Heading, Row, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

export interface DigestStats {
  newUsers: number
  newJobs: number
  completedJobs: number
  openReports: number
  revenue: number
}

const statLabel = {
  padding: '8px 0',
  fontSize: '15px',
  color: brand.bodyOlive,
  borderBottom: `1px solid ${brand.hairline}`,
}

const statValue = {
  padding: '8px 0',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  color: brand.inkDeep,
  textAlign: 'right' as const,
  borderBottom: `1px solid ${brand.hairline}`,
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <Row>
    <Column className="e-text e-rule" style={statLabel}>
      {label}
    </Column>
    <Column className="e-h1 e-rule" style={statValue}>
      {value}
    </Column>
  </Row>
)

/**
 * Monday-morning digest. Internal ops mail — every recipient holds the
 * `admin` role on this platform, and the content is that platform's own
 * numbers.
 *
 * NOT COMMERCIAL, and not really transactional either: it advertises nothing
 * and solicits nothing, and the "recipient" and the "sender" are the same
 * business. CAN-SPAM's commercial definition (§7702(2), "the commercial
 * advertisement or promotion of a commercial product or service") does not
 * reach an operator's own dashboard summary, so neither the opt-out nor the
 * postal-address requirement applies.
 *
 * It used to render <MarketingFooter> and ship `List-Unsubscribe`, which
 * offered the platform's own admins a legally-flavoured opt-out from their
 * operations report — and, once the unsubscribe handler became real, an
 * admin's stray click on Gmail's native control would have set
 * `marketing_consent = false` on their own profile. The footer is the plain
 * transactional one, and the send path no longer sets `List-Unsubscribe`.
 *
 * An admin who does not want it should be removed from the send, not
 * "unsubscribed" — the list is `user_roles.role = 'admin'`.
 */
export const AdminDigestEmail = ({
  stats,
  adminUrl,
  weekOf,
}: {
  stats: DigestStats
  adminUrl: string
  weekOf: string
}) => (
  <BaseLayout
    preheader={`Helpr this week: ${stats.newUsers} signups, ${stats.newJobs} jobs posted, ${stats.completedJobs} completed.`}
    footer={
      <TransactionalFooter>
        You're receiving this because you're an administrator on Louisiana Helpr. It's an
        internal operations report, not a mailing list.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Weekly Digest
    </Heading>
    <Text className="e-text" style={textStyle}>
      Here's your platform summary for the past 7 days (week of {weekOf}):
    </Text>
    <Section style={{ margin: '0 0 20px' }}>
      <Stat label="New signups" value={stats.newUsers} />
      <Stat label="Jobs posted" value={stats.newJobs} />
      <Stat label="Jobs completed" value={stats.completedJobs} />
      <Stat label="Open reports" value={stats.openReports} />
      <Stat label="Revenue (fees)" value={`$${stats.revenue.toFixed(2)}`} />
    </Section>
    <BrandButton href={adminUrl} label="Open Admin Dashboard" widthPx={250} />
  </BaseLayout>
)

export interface OwnerDailyStats {
  newUsers: number
  jobsPosted: number
  itemsPosted: number
  jobsCompleted: number
  itemsSold: number
  salesCents: number
  openReports: number
  failedPayouts: number
  memberErrors: number
  membersWithErrors: number
  /** OPS-5: top sign-up sources in the window, real members only; null when unknown (left out). */
  topSources?: Array<{ source: string; signups: number }> | null
}

/**
 * OPS-1 (owner): the owner's daily summary, same family as the weekly digest
 * above and sent the same way (internal ops mail, plain transactional footer,
 * no List-Unsubscribe). Every figure is real members and real items only: test
 * accounts, seed rows and test-mode money never show (owner rule, 10-29).
 * Goes only to admins who are not test accounts.
 */
export const OwnerDailySummaryEmail = ({
  stats,
  adminUrl,
  dayOf,
}: {
  stats: OwnerDailyStats
  adminUrl: string
  dayOf: string
}) => (
  <BaseLayout
    preheader={`Last 24 hours: ${stats.newUsers} sign-ups, ${stats.jobsPosted} jobs and ${stats.itemsPosted} items posted, ${stats.itemsSold} items sold.`}
    footer={
      <TransactionalFooter>
        You're receiving this because you're an administrator on Louisiana Helpr. It's an
        internal operations report, not a mailing list.
      </TransactionalFooter>
    }
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Daily summary
    </Heading>
    <Text className="e-text" style={textStyle}>
      The last 24 hours, up to {dayOf}. Real members only; test accounts are left out.
    </Text>
    <Section style={{ margin: '0 0 20px' }}>
      <Stat label="New sign-ups" value={stats.newUsers} />
      <Stat label="Jobs posted" value={stats.jobsPosted} />
      <Stat label="Declutter items posted" value={stats.itemsPosted} />
      <Stat label="Jobs completed" value={stats.jobsCompleted} />
      <Stat label="Declutter items sold" value={stats.itemsSold} />
      <Stat label="Declutter sales" value={`$${(stats.salesCents / 100).toFixed(2)}`} />
    </Section>
    {stats.topSources && stats.topSources.length > 0 && (
      <>
        <Text className="e-text" style={{ ...textStyle, fontWeight: 'bold' as const }}>
          Where sign-ups came from
        </Text>
        <Section style={{ margin: '0 0 20px' }}>
          {stats.topSources.map((s) => (
            <Stat key={s.source} label={s.source === 'direct' ? 'Direct (no link)' : s.source === 'other' ? 'Other' : s.source} value={s.signups} />
          ))}
        </Section>
      </>
    )}
    <Text className="e-text" style={{ ...textStyle, fontWeight: 'bold' as const }}>
      Needs a look
    </Text>
    <Section style={{ margin: '0 0 20px' }}>
      <Stat label="Open reports" value={stats.openReports} />
      <Stat label="Declutter payouts that failed" value={stats.failedPayouts} />
      <Stat
        label="App errors members hit"
        value={stats.memberErrors === 0 ? 0 : `${stats.memberErrors} (${stats.membersWithErrors} ${stats.membersWithErrors === 1 ? 'member' : 'members'})`}
      />
    </Section>
    <BrandButton href={adminUrl} label="Open Admin Dashboard" widthPx={250} />
  </BaseLayout>
)
