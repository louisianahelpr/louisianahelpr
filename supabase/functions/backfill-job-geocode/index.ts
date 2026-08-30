// Backstop for jobs.latitude/longitude.
//
// useJobSubmit.ts geocodes via Nominatim client-side, best-effort, capped
// at 2.5s so a slow/blocked lookup never stalls checkout (see the comment
// there and in src/lib/geocode.ts). That cap, plus Nominatim rate-limits
// and outages, means some open jobs land with null coords and never pin
// on /browse?view=map. There is no DB trigger that fills this in.
//
// This cron re-geocodes any OPEN job still missing coords, using the same
// Nominatim endpoint and address composition as the client path. Runs
// infrequently and serially — Nominatim's fair-use policy caps bulk use at
// 1 req/sec, so this sleeps between calls rather than firing in parallel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Keep well under one run's function-timeout budget — any leftovers pick
// up on the next scheduled run rather than risking a mid-batch kill.
const MAX_JOBS_PER_RUN = 30;
// Pulled in full, shuffled, then trimmed to MAX_JOBS_PER_RUN — see the
// shuffle comment below for why. Bounded well above MAX_JOBS_PER_RUN so
// the shuffle has enough of the queue to draw from without turning this
// into an unbounded select.
const CANDIDATE_POOL_SIZE = 200;
const NOMINATIM_DELAY_MS = 1100;

interface GeocodeResult {
  latitude: number;
  longitude: number;
}

async function geocodeAddress(address: string | null | undefined): Promise<GeocodeResult | null> {
  if (!address) return null;
  const cleaned = address.trim();
  if (cleaned.length < 5) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", cleaned);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        // Nominatim TOS requires a real User-Agent identifying the app for
        // server-side bulk callers (unlike the browser path, there's no
        // automatic Referer here).
        "User-Agent": "LouisianaHelpr/1.0 (backfill-job-geocode cron)",
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!rows.length) return null;
    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const svcRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!svcRoleKey || authHeader !== `Bearer ${svcRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: candidates, error: fetchError } = await supabase
      .from("jobs")
      .select("id, location")
      .eq("status", "open")
      .is("latitude", null)
      .is("longitude", null)
      .not("location", "is", null)
      .order("created_at", { ascending: true })
      .limit(CANDIDATE_POOL_SIZE);

    if (fetchError) throw fetchError;

    // Shuffle before slicing to MAX_JOBS_PER_RUN. There's no attempt
    // counter on `jobs`, so a permanently-ungeocodable address (typo, PO
    // box) can't be told apart from one that just hasn't been tried yet —
    // an oldest-first order would let a handful of bad addresses occupy
    // every run's batch forever and starve the rest of the queue.
    // Shuffling spreads that cost across runs instead of concentrating it.
    const pool = candidates || [];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const batch = pool.slice(0, MAX_JOBS_PER_RUN);

    const defects = defectTracker();
    let geocoded = 0;
    let stillFailed = 0;

    for (let i = 0; i < batch.length; i++) {
      const job = batch[i];
      const coords = await geocodeAddress(job.location);
      if (coords) {
        // Conditional on still being open + still null, mirroring the other
        // cron write-guards — a job that got its own coords (or was closed)
        // between the read above and here should not be clobbered.
        const { data: updated, error: updateError } = await supabase
          .from("jobs")
          .update({ latitude: coords.latitude, longitude: coords.longitude })
          .eq("id", job.id)
          .eq("status", "open")
          .is("latitude", null)
          .is("longitude", null)
          .select("id");
        if (updateError) {
          console.error(`Failed to backfill coords for job ${job.id}:`, updateError);
          defects.record(`update ${job.id}: ${updateError.message}`);
          continue;
        }
        if ((updated?.length ?? 0) > 0) geocoded++;
      } else {
        stillFailed++;
      }
      // Stay inside Nominatim's fair-use rate limit even when a lookup
      // fails fast, so a bad batch can't turn into a burst. Skipped after
      // the last job — nothing follows it in this run.
      if (i < batch.length - 1) await sleep(NOMINATIM_DELAY_MS);
    }

    return cronResult(
      "backfill-job-geocode",
      {
        message: `Geocoded ${geocoded} of ${batch.length} open jobs missing coords (${stillFailed} unresolved this run, ${pool.length} total still queued)`,
        candidateCount: pool.length,
        attemptedCount: batch.length,
        geocoded,
        stillFailed,
      },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("Backfill geocode error:", error);
    return cronError("backfill-job-geocode", (error as Error).message, corsHeaders);
  }
});
