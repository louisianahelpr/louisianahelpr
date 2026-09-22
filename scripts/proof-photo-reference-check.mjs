#!/usr/bin/env node
/**
 * CLASS CHECK: every proof-photo value a job row stores resolves to an object
 * that actually exists in the private `proof-photos` bucket.
 *
 * WHAT HAPPENED (press-every-control run 35768341847, 2026-09-22, 375px, PROD).
 * Pressing notification items on /jobs/... as the helper persona produced a
 * stream of
 *
 *   400 POST .../storage/v1/object/sign/proof-photos/<jobId>/before-<ts>-<r>.png
 *
 * across at least four job ids. Those POSTs were read FIRST as rejected
 * UPLOADS. They are not uploads. `supabase.storage.createSignedUrl(path, ttl)`
 * is itself a POST to `/object/sign/<bucket>/<path>`, and storage answers 400
 * `{"statusCode":"404","error":"NotFound","message":"Object not found"}` when
 * the object is missing. Verified on prod edge_logs: every 400 in that run was
 * on `/object/sign/proof-photos/...`, none on `/object/proof-photos/...`.
 *
 * So the defect is DATA, not the upload path and not the day's store-a-path
 * change (src/lib/proofPhotoStorage.ts, src/hooks/useProofPhotoUrls.ts), which
 * signed exactly the path each row held. Measured on prod 2026-09-22:
 *
 *   95 stored proof-photo values across public.jobs
 *   54 resolve to a live object in `proof-photos`
 *   41 DANGLE — the row names an object storage does not have
 *
 * The store-a-path change did not create those 41. It made them LOUD: while a
 * long-lived signed URL was persisted, a dangling reference surfaced as one
 * broken <img> GET; signing at display time turns the same broken reference
 * into an XHR that the press sweep sees and Sentry records.
 *
 * WHY A CHECK AND NOT A ONE-OFF CLEANUP: this is the row-points-at-nothing
 * class that `src/test/avatarRowObjectAgreement.test.ts` already covers for
 * `profiles.avatar_url` and that `scripts/storage-orphan-sweep.mjs` covers in
 * the OPPOSITE direction (object with no row). The direction that bit us here —
 * row with no object, for proof photos, which are the evidence a dispute is
 * decided on — had no check at all. This is that check, and it is RED on the
 * defect as it stands.
 *
 * READ-ONLY. It never writes, deletes or signs; it lists and compares.
 *
 * Usage:  node scripts/proof-photo-reference-check.mjs [--json] [--quiet]
 * Env:    SUPABASE_URL or SUPABASE_PROJECT_REF (or VITE_SUPABASE_URL),
 *         SUPABASE_SERVICE_ROLE_KEY
 * Exit:   0 every stored value resolves; 1 any dangling reference; 2 harness
 *         failure (bad env, a request that did not answer) — never confused
 *         with a clean result.
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const QUIET = args.includes("--quiet");

const BUCKET = "proof-photos";
/** prod is a free-tier nano: pace every listing. */
const PACE_MS = 120;

function env() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!url && process.env.SUPABASE_PROJECT_REF) {
    url = `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`;
  }
  if (!url || !key) {
    console.error("::error::SUPABASE_URL (or SUPABASE_PROJECT_REF) and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(2);
  }
  return { url, key };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The object path inside `proof-photos` for a stored value. Deliberately the
 * same two shapes `extractProofPhotoPath` accepts in src/lib/proofPhotoStorage.ts
 * — a bare path, or a legacy signed URL naming this bucket — because a check
 * that accepted fewer shapes than the app would report phantom failures, and
 * one that accepted more would miss real ones. "" means "not an object in this
 * bucket" (e.g. an https://example.invalid/ seed placeholder), which is not a
 * dangling reference and is counted separately.
 */
export function storagePathFor(value) {
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");
  const m = value.match(new RegExp(`/${BUCKET}/(.+)$`));
  if (!m) return "";
  return m[1].split("?")[0];
}

async function main() {
  const { url, key } = env();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await db
    .from("jobs")
    .select("id, is_seed, proof_before_urls, proof_after_urls")
    .or("proof_before_urls.neq.{},proof_after_urls.neq.{}");
  if (error) {
    console.error(`::error::reading jobs failed: ${error.message}`);
    process.exit(2);
  }

  /** every stored value, with the row and column it came from */
  const stored = [];
  for (const r of rows ?? []) {
    for (const [col, arr] of [
      ["proof_before_urls", r.proof_before_urls],
      ["proof_after_urls", r.proof_after_urls],
    ]) {
      for (const value of arr ?? []) stored.push({ jobId: r.id, isSeed: r.is_seed === true, col, value });
    }
  }

  const resolvable = stored.filter((s) => storagePathFor(s.value) !== "");
  const foreign = stored.length - resolvable.length;

  // One listing per job-id prefix, not one HEAD per value.
  const prefixes = [...new Set(resolvable.map((s) => storagePathFor(s.value).split("/")[0]))];
  const present = new Set();
  for (const prefix of prefixes) {
    const { data, error: listErr } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (listErr) {
      console.error(`::error::listing ${BUCKET}/${prefix} failed: ${listErr.message}`);
      process.exit(2);
    }
    for (const o of data ?? []) present.add(`${prefix}/${o.name}`);
    await sleep(PACE_MS);
  }

  const dangling = resolvable.filter((s) => !present.has(storagePathFor(s.value)));

  const summary = {
    stored: stored.length,
    notInThisBucket: foreign,
    checked: resolvable.length,
    resolved: resolvable.length - dangling.length,
    dangling: dangling.length,
    danglingOnSeedRows: dangling.filter((d) => d.isSeed).length,
    danglingOnRealRows: dangling.filter((d) => !d.isSeed).length,
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, dangling }, null, 2));
  } else if (!QUIET) {
    console.log(
      `proof-photos: ${summary.checked} stored references checked, ${summary.resolved} resolved, ${summary.dangling} DANGLING` +
        (foreign ? ` (${foreign} values name no object in this bucket, not checked)` : ""),
    );
    for (const d of dangling) {
      console.log(`  MISSING ${storagePathFor(d.value)}  <- jobs.${d.col} of ${d.jobId}${d.isSeed ? " (is_seed)" : ""}`);
    }
  }

  if (dangling.length > 0) {
    console.error(
      `::error::${dangling.length} proof-photo reference(s) point at objects that do not exist in ${BUCKET}. ` +
        `Every one of these renders as a broken photo and fires 400 POST /object/sign/${BUCKET}/… at display time. ` +
        `${summary.danglingOnRealRows} are on NON-seed jobs.`,
    );
    process.exit(1);
  }
  if (!QUIET) console.log("::notice::every stored proof-photo reference resolves to a live object");
}

main().catch((err) => {
  console.error(`::error::${err?.stack ?? err}`);
  process.exit(2);
});
