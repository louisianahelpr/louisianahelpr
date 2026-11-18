// 25 Days sponsor emails: which of the four prize delivery choices a sign-up made (owner 11-17).
//
// The server's ship_to holds only 'helpr' or 'winner' (sponsor_signups CHECK, sponsorSignup.ts
// SponsorShipTo). The sign-up form (ClaimSection.tsx withDelivery) sends a digital gift card and local
// pickup as ship_to 'winner' and names the exact choice on the notes' first line, as
// "Prize delivery: <option label>" (sponsorPage.ts claim.form.delivery.noteLine). Area 11 H4 (11-18):
// the confirmation email told those sponsors to ship to Delcambre or to a shipping address, and the
// admin email said "Not chosen yet". Both emails now read the choice from here, one line per choice.
//
// Pure, no imports: the Deno template and the vitest suite both load it.

export type SponsorDelivery = 'helpr' | 'winner' | 'digital' | 'pickup'

/** The delivery choice; a sign-up with no ship_to (an old or hand-made row) ships to us, the form's default. */
export function sponsorDeliveryOf(s: { shipTo: 'winner' | 'helpr' | null; notes: string | null }): SponsorDelivery {
  if (s.shipTo === 'winner') {
    const first = (s.notes ?? '').split('\n')[0].trim()
    const m = /^Prize delivery:\s*(.+)$/i.exec(first)
    if (m) {
      if (/digital gift card/i.test(m[1])) return 'digital'
      if (/pickup|pick up|will call/i.test(m[1])) return 'pickup'
    }
    return 'winner'
  }
  return 'helpr'
}

const SPONSOR_SHIP_ADDRESS = 'Louisiana Helpr, 314 Lynn Street, Delcambre, LA 70528'

/** The confirmation email's delivery row: label and the one line for the sponsor's choice. */
export function sponsorDeliveryLine(d: SponsorDelivery, adminEmail: string): { label: string; line: string } {
  switch (d) {
    case 'helpr':
      return { label: 'Ship your prize to', line: SPONSOR_SHIP_ADDRESS }
    case 'winner':
      return { label: 'Prize delivery', line: 'You get it to the winner. We send you their name and shipping address within 24 hours of the drawing.' }
    case 'digital':
      return { label: 'Prize delivery', line: `You email a digital gift card, to us at ${adminEmail} or straight to the winner. We send you the winner's name and email within 24 hours of the drawing.` }
    case 'pickup':
      return { label: 'Prize delivery', line: 'The winner picks it up from you. We send you their name within 24 hours of the drawing so you know who is coming.' }
  }
}

/** The admin email's "Prize delivery" value, one per choice. */
export function sponsorDeliveryAdminLabel(s: { shipTo: 'winner' | 'helpr' | null; notes: string | null }): string {
  if (s.shipTo === null) return 'Ships to Louisiana Helpr (no choice sent; the form default)'
  switch (sponsorDeliveryOf(s)) {
    case 'helpr': return 'Ships or drops off to Louisiana Helpr'
    case 'winner': return 'Sponsor ships straight to the winner'
    case 'digital': return 'Sponsor emails a digital gift card'
    case 'pickup': return 'Local pickup: the winner picks it up from the sponsor'
  }
}
