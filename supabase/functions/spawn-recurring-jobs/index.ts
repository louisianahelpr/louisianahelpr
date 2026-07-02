// Daily cron: spawn child jobs from recurring parents.
//
// Model: a job posted with is_recurring=true is BOTH the first instance
// AND the template. Children link back via parent_job_id. Each cron run
// looks at every recurring parent and spawns the next-due child if its
// computed date_needed falls within a 7-day lookahead window — that gives
// helpers time to discover + apply before the work date.
//
// Stop conditions:
//   - parent.recurrence_end_date is set and the next due date passes it
//   - parent has been cancelled / expired (status check)
//
// Idempotency (single-scheduler): each run counts existing children and
// only spawns if the next-due slot falls within the lookahead window; once
// today's child exists the count advances the next slot past the horizon, so
// a sequential re-run no-ops. NOTE this is a read-then-write guard, not a DB
// constraint — two *concurrent* invocations (scheduled run + manual admin
// re-trigger overlapping) could both read the same count and double-insert.
// The scheduled cron is single-threaded so this doesn't happen in practice;
// a partial unique index on jobs(parent_job_id, date_needed) + upsert would
// close it hard if the job ever runs concurrently. Children are 'open' with
// no escrow, so a duplicate is a stray job, not a money event.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyCronSecret } from '../_shared/cron-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INTERVAL_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

const LOOKAHEAD_DAYS = 7;

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    (Deno.env.get('SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) ?? '',
  );

  const today = todayUTC();
  const horizon = addDays(today, LOOKAHEAD_DAYS);

  // Active recurring parents: not children themselves, still in their
  // recurrence window, not cancelled / expired.
  const { data: parents, error: parentsErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('is_recurring', true)
    .is('parent_job_id', null)
    .not('status', 'in', '(cancelled,expired)')
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${today}`);

  if (parentsErr) {
    console.error('Failed to load recurring parents', parentsErr);
    return new Response(JSON.stringify({ error: parentsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let spawned = 0;
  let skippedNoInterval = 0;
  let skippedFuture = 0;
  let skippedPastEnd = 0;
  let errors = 0;

  for (const parent of parents ?? []) {
    const intervalDays = INTERVAL_DAYS[parent.recurrence_interval as string];
    if (!intervalDays || !parent.date_needed) {
      skippedNoInterval++;
      continue;
    }

    // How many children have we already spawned?
    const { count: childCount } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('parent_job_id', parent.id);

    // Next-due date = parent.date_needed + interval × (count + 1).
    // Indexes children sequentially so missed runs catch up correctly:
    // if cron skipped a day, the next run computes the right next slot.
    const nextDueDate = addDays(parent.date_needed, intervalDays * ((childCount ?? 0) + 1));

    if (parent.recurrence_end_date && nextDueDate > parent.recurrence_end_date) {
      skippedPastEnd++;
      continue;
    }
    if (nextDueDate > horizon) {
      skippedFuture++;
      continue;
    }

    // Spawn child. Copy operationally-relevant parent fields, drop
    // identity / state / recurrence-template fields. A sequential re-run
    // before the next interval no-ops because the count check above advances
    // nextDueDate past the horizon (see the concurrency caveat in the header).
    const child: Record<string, unknown> = {
      customer_id: parent.customer_id,
      business_id: parent.business_id,
      title: parent.title,
      description: parent.description,
      category: parent.category,
      budget: parent.budget,
      date_needed: nextDueDate,
      start_time: parent.start_time,
      location: parent.location,
      parish: parent.parish,
      zip_code: parent.zip_code,
      latitude: parent.latitude,
      longitude: parent.longitude,
      estimated_hours: parent.estimated_hours,
      special_requirements: parent.special_requirements,
      photos: parent.photos,
      is_urgent: false,
      urgent_fee: null,
      is_flexible_schedule: parent.is_flexible_schedule,
      is_group_job: parent.is_group_job,
      helpers_needed: parent.helpers_needed,
      is_recurring: false,        // child is a real job, not another template
      recurrence_interval: null,
      recurrence_end_date: null,
      parent_job_id: parent.id,
      status: 'open',
    };

    const { error: insertErr } = await supabase.from('jobs').insert(child);
    if (insertErr) {
      console.error(`Failed to spawn child for parent ${parent.id}`, insertErr);
      errors++;
      continue;
    }
    spawned++;
  }

  return new Response(
    JSON.stringify({
      processed: parents?.length ?? 0,
      spawned,
      skippedNoInterval,
      skippedFuture,
      skippedPastEnd,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
