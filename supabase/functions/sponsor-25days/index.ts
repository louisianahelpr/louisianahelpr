// sponsor-25days — the 25 Days of Louisiana Giveaways sign-up and its images
// (owner spec 2026-11-09). Public: brands sign up signed out.
//
//   POST (multipart: payload = JSON, logo = optional file)
//        The sign-up. Rate limited per address; honeypot; validated with the
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
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 300, ipMaxRequests: 1200, keyPrefix: 'sponsor-25days-img' })
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
  return json({ ok: true })
}

function daysLabel(days: number[], anyDay: boolean): string {
  if (anyDay || days.length === 0) return 'Any day'
  if (days.length === 1) return `December ${days[0]}`
  return `December ${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
}

async function handleSignup(req: Request): Promise<Response> {
  // An open endpoint that writes a row and sends mail: 5 sign-ups per address per 15 minutes.
  const rl = await checkRateLimit(req, { windowMs: 15 * 60_000, maxRequests: 5, ipMaxRequests: 10, keyPrefix: 'sponsor-25days-signup' })
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders)

  const admin = serviceClient()
  const userId = await verifiedUserId(req)
  if (!(await switchOn(admin, userId))) return notFound()

  // After the sign-up deadline (Nov 30, Louisiana time) nothing new is saved.
  if (!sponsorSignupsOpen(Date.now())) return json({ error: 'closed' }, 410)

  const form = await req.formData().catch(() => null)
  if (!form) return json({ error: 'invalid', fields: {} }, 400)
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(String(form.get('payload') ?? ''))
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // A body that is not our JSON is a bad request, answered as one.
    return json({ error: 'invalid', fields: {} }, 400)
  }

  // Honeypot: a person never sees the field. A bot that fills it is told "ok" and nothing is saved or sent.
  if (typeof raw.company_fax === 'string' && raw.company_fax.trim() !== '') {
    console.log('[sponsor-25days] honeypot filled; dropped')
    return json({ ok: true, days: [], any_day: true })
  }

  const v = validateSponsorSignup(raw)
  if (!v.ok) return json({ error: 'invalid', fields: v.errors }, 400)
  const s = v.value

  const img = await readImage(form.get('logo'), true)
  if (typeof img === 'string') return json({ error: 'invalid', fields: { logo: img } }, 400)

  const signupId = crypto.randomUUID()
  let logoPath: string | null = null
  if (img) {
    logoPath = `signups/${signupId}.${EXT[img.type]}`
    // Immutable key (the sign-up's own uuid), so it caches a year.
    const up = await admin.storage.from(BUCKET).upload(logoPath, img.bytes, { contentType: img.type, cacheControl: '31536000', upsert: false })
    if (up.error) {
      console.error('[sponsor-25days] logo upload failed:', up.error.message)
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
    if (!error && Array.isArray(result.full_days)) return json({ error: 'full', full_days: result.full_days }, 409)
    console.error('[sponsor-25days] sign-up not saved:', error?.message ?? JSON.stringify(result))
    return json({ error: 'save_failed' }, 500)
  }

  // Saved. The emails never undo a saved sign-up: a failure is logged, and the
  // sign-up is on /admin/sponsors either way.
  const emailSignup: SponsorEmailSignup = {
    brandName: s.brandName, contactName: s.contactName, email: s.email, phone: s.phone, website: s.website,
    instagram: s.instagram, facebook: s.facebook, tiktok: s.tiktok, prizeDescription: s.prizeDescription,
    prizeValue: s.prizeValue, shipTo: s.shipTo, notes: s.notes, daysLabel: daysLabel(s.days, s.anyDay),
    showOnWall: s.showOnWall, ref: s.ref,
  }
  await sendEmails(admin, emailSignup, logoPath)
  return json({ ok: true, days: s.days, any_day: s.anyDay })
}

async function sendEmails(admin: SupabaseClient, s: SponsorEmailSignup, logoPath: string | null): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    console.error('[sponsor-25days] RESEND_API_KEY not configured; no emails sent')
    return
  }
  // Q840: a fixture/test address is never mailed, and its sign-up is not sent to admin@ either.
  if (await isTestRecipient(admin, s.email)) {
    console.log('[sponsor-25days] test address; emails not sent (Q840)')
    return
  }
  try {
    const { html, text } = await renderEmail(React.createElement(SponsorConfirmationEmail, { s, adminEmail: SUPPORT_EMAIL }))
    await sendWithResend(key, { to: s.email, from: FROM_DEFAULT, subject: "You're in! 25 Days of Louisiana Giveaways 🎄", html, text, replyTo: SUPPORT_EMAIL })
  } catch (e) {
    console.error('[sponsor-25days] confirmation email failed:', caughtMessage(e))
  }
  try {
    let logoUrl: string | null = null
    if (logoPath) {
      const signed = await admin.storage.from(BUCKET).createSignedUrl(logoPath, 7 * 24 * 3600, { download: true })
      logoUrl = signed.data?.signedUrl ?? null
    }
    const { html, text } = await renderEmail(React.createElement(SponsorAdminEmail, { s, logoUrl }))
    await sendWithResend(key, { to: SUPPORT_EMAIL, from: FROM_DEFAULT, subject: `New 25 Days sponsor: ${s.brandName} (${s.daysLabel})`, html, text, replyTo: s.email })
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
      return await handleSignup(req)
    }
    return json({ error: 'method_not_allowed' }, 405)
  } catch (e) {
    console.error('[sponsor-25days] unexpected error:', caughtMessage(e))
    return json({ error: 'server_error' }, 500)
  }
})
