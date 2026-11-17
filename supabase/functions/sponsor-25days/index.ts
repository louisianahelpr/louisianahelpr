// sponsor-25days — the 25 Days of Louisiana Giveaways sign-up and its images
// (owner spec 2026-11-09). Public: brands sign up signed out.
//
//   POST (multipart: payload = JSON, logo = optional file)
//        The sign-up. Rate limited per address; honeypot (logged, never dropped); validated with the
//        same rules the page uses (_shared/sponsorSignup.ts); the per-day cap
//        is enforced by sponsor_create_signup under a lock. Then two emails:
//        a confirmation to the brand and the details to admin@.
//   POST ?action=founder_photo (multipart: photo)   admins only
//   GET  ?logo=<signup id>       a logo on the public sponsor wall (Confirmed
//                                AND OK to show AND shown); 404 otherwise
//   GET  ?logo=<id>&admin=1      any sign-up's logo, admins only (download)
//   GET  ?photo=founder          the founder photo, when one is set
//
// Dark until the sponsor_25days switch is on for the caller
// (sponsor_25days_on_for: Everyone -> anyone, Testers -> admins and test
// accounts). Off -> 404, one answer for every refusal.
//
// verify_jwt = false (config.toml) by necessity: the sign-up and the wall's
// <img> come from signed-out visitors. A forged token gets nothing: identity
// is only ever taken from a verified auth.getUser.
//
// Images: the bucket 'sponsor-logos' is PRIVATE with no storage policy, so
// only this function (service role) reads or writes it. SVG logos are served
// only as images: image/svg+xml with a sandbox CSP and nosniff, so a script
// inside one never runs even if the URL is opened directly, and the page
// shows them through <img>, where SVG scripts never run anyway.

import * as React from 'npm:react@18.3.1'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { FROM_DEFAULT, SUPPORT_EMAIL, sendWithResend } from '../_shared/resend.ts'
import { isTestRecipient } from '../_shared/testRecipient.ts'
import { renderEmail } from '../_shared/email-templates/render.ts'
import { SponsorAdminEmail, SponsorConfirmationEmail, type SponsorEmailSignup } from '../_shared/email-templates/sponsor-25days.tsx'
import { caughtMessage } from '../_shared/caughtMessage.ts'
import { SPONSOR_LIMITS, sniffLogoType, sponsorSignupsOpen, validateSponsorSignup } from '../_shared/sponsorSignup.ts'
import { serve } from '../_shared/buildStamp.ts'
import { writeAdminAudit } from '../_shared/adminAuditLog.ts'
import { postSlackOpsAlert } from '../_shared/slack-alerts.ts'

const BUCKET = 'sponsor-logos'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }
const TYPE_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const notFound = () => json({ error: 'not_found' }, 404)

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!)
}

/** The verified caller's id, or null (signed out, anon key, forged or expired token). */
async function verifiedUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!)
    const { data } = await anon.auth.getUser(auth.slice('Bearer '.length))
    return data?.user?.id ?? null
  } catch (e) {
    console.warn('[sponsor-25days] token not verified; treated as signed out:', caughtMessage(e))
    return null
  }
}

async function switchOn(admin: SupabaseClient, userId: string | null): Promise<boolean> {
  const { data, error } = await admin.rpc('sponsor_25days_on_for', { p_user_id: userId })
  if (error) {
    console.error('[sponsor-25days] switch read failed; treated as off:', error.message)
    return false
  }
  return data === true
}

async function isAdmin(admin: SupabaseClient, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' })
  if (error) {
    console.error('[sponsor-25days] admin check failed; refused:', error.message)
    return false
  }
  return data === true
}

function imageResponse(bytes: Blob, type: string, download: string | null): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': download ? 'private, no-store' : 'public, max-age=300',
  }
  if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`
  return new Response(bytes, { status: 200, headers })
}

async function serveObject(admin: SupabaseClient, path: string, download: string | null): Promise<Response> {
  const ext = path.split('.').pop() ?? ''
  const type = TYPE_BY_EXT[ext]
  if (!type) return notFound()
  const { data, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !data) return notFound()
  return imageResponse(data, type, download)
}

async function handleGet(req: Request, url: URL): Promise<Response> {
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 300, ipMaxRequests: 1200, keyPrefix: 'sponsor-days-img' })
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders)
  const admin = serviceClient()
  const userId = await verifiedUserId(req)
  if (!(await switchOn(admin, userId))) return notFound()

  if (url.searchParams.get('photo') === 'founder') {
    const { data, error } = await admin.rpc('sponsor_service_founder_photo')
    if (error || typeof data !== 'string' || !data) return notFound()
    return serveObject(admin, data, null)
  }
  const id = url.searchParams.get('logo') ?? ''
  if (!UUID_RE.test(id)) return notFound()
  const wantAdmin = url.searchParams.get('admin') === '1'
  if (wantAdmin && !(await isAdmin(admin, userId))) return notFound()
  const { data, error } = await admin.rpc('sponsor_service_logo_path', { p_signup_id: id, p_any: wantAdmin })
  if (error || typeof data !== 'string' || !data) return notFound()
  return serveObject(admin, data, wantAdmin ? `sponsor-logo-${id}.${data.split('.').pop()}` : null)
}

async function readImage(file: FormDataEntryValue | null, allowSvg: boolean): Promise<{ bytes: Uint8Array; type: string } | 'logoType' | 'logoSize' | null> {
  if (!file || typeof file === 'string') return null
  if (file.size === 0) return null
  if (file.size > SPONSOR_LIMITS.logoBytes) return 'logoSize'
  const bytes = new Uint8Array(await file.arrayBuffer())
  // The declared type is the browser's guess; the bytes decide.
  const sniffed = sniffLogoType(bytes.slice(0, 2048))
  if (!sniffed || (!allowSvg && sniffed === 'image/svg+xml')) return 'logoType'
  return { bytes, type: sniffed }
}

async function handleFounderPhoto(req: Request): Promise<Response> {
  const admin = serviceClient()
  const userId = await verifiedUserId(req)
  if (!(await isAdmin(admin, userId)) || !(await switchOn(admin, userId))) return notFound()
  const form = await req.formData().catch(() => null)
  const img = await readImage(form?.get('photo') ?? null, false)
  if (img === null || typeof img === 'string') return json({ error: 'invalid', fields: { photo: img ?? 'required' } }, 400)
  const path = `founder/${crypto.randomUUID()}.${EXT[img.type]}`
  // Immutable key (a fresh uuid per photo), so it caches a year.
  const up = await admin.storage.from(BUCKET).upload(path, img.bytes, { contentType: img.type, cacheControl: '31536000', upsert: false })
  if (up.error) {
    console.error('[sponsor-25days] founder photo upload failed:', up.error.message)
    return json({ error: 'upload_failed' }, 500)
  }
  const { error } = await admin.rpc('sponsor_service_set_founder_photo', { p_path: path })
  if (error) {
    await admin.storage.from(BUCKET).remove([path])
    console.error('[sponsor-25days] founder photo not recorded:', error.message)
    return json({ error: 'save_failed' }, 500)
  }
  // Q76: who changed the founder photo on the public sponsor page, and when.
  await writeAdminAudit(admin, {
    adminId: userId,
    action: 'sponsor_founder_photo_set',
    targetType: 'sponsor_settings',
    targetId: 'founder_photo',
    details: { path },
    source: 'sponsor-25days',
  }, postSlackOpsAlert)
  return json({ ok: true })
}

/**
 * Every sign-up POST that does NOT save a sign-up says why, where we can see it (2026-11-17: two real
 * sponsors were told "you're in" and nothing was saved). Two tiers:
 *   logNotCreated    the visitor was told why (invalid, full, closed, rate limited, switch off): the edge
 *                    log only, searchable as "sign-up NOT saved". Never error_logs: a server row there of any
 *                    severity posts to #ops-alerts and opens a ledger item (notify_slack_on_error_log,
 *                    ops_alert_ledger_from_error_log), and a typo in a form is not an alert.
 *   alertNotCreated  OUR fault (upload, save, crash): the edge log AND one error_logs row (severity error,
 *                    so it pages), because a real sponsor's sign-up was lost and someone must follow up.
 * No contact details in either: the brand name and the reason are enough to find them.
 */
function logNotCreated(reason: string, context: Record<string, unknown> = {}): void {
  console.warn(`[sponsor-25days] sign-up NOT saved: ${reason}`, JSON.stringify(context))
}

async function alertNotCreated(admin: SupabaseClient, reason: string, context: Record<string, unknown> = {}): Promise<void> {
  logNotCreated(reason, context)
  try {
    const { error } = await admin.from('error_logs').insert({
      severity: 'error',
      message: `sponsor sign-up not saved: ${reason}`,
      tags: { source: 'sponsor-25days', origin: 'server', reason },
      context,
    })
    if (error) console.error('[sponsor-25days] could not log the unsaved sign-up:', error.message)
  } catch (e) {
    console.error('[sponsor-25days] could not log the unsaved sign-up:', caughtMessage(e))
  }
}

function daysLabel(days: number[], anyDay: boolean): string {
  if (anyDay || days.length === 0) return 'Any day'
  if (days.length === 1) return `December ${days[0]}`
  return `December ${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
}

async function handleSignup(req: Request): Promise<Response> {
  // An open endpoint that writes a row and sends mail: 5 sign-ups per address per 15 minutes.
  const rl = await checkRateLimit(req, { windowMs: 15 * 60_000, maxRequests: 5, ipMaxRequests: 10, keyPrefix: 'sponsor-days-signup' })
  if (!rl.allowed) {
    logNotCreated('rate_limited')
    return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders)
  }

  const admin = serviceClient()
  const userId = await verifiedUserId(req)
  if (!(await switchOn(admin, userId))) {
    logNotCreated('switch_off')
    return notFound()
  }

  // After the sign-up deadline (Nov 28, Louisiana time) nothing new is saved.
  if (!sponsorSignupsOpen(Date.now())) {
    logNotCreated('closed')
    return json({ error: 'closed' }, 410)
  }

  const form = await req.formData().catch(() => null)
  if (!form) {
    logNotCreated('unreadable_form')
    return json({ error: 'invalid', fields: {} }, 400)
  }
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(String(form.get('payload') ?? ''))
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // A body that is not our JSON is a bad request, answered as one.
    logNotCreated('unreadable_payload')
    return json({ error: 'invalid', fields: {} }, 400)
  }

  // Honeypot: a signal only, NEVER a reason to drop. Browser autofill fills hidden fields (it ignores
  // autocomplete="off"), and on 2026-11-17 a filled honeypot answered real sponsors "ok" and saved nothing.
  // The rate limit above and the per-day cap stop a flood; a bot's row is visible on /admin/sponsors. A filled one
  // sends no confirmation to the address given (a bot must not make us mail strangers) and flags the admin email.
  const honeypotFilled = typeof raw.company_fax === 'string' && raw.company_fax.trim() !== ''

  const v = validateSponsorSignup(raw)
  if (!v.ok) {
    logNotCreated('invalid', { fields: v.errors, brand: typeof raw.brandName === 'string' ? raw.brandName.slice(0, 120) : null })
    return json({ error: 'invalid', fields: v.errors }, 400)
  }
  const s = v.value

  const img = await readImage(form.get('logo'), true)
  if (typeof img === 'string') {
    logNotCreated('invalid_logo', { logo: img, brand: s.brandName })
    return json({ error: 'invalid', fields: { logo: img } }, 400)
  }

  const signupId = crypto.randomUUID()
  let logoPath: string | null = null
  if (img) {
    logoPath = `signups/${signupId}.${EXT[img.type]}`
    // Immutable key (the sign-up's own uuid), so it caches a year.
    const up = await admin.storage.from(BUCKET).upload(logoPath, img.bytes, { contentType: img.type, cacheControl: '31536000', upsert: false })
    if (up.error) {
      console.error('[sponsor-25days] logo upload failed:', up.error.message)
      await alertNotCreated(admin, 'logo_upload_failed', { error: up.error.message, brand: s.brandName })
      return json({ error: 'upload_failed' }, 500)
    }
  }

  const { data, error } = await admin.rpc('sponsor_create_signup', {
    p_user_id: userId,
    p_signup: {
      id: signupId,
      brand_name: s.brandName,
      contact_name: s.contactName,
      email: s.email,
      phone: s.phone,
      website: s.website,
      instagram: s.instagram,
      facebook: s.facebook,
      tiktok: s.tiktok,
      prize_description: s.prizeDescription,
      prize_value: s.prizeValue,
      ship_to: s.shipTo,
      notes: s.notes,
      any_day: s.anyDay,
      days: s.days,
      wall_ok: s.showOnWall,
      logo_path: logoPath,
      ref_code: s.ref,
    },
  })
  const result = (data ?? {}) as { ok?: boolean; full_days?: number[]; days?: number[]; any_day?: boolean }
  if (error || result.ok !== true) {
    if (logoPath) await admin.storage.from(BUCKET).remove([logoPath])
    if (!error && Array.isArray(result.full_days)) {
      logNotCreated('days_full', { full_days: result.full_days, brand: s.brandName })
      return json({ error: 'full', full_days: result.full_days }, 409)
    }
    console.error('[sponsor-25days] sign-up not saved:', error?.message ?? JSON.stringify(result))
    await alertNotCreated(admin, 'save_failed', { error: error?.message ?? JSON.stringify(result), brand: s.brandName })
    return json({ error: 'save_failed' }, 500)
  }
  if (honeypotFilled) console.warn(`[sponsor-25days] honeypot filled (likely browser autofill); saved anyway: ${signupId}`)

  // Saved. The emails never undo a saved sign-up: a failure is logged, and the
  // sign-up is on /admin/sponsors either way.
  const emailSignup: SponsorEmailSignup = {
    brandName: s.brandName, contactName: s.contactName, email: s.email, phone: s.phone, website: s.website,
    instagram: s.instagram, facebook: s.facebook, tiktok: s.tiktok, prizeDescription: s.prizeDescription,
    prizeValue: s.prizeValue, shipTo: s.shipTo, notes: s.notes, daysLabel: daysLabel(s.days, s.anyDay),
    showOnWall: s.showOnWall, ref: s.ref,
  }
  await sendEmails(admin, emailSignup, logoPath, honeypotFilled)
  // The saved row's id, for the edge log and any later client check (the page today reads ok only).
  return json({ ok: true, id: signupId, days: s.days, any_day: s.anyDay })
}

async function sendEmails(admin: SupabaseClient, s: SponsorEmailSignup, logoPath: string | null, honeypotFilled: boolean): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    console.error('[sponsor-25days] RESEND_API_KEY not configured; no emails sent')
    return
  }
  if (honeypotFilled) console.warn('[sponsor-25days] honeypot filled; confirmation not sent, admin notice flagged')
  else await sendConfirmation(admin, key, s)
  await sendAdminNotice(admin, key, s, logoPath, honeypotFilled)
}

// Q840: a fixture/test address is never mailed (each send asks for itself).
async function sendConfirmation(admin: SupabaseClient, key: string, s: SponsorEmailSignup): Promise<void> {
  try {
    if (await isTestRecipient(admin, s.email)) {
      console.log('[sponsor-25days] test address; confirmation not sent (Q840)')
      return
    }
    const { html, text } = await renderEmail(React.createElement(SponsorConfirmationEmail, { s, adminEmail: SUPPORT_EMAIL }))
    await sendWithResend(key, { to: s.email, from: FROM_DEFAULT, subject: "You're in! 25 Days of Louisiana Giveaways 🎄", html, text, replyTo: SUPPORT_EMAIL })
  } catch (e) {
    console.error('[sponsor-25days] confirmation email failed:', caughtMessage(e))
  }
}

// Q840 / Q137: a test address's sign-up is not sent to admin@ either.
async function sendAdminNotice(admin: SupabaseClient, key: string, s: SponsorEmailSignup, logoPath: string | null, honeypotFilled: boolean): Promise<void> {
  try {
    if (await isTestRecipient(admin, s.email)) {
      console.log('[sponsor-25days] test address; admin notice not sent (Q840)')
      return
    }
    let logoUrl: string | null = null
    if (logoPath) {
      const signed = await admin.storage.from(BUCKET).createSignedUrl(logoPath, 7 * 24 * 3600, { download: true })
      logoUrl = signed.data?.signedUrl ?? null
    }
    const { html, text } = await renderEmail(React.createElement(SponsorAdminEmail, { s, logoUrl }))
    await sendWithResend(key, { to: SUPPORT_EMAIL, from: FROM_DEFAULT, subject: `${honeypotFilled ? '[Check: hidden field filled, maybe a bot; no confirmation sent] ' : ''}New 25 Days sponsor: ${s.brandName} (${s.daysLabel})`, html, text, replyTo: s.email })
  } catch (e) {
    console.error('[sponsor-25days] admin email failed:', caughtMessage(e))
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    if (req.method === 'GET') return await handleGet(req, url)
    if (req.method === 'POST') {
      if (url.searchParams.get('action') === 'founder_photo') return await handleFounderPhoto(req)
      try {
        return await handleSignup(req)
      } catch (e) {
        // A crash mid sign-up loses a real sponsor's entry: it pages, like a failed save.
        await alertNotCreated(serviceClient(), 'crashed', { error: caughtMessage(e) })
        return json({ error: 'server_error' }, 500)
      }
    }
    return json({ error: 'method_not_allowed' }, 405)
  } catch (e) {
    console.error('[sponsor-25days] unexpected error:', caughtMessage(e))
    return json({ error: 'server_error' }, 500)
  }
})
