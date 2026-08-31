/// <reference types="npm:@types/react@18.3.1" />

// The two surviving `engagement-automations` emails.
//
// Both were hand-built HTML strings assembled by a local `wrapEmail()` around
// `<div style="max-width:480px;margin:0 auto">` — the layout Outlook's Word
// engine cannot centre, so they left-aligned and stretched to the reading-pane
// width there. They also had no preheader, so the inbox preview was the first
// words of the body.
//
// SCOPE NOTE (2026-08-31): the three welcome-drip steps and the "New jobs are
// open in your area." win-back are NOT here because they were deleted, not
// ported. Their purpose is promotional, which makes CAN-SPAM's physical
// postal-address requirement (§7704(a)(5)) bite, and the business has chosen
// not to publish an address. What is left is account-status mail and an
// internal admin digest.

import * as React from 'npm:react@18.3.1'
import { Column, Heading, Row, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter } from './components.tsx'

/**
 * Sent to someone whose account was approved but who has never come back.
 * Account-status mail, not a campaign — but it still carries the unsubscribe
 * footer, which costs nothing and is the control a recipient reaches for.
 */
export const ApprovalReminderEmail = ({
  greetingName,
  dashboardUrl,
}: {
  greetingName: string
  dashboardUrl: string
}) => (
  <BaseLayout
    preheader="Your Helpr account is approved and waiting — sign in whenever you're ready."
    footer={<MarketingFooter />}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Your account is approved!
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName || 'there'}, just a reminder — your Louisiana Helpr account has been
      approved and is ready to go!
    </Text>
    <Text className="e-text" style={textStyle}>
      Browse jobs, post your own, or connect with people in your area. It only takes a minute to
      get started.
    </Text>
    <BrandButton href={dashboardUrl} label="Browse Jobs" widthPx={180} />
    <Text className="e-text" style={textStyle}>
      Open the app whenever you're ready to post or browse.
    </Text>
  </BaseLayout>
)

export interface DigestStats {
  newUsers: number
  newJobs: number
  completedJobs: number
  pendingApprovals: number
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

/** Monday-morning digest. Internal — every recipient is an admin. */
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
    footer={<MarketingFooter />}
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
      <Stat label="Pending approvals" value={stats.pendingApprovals} />
      <Stat label="Open reports" value={stats.openReports} />
      <Stat label="Revenue (fees)" value={`$${stats.revenue.toFixed(2)}`} />
    </Section>
    <BrandButton href={adminUrl} label="Open Admin Dashboard" widthPx={250} />
  </BaseLayout>
)
