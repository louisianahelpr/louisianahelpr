/**
 * str-ical-sync — fetch iCal feeds for active STR calendar connections,
 * detect guest checkouts in the next 7 days, and auto-create cleaning jobs.
 *
 * Invocation:
 *   - POST with empty body  → syncs ALL active connections
 *   - POST { connection_id } → syncs a single connection (manual "sync now")
 *   - Cron (Authorization: Bearer <CRON_SECRET>) → syncs all active
 *
 * Idempotent: str_processed_events has a UNIQUE(connection_id, event_uid)
 * constraint — re-running never duplicates jobs.
 */

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ---------------------------------------------------------------------------
// Simple iCal parser — no external dependency needed for our use case.
// Handles multi-line folded values (RFC 5545 §3.1) and the two date formats
// Airbnb / VRBO emit: YYYYMMDD (date-only) and YYYYMMDDTHHmmssZ (UTC datetime).
// ---------------------------------------------------------------------------
interface IcalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
}

function parseIcal(icalText: string): IcalEvent[] {
  // Unfold continuation lines (CRLF + whitespace → nothing)
  const unfolded = icalText.replace(/\r?\n[ \t]/g, '');
  const events: IcalEvent[] = [];
  const eventBlocks = unfolded.split(/BEGIN:VEVENT/);

  for (const block of eventBlocks.slice(1)) {
    const uid = block.match(/\nUID:([^\r\n]+)/)?.[1]?.trim() ?? '';
    const summary = block.match(/\nSUMMARY:([^\r\n]+)/)?.[1]?.trim() ?? '';
    // DTSTART / DTEND may carry VALUE=DATE or TZID parameters before the colon
    const dtstart = block.match(/\nDTSTART[^:]*:([^\r\n]+)/)?.[1]?.trim() ?? '';
    const dtend   = block.match(/\nDTEND[^:]*:([^\r\n]+)/)?.[1]?.trim() ?? '';

    if (uid && dtend) {
      events.push({ uid, summary, dtstart, dtend });
    }
  }
  return events;
}

/** Parse YYYYMMDD or YYYYMMDDTHHmmssZ into a local-date Date object. */
function parseIcalDate(icalDate: string): Date {
  const clean = icalDate.replace(/[TZ]/g, '');
  const year  = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1;
  const day   = parseInt(clean.slice(6, 8), 10);
  // Use UTC to avoid local-tz drift shifting the calendar day
  return new Date(Date.UTC(year, month, day));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  // Auth gate — two valid callers:
  //   1. Internal (cron / service role): CRON_SECRET or SERVICE_ROLE_KEY → may sync all or one connection
  //   2. User JWT: may only sync a specific connection they own (manual "sync now" from UI)
  // Without this gate any unauthenticated caller could trigger platform-wide iCal fetches
  // or auto-create cleaning jobs for connections they don't own.
  const cronSecret     = Deno.env.get('CRON_SECRET')
  const serviceRoleKey = Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader     = req.headers.get('Authorization') ?? ''
  const isInternal =
    (cronSecret     && authHeader === `Bearer ${cronSecret}`) ||
    (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`)

  let body: { connection_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  // All-connections sync is internal-only
  if (!body.connection_id && !isInternal) {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  // For user JWT callers, validate the token and extract their user id so we
  // can enforce ownership on the connection below.
  let callerUserId: string | null = null
  if (!isInternal) {
    if (!authHeader) return errorResponse('Unauthorized', 401, corsHeaders);
    const anonKey = Deno.env.get('PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      anonKey,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return errorResponse('Unauthorized', 401, corsHeaders);
    callerUserId = user.id
  }

  // Build query — optionally filter to a single connection for manual sync
  let query = supabase
    .from('str_calendar_connections')
    .select('*')
    .eq('is_active', true);

  if (body.connection_id) {
    query = query.eq('id', body.connection_id);
    // Enforce ownership for non-internal callers
    if (callerUserId) query = query.eq('user_id', callerUserId);
  }

  const { data: connections, error: connError } = await query;
  if (connError || !connections) {
    console.error('Failed to fetch STR connections:', connError);
    return errorResponse('failed to fetch connections', 500, corsHeaders);
  }

  const now        = new Date();
  const oneWeekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const results: Array<{ connection_id: string; jobs_created?: number; error?: string }> = [];

  for (const conn of connections) {
    try {
      // Fetch the iCal feed — 10 s timeout
      const icalResp = await fetch(conn.ical_url, {
        headers: { 'User-Agent': 'Louisiana-Helpr/1.0 iCal-Sync' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!icalResp.ok) throw new Error(`iCal fetch failed: ${icalResp.status}`);

      const icalText = await icalResp.text();
      const events   = parseIcal(icalText);

      let jobsCreated = 0;

      for (const event of events) {
        const checkoutDate = parseIcalDate(event.dtend);

        // Only process checkouts in the 7-day look-ahead window
        if (checkoutDate < now || checkoutDate > oneWeekOut) continue;
        // Skip Airbnb/VRBO "Blocked" / "Not available" pseudo-events
        const lc = event.summary.toLowerCase();
        if (lc.includes('blocked') || lc.includes('unavailable') || lc.includes('not available')) continue;

        // Dedup check — skip if already processed
        const { data: existing } = await supabase
          .from('str_processed_events')
          .select('id')
          .eq('connection_id', conn.id)
          .eq('event_uid', event.uid)
          .maybeSingle();

        if (existing) continue;

        // Auto-create cleaning job
        if (conn.auto_create_cleaning) {
          const checkoutDateStr = checkoutDate.toISOString().slice(0, 10);
          const propName = conn.property_name ?? 'property';
          const notes    = conn.cleaning_notes
            ? conn.cleaning_notes
            : 'Standard turnover clean — please message for door code.';

          const { data: job, error: jobError } = await supabase
            .from('jobs')
            .insert({
              customer_id:      conn.user_id,
              category:         'cleaning',
              title:            `STR cleaning — ${propName} checkout ${checkoutDateStr}`,
              description:      `Cleaning needed after guest checkout on ${checkoutDateStr}. ${notes}`,
              budget:           conn.cleaning_budget ?? 80,
              location:         conn.property_address ?? '',
              date_needed:      checkoutDateStr,
              status:           'open',
              is_auto_created:  true,
              is_flexible_schedule: false,
            })
            .select('id')
            .single();

          if (jobError) {
            console.error('Failed to create STR cleaning job:', jobError);
            continue;
          }

          // Record the event so we never create a second job for it
          const { error: peError } = await supabase.from('str_processed_events').insert({
            connection_id:  conn.id,
            event_uid:      event.uid,
            checkout_date:  checkoutDateStr,
            job_id:         job?.id ?? null,
          });
          if (peError) {
            console.error('Failed to record processed event:', peError);
          }

          jobsCreated++;
        }
      }

      // Update sync metadata
      await supabase
        .from('str_calendar_connections')
        .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
        .eq('id', conn.id);

      results.push({ connection_id: conn.id, jobs_created: jobsCreated });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`Sync error for connection ${conn.id}:`, errMsg);
      await supabase
        .from('str_calendar_connections')
        .update({ last_sync_error: errMsg })
        .eq('id', conn.id);
      results.push({ connection_id: conn.id, error: errMsg });
    }
  }

  return jsonResponse({ synced: results.length, results }, 200, corsHeaders);
});
