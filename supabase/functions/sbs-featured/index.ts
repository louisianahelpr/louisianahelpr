// sbs-featured — Small Business Saturday free "Featured local" listings (owner 2026-11-20).
// Public: Louisiana businesses ask to be listed while signed out.
//
//   POST (multipart: payload = JSON, logo = optional PNG/JPEG/WebP file)
//        The request. Rate limited per address AND per device; validated with the same rules the page uses
//        (_shared/sbsSubmission.ts: fields, profanity, link spam, motels and inns); the link must load (checked here,
//        server side); then sbs_service_create checks the town is in Louisiana, duplicates and the per-email cap,
//        and saves it PENDING. Nothing shows on the page until an admin approves it (/admin/sponsors).
//   GET  ?logo=<id>            an APPROVED listing's logo; 404 otherwise
//   GET  ?logo=<id>&admin=1    any listing's logo, admins only (the review card)
//
// verify_jwt = false (config.toml) by necessity: the form and the <img> come from signed-out visitors. Identity is only
// ever taken from a verified auth.getUser (admin logo path).
//
// The contact email is saved for admins only and never sent back. No email goes out from here, so a test submission
// never reaches anyone; a test address's row is also left out of the admin list and the public page.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFull as corsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { caughtMessage } from '../_shared/caughtMessage.ts'
import { SBS_LIMITS, cleanLink, isPrivateAddress, linkStatusOk, sniffSbsLogo, validateSbsSubmission } from '../_shared/sbsSubmission.ts'
import { serve } from '../_shared/buildStamp.ts'

const BUCKET = 'sbs-logos'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const TYPE_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/
const MAX_BODY_BYTES = 2_300_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const notFound = () => json({ error: 'not_found' }, 404)

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!)
}

async function verifiedUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'))!)
    const { data } = await anon.auth.getUser(auth.slice('Bearer '.length))
    return data?.user?.id ?? null
  } catch (e) {
    console.warn('[sbs-featured] token not verified; treated as signed out:', caughtMessage(e))
    return null
  }
}

async function isAdmin(admin: SupabaseClient, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' })
  if (error) {
    console.error('[sbs-featured] admin check failed; refused:', error.message)
    return false
  }
  return data === true
}

async function handleGet(req: Request, url: URL): Promise<Response> {
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 300, ipMaxRequests: 1200, keyPrefix: 'sbs-featured-img' })
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders)
  const id = url.searchParams.get('logo') ?? ''
  if (!UUID_RE.test(id)) return notFound()
  const admin = serviceClient()
  const wantAdmin = url.searchParams.get('admin') === '1'
  if (wantAdmin && !(await isAdmin(admin, await verifiedUserId(req)))) return notFound()
  const { data: path, error } = await admin.rpc('sbs_service_logo_path', { p_id: id, p_any: wantAdmin })
  if (error || typeof path !== 'string' || !path) return notFound()
  const type = TYPE_BY_EXT[path.split('.').pop() ?? '']
  if (!type) return notFound()
  const { data, error: dlError } = await admin.storage.from(BUCKET).download(path)
  if (dlError || !data) return notFound()
  return new Response(data, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': wantAdmin ? 'private, no-store' : 'public, max-age=300',
    },
  })
}

/**
 * Does the link load? GET (many sites refuse HEAD), body never read, 6 s cap for the whole check. Redirects are
 * followed BY HAND, at most 3, and every hop must pass cleanLink again (https, a public-looking host, no IP, no
 * localhost, no shortener), so a public link cannot bounce the server to an internal address (security review
 * 2026-11-20 #1). A network, DNS or TLS failure, a refused hop, or a 404/410 means no.
 */
async function linkResolves(link: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    let url = link
    for (let hop = 0; hop <= 3; hop++) {
      if (!(await resolvesPublic(new URL(url).hostname))) return false
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LouisianaHelprLinkCheck/1.0; +https://louisianahelpr.com)', Accept: 'text/html,*/*' },
      })
      await res.body?.cancel().catch(() => undefined)
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        let next: string | null = null
        try {
          next = cleanLink(new URL(loc, url).toString())
        } catch {
          // An unparseable Location: treated as a refused hop.
          next = null
        }
        if (!next) return false
        url = next
        continue
      }
      return linkStatusOk(res.status)
    }
    return false
  } catch (e) {
    console.warn('[sbs-featured] link did not load:', caughtMessage(e))
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Every address the name resolves to (A and AAAA) must be public; a name that resolves to nothing, or to any
 * private/loopback/link-local address, is refused before the server fetches it (security review 2026-11-20).
 */
async function resolvesPublic(host: string): Promise<boolean> {
  const addrs: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    try {
      addrs.push(...(await Deno.resolveDns(host, type)))
    } catch {
      // No record of this type (or DNS failed for it): the other type, or none at all, decides below.
    }
  }
  return addrs.length > 0 && !addrs.some(isPrivateAddress)
}

/** Our fault (upload, save): the edge log AND one error_logs row, because a real business's request was lost. */
async function alertNotSaved(admin: SupabaseClient, email: string, reason: string, context: Record<string, unknown> = {}): Promise<void> {
  logNotSaved(reason, context)
  // Test data never alerts the owner: a test address's failure stays in the edge log only.
  const { data: seed, error: seedError } = await admin.rpc('is_seed_email', { p_email: email })
  if (seedError) console.warn('[sbs-featured] seed check failed; alerting anyway:', seedError.message)
  if (seed === true) return
  try {
    const { error } = await admin.from('error_logs').insert({
      severity: 'error',
      message: `small business listing not saved: ${reason}`,
      tags: { source: 'sbs-featured', origin: 'server', reason },
      context,
    })
    if (error) console.error('[sbs-featured] could not log the unsaved listing:', error.message)
  } catch (e) {
    console.error('[sbs-featured] could not log the unsaved listing:', caughtMessage(e))
  }
}

async function removeLogo(admin: SupabaseClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).remove([path])
  if (error) console.error(`[sbs-featured] orphan logo left at ${path}:`, error.message)
}

function logNotSaved(reason: string, context: Record<string, unknown> = {}): void {
  // The edge log only: a typo in a public form is not an alert (never error_logs, which pages #ops-alerts).
  console.warn(`[sbs-featured] listing NOT saved: ${reason}`, JSON.stringify(context))
}

async function handleSubmit(req: Request): Promise<Response> {
  // Per address: 5 per 15 minutes (wide 15).
  const rl = await checkRateLimit(req, { windowMs: 15 * 60_000, maxRequests: 5, ipMaxRequests: 15, keyPrefix: 'sbs-featured-submit' })
  if (!rl.allowed) {
    logNotSaved('rate_limited')
    return rateLimitResponse(rl.retryAfter ?? 300, corsHeaders)
  }
  // A body bigger than a 2 MB logo plus the fields is refused before it is read.
  const length = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    logNotSaved('too_large', { length })
    return json({ error: 'too_large' }, 413)
  }
  const form = await req.formData().catch(() => null)
  if (!form) return json({ error: 'invalid', fields: {} }, 400)
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(String(form.get('payload') ?? ''))
    raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // Not our JSON: a bad request, answered as one.
    return json({ error: 'invalid', fields: {} }, 400)
  }
  // Per device (the page's random id, sent in the payload): 3 per 15 minutes.
  const device = typeof raw.device === 'string' ? raw.device : ''
  if (DEVICE_RE.test(device)) {
    const rd = await checkRateLimit(req, { windowMs: 15 * 60_000, maxRequests: 3, ipMaxRequests: 15, keyPrefix: 'sbs-featured-device', subject: `device:${device}` })
    if (!rd.allowed) {
      logNotSaved('rate_limited_device')
      return rateLimitResponse(rd.retryAfter ?? 300, corsHeaders)
    }
  }
  // No honeypot: browser autofill fills hidden fields, and a dropped honeypot row once lost real sponsors
  // (2026-11-17). Every row waits for an admin anyway, and the rate limits stop a flood.
  const v = validateSbsSubmission(raw)
  if (!v.ok) {
    logNotSaved('invalid', { fields: v.errors })
    return json({ error: 'invalid', fields: v.errors }, 400)
  }
  const s = v.value

  let img: { bytes: Uint8Array; type: string } | null = null
  const file = form.get('logo')
  if (file && typeof file !== 'string' && file.size > 0) {
    if (file.size > SBS_LIMITS.logoBytes) return json({ error: 'invalid', fields: { logo: 'logoSize' } }, 400)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffSbsLogo(bytes.slice(0, 16))
    if (!type) return json({ error: 'invalid', fields: { logo: 'logoType' } }, 400)
    img = { bytes, type }
  }

  if (!(await linkResolves(s.link))) {
    logNotSaved('link_dead', { name: s.businessName })
    return json({ error: 'invalid', fields: { link: 'dead' } }, 400)
  }

  const admin = serviceClient()
  const id = crypto.randomUUID()
  let logoPath: string | null = null
  if (img) {
    logoPath = `submissions/${id}.${EXT[img.type]}`
    const up = await admin.storage.from(BUCKET).upload(logoPath, img.bytes, { contentType: img.type, cacheControl: '31536000', upsert: false })
    if (up.error) {
      await alertNotSaved(admin, s.contactEmail, 'logo_upload_failed', { error: up.error.message, name: s.businessName })
      return json({ error: 'upload_failed' }, 500)
    }
  }

  const { data, error } = await admin.rpc('sbs_service_create', {
    p_row: {
      id,
      business_name: s.businessName,
      town: s.town,
      category: s.category,
      link: s.link,
      deal: s.deal,
      logo_path: logoPath,
      contact_email: s.contactEmail,
      participating: s.participating,
    },
  })
  const result = (data ?? {}) as { ok?: boolean; reason?: string }
  if (error || result.ok !== true) {
    if (logoPath) await removeLogo(admin, logoPath)
    if (!error && typeof result.reason === 'string') {
      logNotSaved(result.reason, { name: s.businessName })
      if (result.reason === 'town') return json({ error: 'invalid', fields: { town: 'town' } }, 400)
      if (result.reason === 'category') return json({ error: 'invalid', fields: { category: 'category' } }, 400)
      if (result.reason === 'lodging') return json({ error: 'invalid', fields: { businessName: 'lodging' } }, 400)
      if (result.reason === 'duplicate') return json({ error: 'duplicate' }, 409)
      if (result.reason === 'rate') return json({ error: 'rate_limited' }, 429)
    }
    await alertNotSaved(admin, s.contactEmail, 'save_failed', { error: error?.message ?? JSON.stringify(result), name: s.businessName })
    return json({ error: 'save_failed' }, 500)
  }
  return json({ ok: true })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    if (req.method === 'GET') return await handleGet(req, url)
    if (req.method === 'POST') return await handleSubmit(req)
    return json({ error: 'method_not_allowed' }, 405)
  } catch (e) {
    console.error('[sbs-featured] unexpected error:', caughtMessage(e))
    return json({ error: 'server_error' }, 500)
  }
})
