/**
 * str-ical-sync — fetch iCal feeds for active STR calendar connections,
 * detect guest checkouts in the next 7 days, and auto-create cleaning jobs.
 *
 * Invocation:
 *   - POST with empty body  → syncs ALL active connections
 *   - POST { connection_id } → syncs a single connection (manual "sync now")
 *   - Cron (Authorization: Bearer <CRON_SECRET>) → syncs all active
 *
 * SCHEDULED by migration 20260831193040 — every six hours at minute :44.
 * Until that migration it existed in no cron.schedule call and no workflow, so
 * this header described a cron that had never run: STR calendars only synced
 * when a host opened Settings and tapped "Sync now". Anything that changes the
 * schedule must change it there, not here.
 *
 * Idempotent: str_processed_events has a UNIQUE(connection_id, event_uid)
 * constraint — re-running never duplicates jobs.
 */

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { cronError, cronResult, defectTracker } from '../_shared/cron-result.ts';

// SECRET_KEY first, matching every other cron-invoked function here
// (auto-expire-jobs, cleanup-notifications, …). Reading only the legacy
// SUPABASE_SERVICE_ROLE_KEY is the exact shape of the mismatch that 401'd five
// cron-invoked functions in May — see migration 20260505220500.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
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

  // Defect counter for the cron watcher. Counts work that was SUPPOSED to
  // happen and didn't because something is broken — a feed we couldn't fetch, a
  // job insert the DB rejected, a processed-event row that failed to record. It
  // does NOT count business outcomes; see _shared/cron-result.ts.
  const defects = defectTracker();

  const { data: connections, error: connError } = await query;
  if (connError || !connections) {
    console.error('Failed to fetch STR connections:', connError);
    return cronError('str-ical-sync', `failed to fetch connections: ${connError?.message ?? 'no rows'}`, corsHeaders);
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
            defects.record(`${conn.id}: cleaning job insert failed: ${jobError.message}`);
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
            // Real defect, not cosmetic: str_processed_events IS the dedup
            // guard, so a job created without its row gets created again on the
            // next run — a duplicate cleaning job the host pays for.
            defects.record(`${conn.id}: processed-event insert failed for ${event.uid}: ${peError.message}`);
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
      defects.record(`${conn.id}: ${errMsg}`);
      await supabase
        .from('str_calendar_connections')
        .update({ last_sync_error: errMsg })
        .eq('id', conn.id);
      results.push({ connection_id: conn.id, error: errMsg });
    }
  }

  // NB: `body` is already taken by the request payload above.
  const summary = { synced: results.length, results };

  // The cron path answers with the shared convention: `fn` so
  // sweep_silent_cron_failures / sweep_cron_http_failures can attribute the
  // response to THIS function rather than guessing by timestamp, and non-2xx
  // when the run dropped work. Before this the function always answered 200
  // with no `fn`, so a run that failed every connection was invisible to both
  // watchers.
  if (isInternal) return cronResult('str-ical-sync', summary, defects.defects, corsHeaders);

  // The manual "Sync now" path stays 200 and keeps the exact body shape
  // StrSettings.tsx reads. It checks `res.ok` FIRST and would replace the
  // specific per-connection error with a generic "(500) — try again?", so
  // borrowing the cron status code here would make the one caller who can act
  // on the reason stop seeing it. Browser fetches never reach
  // net._http_response, so no watcher is missing anything.
  return jsonResponse(
    { ok: defects.count === 0, fn: 'str-ical-sync', ...summary, defects: defects.count },
    200,
    corsHeaders,
  );
});
