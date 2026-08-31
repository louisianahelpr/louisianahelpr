// One-click commercial-email opt-out: the token, the URL, and the headers.
//
// WHY THIS MODULE EXISTS
// ----------------------
// Before it, "unsubscribe" in this product was a link to
// `https://<app>/profile?tab=notifications` — the logged-in preferences
// screen — and that same URL was ALSO advertised in the `List-Unsubscribe`
// header alongside `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
//
// Both halves were broken, and the second was worse than doing nothing:
//
//   • The visible link required a SESSION. A recipient who is not logged in
//     (the exact person most likely to want out) landed on a sign-in wall.
//     CAN-SPAM §7704(a)(3) wants an opt-out that does not condition itself on
//     anything beyond the address and an optional preference choice.
//   • The header promised RFC 8058 one-click. Gmail and Apple Mail take that
//     promise literally: they render their own "Unsubscribe" control, and on
//     a tap they POST `List-Unsubscribe=One-Click` to that URL and then tell
//     the user they are unsubscribed. That URL was a static SPA route. The
//     POST hit a CDN, changed nothing, and the recipient was told a lie by
//     their own mail client — so the next campaign arrived anyway and earned
//     a spam complaint instead of an opt-out. A `List-Unsubscribe-Post`
//     header pointed at anything that is not a real handler is a
//     deliverability liability, not a feature.
//   • `email_unsubscribe_tokens` — the table that was supposed to back a
//     token link — was DROPPED as unused scaffold in migration
//     20260830072801. Nothing has replaced it. This module is stateless
//     instead: the token is an HMAC, so there is no table to reintroduce.
//
// WHAT AN UNSUBSCRIBE ACTUALLY DOES HERE — AND WHAT IT MUST NOT DO
// ----------------------------------------------------------------
// Opting out of commercial mail sets TWO reversible preference flags:
//     profiles.marketing_consent                  -> false
//     notification_preferences.email_promotions   -> false
//
// It deliberately does NOT write `suppressed_emails`. That table is the HARD
// suppression list for bounces and spam complaints and it is checked by the
// TRANSACTIONAL send paths too (send-notification-email, engagement-
// automations). Recording a commercial opt-out there would also stop the
// recipient's payout notifications, job updates and security mail — which is
// both wrong for the user and not what they asked for. The separation is
// structural, not a convention: see `commercialConsentFilter` below and the
// comment above the suppression read in each sender.
//
// The flags are reversible on purpose (the confirmation page offers "resubscribe"),
// where a `suppressed_emails` row is append-only and permanent.

import { getAppUrl } from './appUrl.ts'

/**
 * Signing key for unsubscribe tokens.
 *
 * `EMAIL_UNSUBSCRIBE_SECRET` if the owner sets a dedicated one; otherwise
 * `CRON_SECRET`, which is already required by this project and is what
 * `email-tracking` signs its pixel URLs with. Rotating either invalidates
 * every outstanding link, so prefer the dedicated secret if you ever need to
 * rotate the cron one.
 */
function signingSecret(): string {
  return Deno.env.get('EMAIL_UNSUBSCRIBE_SECRET') ?? Deno.env.get('CRON_SECRET') ?? ''
}

/**
 * Base URL of the edge-function gateway.
 *
 * `SUPABASE_URL` is injected into every edge function by the platform. The
 * literal fallback is the same project host `LOGO_URL` hardcodes, so a
 * template rendered outside the runtime (the local render harness) still
 * produces a real, clickable link rather than `undefined/functions/v1/...`.
 */
function functionsBase(): string {
  const base = Deno.env.get('SUPABASE_URL') ?? 'https://fncmgoasalhdgfwzhsqa.supabase.co'
  return `${base.replace(/\/+$/, '')}/functions/v1`
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Version prefix in the signed payload.
 *
 * It is inside the HMAC, so a future change to what a token means (binding a
 * user id, adding an expiry) can bump this and every old token stops
 * verifying instead of being silently reinterpreted.
 */
const TOKEN_VERSION = 'unsub.v1'

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return toBase64Url(new Uint8Array(sig))
}

/** Constant-time compare — a token check must not leak a prefix by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Addresses are compared and signed lowercased — mailbox case is not identity here. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Build the recipient's one-click unsubscribe URL.
 *
 * Returns `null` when no signing secret is configured, so the caller can fall
 * back to the preferences page rather than mailing a link that cannot verify.
 * `MarketingFooter` and `unsubscribeHeaders()` both handle the null.
 */
export async function buildUnsubscribeUrl(email: string): Promise<string | null> {
  const secret = signingSecret()
  if (!secret) {
    console.error(
      '[unsubscribe] no EMAIL_UNSUBSCRIBE_SECRET or CRON_SECRET — falling back to the preferences page, so one-click unsubscribe is NOT available',
    )
    return null
  }
  const normalized = normalizeEmail(email)
  if (!normalized.includes('@')) return null

  const e = toBase64Url(new TextEncoder().encode(normalized))
  const sig = await hmac(secret, `${TOKEN_VERSION}:${normalized}`)
  return `${functionsBase()}/email-unsubscribe?e=${e}&sig=${sig}`
}

/**
 * Verify a token from an unsubscribe request.
 *
 * Returns the normalized email address, or `null` for a missing/mangled/
 * forged token. A `null` signing secret also returns `null` — the handler
 * turns that into a 503 rather than a silent no-op, because an unsubscribe
 * that quietly fails is the failure mode this whole module exists to end.
 */
export async function verifyUnsubscribeToken(
  e: string | null,
  sig: string | null,
): Promise<string | null> {
  const secret = signingSecret()
  if (!secret || !e || !sig) return null

  let normalized: string
  try {
    normalized = normalizeEmail(new TextDecoder().decode(fromBase64Url(e)))
  } catch {
    return null
  }
  if (!normalized.includes('@')) return null

  const expected = await hmac(secret, `${TOKEN_VERSION}:${normalized}`)
  return timingSafeEqual(sig, expected) ? normalized : null
}

/** True when a signing secret exists — the handler's 503 precondition. */
export function unsubscribeSigningConfigured(): boolean {
  return signingSecret().length > 0
}

/**
 * `List-Unsubscribe` / `List-Unsubscribe-Post` for COMMERCIAL mail.
 *
 * Gmail and Apple Mail render their own unsubscribe control above the message
 * when these are present, which is both the control a recipient actually
 * reaches for and a measurable deliverability signal.
 *
 * Pass the recipient's address. With one, the https URI is that recipient's
 * signed one-click endpoint and `List-Unsubscribe-Post` is set, which is the
 * RFC 8058 contract: a POST to that URI unsubscribes with no further
 * interaction. WITHOUT one — or with no signing secret — the https URI falls
 * back to the preferences page and `List-Unsubscribe-Post` is OMITTED,
 * because advertising one-click against a page that cannot honour a POST is
 * exactly the defect described at the top of this file.
 *
 * NEVER set these on transactional mail: a mail client that sees them may
 * offer to unsubscribe from a receipt or a security notice.
 */
export async function unsubscribeHeaders(recipientEmail?: string): Promise<Record<string, string>> {
  // NO mailto. CAN-SPAM permits a manual opt-out mechanism only if a human
  // honours it within 10 business days, and nothing in this repo reads that
  // mailbox — so advertising it promised a channel nobody was listening on,
  // which is worse than not offering one. The signed one-click URL below is
  // verified working end to end (GET and POST both flip the flags, a forged
  // signature 400s, an unknown address writes nothing), so the opt-out half of
  // CAN-SPAM is satisfied without it. Owner's call, 2026-08-31.
  const oneClick = recipientEmail ? await buildUnsubscribeUrl(recipientEmail) : null

  if (!oneClick) {
    return {
      'List-Unsubscribe': `<${getAppUrl()}/profile?tab=notifications>`,
    }
  }
  return {
    'List-Unsubscribe': `<${oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * The consent columns a COMMERCIAL send must respect, in one place so a new
 * campaign path cannot invent its own idea of "opted in".
 *
 *   profiles.marketing_consent            explicit opt-in ticked at signup
 *                                         (DEFAULT false — see migration
 *                                         20260708011322, which chose
 *                                         fail-closed deliberately)
 *   notification_preferences.email_promotions
 *                                         the in-app "Promotions" toggle, and
 *                                         what this unsubscribe handler flips
 *
 * Both are checked by every commercial sender. Neither is consulted by any
 * transactional sender — that is the separation that keeps a digest opt-out
 * from silencing a payout email.
 */
export const COMMERCIAL_CONSENT_COLUMNS = {
  profiles: 'marketing_consent',
  preferences: 'email_promotions',
} as const
