/// <reference types="npm:@types/react@18.3.1" />

// COMMERCIAL MAIL. The welcome drip and the win-back.
//
// ── HISTORY ─────────────────────────────────────────────────────────────
// These four emails were hand-built HTML strings inside
// `engagement-automations/index.ts` (`dripStep1` / `dripStep2` / `dripStep3` /
// `reEngagementEmail`). They were DELETED in commit fa6a7898 and their
// deletion documented in 190d9c32 ("Email surface: react-email templates,
// official Resend SDK, drop drip mail") — not because anything was wrong with
// the mail, but because CAN-SPAM's physical-postal-address requirement bites
// on commercial email and the owner had no address to publish.
//
// The owner decided on 2026-08-31 to restore them with that gap knowingly
// open. So they are back — ported to react-email rather than resurrected as
// the raw HTML strings they were, because the string versions predate the
// template migration and carried every defect that migration fixed:
//   • `<div style="max-width:480px;margin:0 auto">` — Outlook renders HTML
//     with the Word engine, which does not implement `margin:0 auto` on a
//     block, so all four left-aligned and stretched to the reading-pane width.
//     `BaseLayout`'s `<Container>` is the centred `<table>` Word can honour.
//   • no `<Preview>`, so the inbox preview line was "Hey <name> — your account
//     is set up." — the first words of the body.
//   • no viewport meta, no `color-scheme` metas, no dark-mode block.
//   • `width="80"` on the logo fighting `style="width:150px"`, so the wordmark
//     rendered at two different sizes depending on the client.
//   • a plaintext part written by hand next to the HTML, free to drift from it
//     (and it had: the text parts named a different CTA than the buttons).
// All of that is now inherited from `BaseLayout`, and `renderEmail()` derives
// the plaintext twin from this same component.
//
// ── WHY THESE ARE COMMERCIAL AND THE OTHER LIFECYCLE MAIL IS NOT ────────
// The FTC applies a PRIMARY PURPOSE test. `lifecycle.tsx`'s two survivors are
// about the recipient's own account state (an approval reminder) or are an
// internal ops report to an admin — §7702(17) transactional/relationship mail.
// These four exist to get someone to come back and transact. Steps 1–3 are
// genuinely borderline — a welcome series is mostly instructional about an
// account the recipient just opened — but "here's where to start", "a quick
// tour", "four things great Helprs do" and "new jobs are open in your area"
// all read as inducements to use a paid marketplace, so they are treated as
// COMMERCIAL: every one carries <MarketingFooter> with a working one-click
// unsubscribe, and every send path gates on explicit marketing consent.
//
// ── EVERY TEMPLATE HERE TAKES `unsubscribeUrl` ──────────────────────────
// It is the recipient's signed one-click link (`buildUnsubscribeUrl()` in
// `_shared/unsubscribe.ts`). It is REQUIRED, not optional, because a
// commercial message whose opt-out link goes to a login wall is the defect the
// unsubscribe rework exists to end. A new commercial template in this file
// must take it too.

import * as React from 'npm:react@18.3.1'
import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { brand, h1, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter } from './components.tsx'

/** Every email in this file is per-recipient and carries its own opt-out link. */
interface CommercialEmailProps {
  greetingName: string
  dashboardUrl: string
  /** The recipient's signed one-click unsubscribe URL. Always pass it. */
  unsubscribeUrl: string
}

/**
 * List styling. react-email 0.0.22 has no list component, so these are plain
 * `<ul>`/`<ol>` with inline styles — the same shape the string templates used,
 * which mail clients handle uniformly. `paddingLeft` (not `margin`) carries
 * the indent because Outlook drops list margins.
 */
const listStyle = {
  fontSize: '15px',
  color: brand.bodyOlive,
  lineHeight: '1.8',
  paddingLeft: '20px',
  margin: '0 0 16px',
}

const Bold = ({ children }: { children: React.ReactNode }) => (
  <strong style={{ color: brand.inkDeep }}>{children}</strong>
)

/** Day 1 — "You're in. Here's where to start on Louisiana Helpr." */
export const WelcomeDripStep1Email = ({
  greetingName,
  dashboardUrl,
  unsubscribeUrl,
}: CommercialEmailProps) => (
  <BaseLayout
    preheader="Your Helpr account is set up — three things you can do today."
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} />}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Welcome to Louisiana Helpr!
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName || 'there'} — your account is set up. Three things you can do today:
    </Text>
    <ul className="e-text" style={listStyle}>
      <li>
        <Bold>Post a job</Bold> — describe what you need and set your budget
      </li>
      <li>
        <Bold>Browse jobs</Bold> — find opportunities near you
      </li>
      <li>
        <Bold>Connect</Bold> — message Helprs or posters directly
      </li>
    </ul>
    <BrandButton href={dashboardUrl} label="Go to Dashboard" widthPx={220} />
    <Text className="e-text" style={textStyle}>
      Reach out any time at admin@louisianahelpr.com.
    </Text>
  </BaseLayout>
)

/** Day 3 — "A quick tour of how Louisiana Helpr works." */
export const WelcomeDripStep2Email = ({
  greetingName,
  dashboardUrl,
  unsubscribeUrl,
}: CommercialEmailProps) => (
  <BaseLayout
    preheader="Now that you're set up, here's what Louisiana Helpr can do."
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} />}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Explore what Louisiana Helpr has to offer
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName || 'there'}, now that you're set up, here's what you can do:
    </Text>
    <ul className="e-text" style={listStyle}>
      <li>
        <Bold>Post a job</Bold> — describe what you need, set a budget, and get help fast
      </li>
      <li>
        <Bold>Browse jobs</Bold> — find work near you and start earning
      </li>
      <li>
        <Bold>Chat directly</Bold> — message before committing
      </li>
    </ul>
    <BrandButton href={dashboardUrl} label="Go to Dashboard" widthPx={220} />
  </BaseLayout>
)

/** Day 7 — "Four things great Helprs do." */
export const WelcomeDripStep3Email = ({
  greetingName,
  dashboardUrl,
  unsubscribeUrl,
}: CommercialEmailProps) => (
  <BaseLayout
    preheader="Four things the Helprs who get rebooked do well."
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} />}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      Tips from the community
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName || 'there'} — four things the Helprs who get rebooked do well:
    </Text>
    <ol className="e-text" style={listStyle}>
      <li>
        <Bold>Be specific</Bold> — detailed descriptions attract better matches
      </li>
      <li>
        <Bold>Respond quickly</Bold> — fast replies lead to faster help
      </li>
      <li>
        <Bold>Leave reviews</Bold> — help the community grow by sharing feedback
      </li>
      <li>
        <Bold>Stay safe</Bold> — always communicate through the platform
      </li>
    </ol>
    <BrandButton href={dashboardUrl} label="Start Now" widthPx={190} />
    <Text className="e-text" style={textStyle}>
      Questions? admin@louisianahelpr.com.
    </Text>
  </BaseLayout>
)

/** Win-back — "New jobs are open in your area." */
export const ReEngagementEmail = ({
  greetingName,
  dashboardUrl,
  unsubscribeUrl,
}: CommercialEmailProps) => (
  <BaseLayout
    preheader="It's been a minute — here's what's open near you."
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} />}
  >
    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>
      New jobs are open in your area.
    </Heading>
    <Text className="e-text" style={textStyle}>
      Hey {greetingName || 'there'}, it's been a minute — here's what's open near you.
    </Text>
    <Text className="e-text" style={textStyle}>
      There are new jobs posted in your area — whether you're looking for help or looking to
      earn, now's a great time to check in.
    </Text>
    <BrandButton href={dashboardUrl} label="See What's New" widthPx={210} />
    <Text className="e-text" style={textStyle}>
      Pull up the feed when you're ready.
    </Text>
  </BaseLayout>
)
