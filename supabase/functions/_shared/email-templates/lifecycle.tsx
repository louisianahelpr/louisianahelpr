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
