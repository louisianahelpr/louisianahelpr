/// <reference types="npm:@types/react@18.3.1" />

// COMMERCIAL MAIL. Saved-gift price alerts (owner 2026-11-21): a short note when gifts someone saved on the gift
// guides cost less today, and one reminder before Dec 15. The words live in `_shared/giftPriceAlerts.ts` (so a vitest
// holds the rules); this file lays them out. Sent by `gift-price-alerts/index.ts`, only to an address that ticked the
// consent box, always with its signed one-click unsubscribe (list 'gift_price_alerts') and the postal address
// (<MarketingFooter>).
//
// Amazon: no Amazon link and no Amazon photo ever goes in an email (Associates policy); an Amazon item links to our
// guide page instead (emailLink / emailImage).

import * as React from 'npm:react@18.3.1'
import { Img, Link, Text } from 'npm:@react-email/components@0.0.22'
import { brand, text as textStyle } from './styles.ts'
import { BaseLayout, BrandButton, MarketingFooter } from './components.tsx'
import { PRICE_ALERT_COPY as C, emailImage, emailLink, money } from '../giftPriceAlerts.ts'

export interface EmailItem {
  href: string
  name: string
  /** Today's price. */
  now: number | null
  /** The price it dropped from, when it dropped. */
  was?: number | null
  image?: string
  guide?: string | null
}

const rowStyle = { borderTop: `1px solid ${brand.hairline}`, padding: '12px 0' }
const nameStyle = { fontSize: '15px', color: brand.inkDeep, fontWeight: 600, textDecoration: 'none', lineHeight: '1.4' }
const priceStyle = { fontSize: '15px', color: brand.burntSienna, fontWeight: 600, margin: '4px 0 0' }
const wasStyle = { fontSize: '13px', color: brand.bodyOlive, textDecoration: 'line-through', marginLeft: '6px', fontWeight: 400 }

function ItemRows({ items, appUrl, droppedLabel }: { items: EmailItem[]; appUrl: string; droppedLabel?: string }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: '8px 0 16px' }}>
      <tbody>
        {items.map((i) => {
          const href = emailLink(i.href, i.guide, appUrl)
          const img = emailImage(i.image)
          return (
            <tr key={i.href}>
              {img ? (
                <td width={72} style={{ ...rowStyle, verticalAlign: 'top', paddingRight: '12px' }}>
                  <Link href={href}>
                    <Img src={img} alt="" width={64} height={64} style={{ display: 'block', objectFit: 'contain', borderRadius: '8px' }} />
                  </Link>
                </td>
              ) : null}
              <td style={{ ...rowStyle, verticalAlign: 'top' }} colSpan={img ? 1 : 2}>
                <Link href={href} style={nameStyle}>{i.name}</Link>
                {i.now !== null ? (
                  <Text style={priceStyle}>
                    {money(i.now)}
                    {i.was ? <>{' '}<span style={wasStyle}>{C.was(i.was)}</span></> : null}
                    {i.was && droppedLabel ? <span style={{ ...wasStyle, textDecoration: 'none' }}> · {droppedLabel}</span> : null}
                  </Text>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export const GiftPriceDropEmail = ({
  items,
  appUrl,
  unsubscribeUrl,
}: {
  items: EmailItem[]
  appUrl: string
  unsubscribeUrl: string
}) => (
  <BaseLayout
    preheader={C.dropPreheader}
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} reasonLine={C.reason} unsubscribeLabel={C.unsubscribe} />}
  >
    <Text className="e-text" style={textStyle}>{C.dropIntro(items.length)}</Text>
    <ItemRows items={items} appUrl={appUrl} />
    <Text className="e-text" style={textStyle}>{C.dropOutro}</Text>
    <BrandButton href={`${appUrl}/gift-guides/planner`} label={C.button} widthPx={220} />
    <Text className="e-text" style={textStyle}>
      {C.closing}
      <br />
      {C.signOff}
    </Text>
  </BaseLayout>
)

export const GiftReminderEmail = ({
  items,
  appUrl,
  unsubscribeUrl,
}: {
  items: EmailItem[]
  appUrl: string
  unsubscribeUrl: string
}) => (
  <BaseLayout
    preheader={C.reminderPreheader}
    footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} reasonLine={C.reason} unsubscribeLabel={C.unsubscribe} />}
  >
    <Text className="e-text" style={textStyle}>{C.reminderIntro}</Text>
    <Text className="e-text" style={textStyle}>{C.reminderListLead}</Text>
    <ItemRows items={items} appUrl={appUrl} droppedLabel={C.reminderDropped} />
    <BrandButton href={`${appUrl}/gift-guides/planner`} label={C.button} widthPx={220} />
    <Text className="e-text" style={textStyle}>
      {C.closing}
      <br />
      {C.signOff}
    </Text>
  </BaseLayout>
)
