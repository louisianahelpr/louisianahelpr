/// <reference types="npm:@types/react@18.3.1" />

// The two surviving `engagement-automations` emails.
//
// Both were hand-built HTML strings assembled by a local `wrapEmail()` around
// `<div style="max-width:480px;margin:0 auto">` — the layout Outlook's Word
// engine cannot centre, so they left-aligned and stretched to the reading-pane
// width there. They also had no preheader, so the inbox preview was the first
// words of the body.
//
// SCOPE NOTE (2026-08-31, revised): the three welcome-drip steps and the "New
// jobs are open in your area." win-back are COMMERCIAL mail and live in
// `drip.tsx`, not here. This file holds the two NON-commercial lifecycle
// emails, and the split is the point — see the footer note on each.

import * as React from 'npm:react@18.3.1'
import { Column, Heading, Link, Row, Section, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, TransactionalFooter } from './components.tsx'

/**
 * Sent to someone whose account was approved but who has never come back.
 * At most three of these, only within 14 days of signup, only while they have
 * posted nothing and messaged nobody.
 *
 * TRANSACTIONAL — §7702(17)(A)(iv), a notification about an existing
 * relationship. Its primary purpose is telling you the state of the account
 * you applied for; the "browse jobs" CTA is how you act on that state, not an
 * ad. It is genuinely near the line, which is exactly why it does NOT get
 * <MarketingFooter>:
 *
 *   • It used to carry the marketing footer and `List-Unsubscribe` while the
 *     send loop gated on nothing an unsubscribe writes. So the message offered
 *     an opt-out it would then ignore, and after the unsubscribe rework a
 *     recipient clicking it would have been told they were out and got the
 *     next reminder anyway. An unsubscribe control that does nothing is worse
 *     than none: it converts an opt-out into a spam complaint.
 *   • The honest footer for account mail is the preferences link, which is
 *     what `notification.tsx` — the highest-volume email in the product —
 *     already uses.
 *
 * If this email ever grows genuinely promotional content, it moves to
 * `drip.tsx` and gets the commercial treatment. Do not split the difference.
 */
export const ApprovalReminderEmail = ({
  greetingName,
  dashboardUrl,
  prefsUrl,
}: {
  greetingName: string
  dashboardUrl: string
  /** Deep link to the notification preferences tab. */
  prefsUrl: string
}) => (
  <BaseLayout
    preheader="Your Helpr account is approved and waiting — sign in whenever you're ready."
    footer={
      <TransactionalFooter>
        You're receiving this because your Louisiana Helpr account was approved.{' '}
        <Link
          href={prefsUrl}
          className="e-footer"
          style={{ color: brand.footerOlive, textDecoration: 'underline' }}
        >
          Manage your notification preferences
        </Link>
        .
      </TransactionalFooter>
    }
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
      <Stat label="Pending approvals" value={stats.pendingApprovals} />
      <Stat label="Open reports" value={stats.openReports} />
      <Stat label="Revenue (fees)" value={`$${stats.revenue.toFixed(2)}`} />
    </Section>
    <BrandButton href={adminUrl} label="Open Admin Dashboard" widthPx={250} />
  </BaseLayout>
)
