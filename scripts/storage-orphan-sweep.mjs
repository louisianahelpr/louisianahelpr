#!/usr/bin/env node
/**
 * Weekly auto-delete of orphaned Supabase Storage objects (owner, 2026-09-14).
 *
 * WHY: deletion paths that bypass the app's own cleanup (SQL deletes of test
 * users, a script's teardown, a job row removed by an RPC) strand files. The
 * 2026-09-14 audit found 32 of them, 10.3 MB, including 14 public avatars and 3
 * credential scans of users who no longer exist
 * (docs/audit/storage-audit-2026-09-14.md). The app-side leaks are fixed, but a
 * new deletion path will appear one day; this is the net under all of them.
 *
 * SAFETY, in the order it is applied (rules in scripts/lib/storageOrphans.mjs):
 *   1. An object is an orphan only when its owning row is absent on TWO reads
 *      at least --wait-minutes (default 10) apart within this run.
 *   2. Objects younger than --min-age-days (default 7) are never touched, so an
 *      upload whose row is not written yet cannot be mistaken for an orphan.
 *   3. id-documents / user-documents: only when the owner is absent from BOTH
 *      profiles and auth.users.
 *   4. Hard caps: over --max-files (50) orphans, or over --max-bucket-pct (5%)
 *      of any bucket's objects, deletes NOTHING and posts a critical alert —
 *      numbers like that mean the matching is wrong, not that storage is dirty.
 *   5. Immediately before each delete the owner is re-read for that one object.
 *
 * PROD LOAD: prod is a free-tier nano. Every request is paced (300 ms) and
 * time-boxed (20 s); any timeout aborts the run without deleting.
 *
 * Usage:
 *   node scripts/storage-orphan-sweep.mjs [--dry-run] [--log <file>]
 *        [--wait-minutes N] [--min-age-days N] [--max-files N] [--max-bucket-pct N]
 * Env: SUPABASE_URL or SUPABASE_PROJECT_REF (or VITE_SUPABASE_URL),
 *      SUPABASE_SERVICE_ROLE_KEY, optional SLACK_WEBHOOK_URL, GITHUB_OUTPUT.
 * Exit: 0 clean or deleted; 2 cap tripped; 1 failure.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULTS, checkCaps, formatMB, orphanReason, selectOrphans } from "./lib/storageOrphans.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`--${name} needs a value`);
  return v;
};
const num = (name, fallback) => {
  const n = Number(opt(name, fallback));
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
  return n;
};

const DRY_RUN = flag("dry-run");
const LOG = opt("log", "storage-orphan-sweep.log");
const WAIT_MIN = num("wait-minutes", DEFAULTS.waitMinutes);
const MIN_AGE = num("min-age-days", DEFAULTS.minAgeDays);
const MAX_FILES = num("max-files", DEFAULTS.maxFiles);
const MAX_PCT = num("max-bucket-pct", DEFAULTS.maxBucketPct);
// The two-read rule cannot be switched off for a run that deletes.
if (!DRY_RUN && WAIT_MIN < DEFAULTS.waitMinutes) {
  console.error(`::error::--wait-minutes below ${DEFAULTS.waitMinutes} is allowed only with --dry-run`);
  process.exit(1);
}
// Stop starting new deletes after this many minutes, well inside the job's
// timeout, so the runner is never killed halfway through a delete.
const BUDGET_MS = num("budget-minutes", 20) * 60_000;
const STARTED = Date.now();
// One-off runs: restrict deletion to a reviewed list of `bucket/path` lines.
const ONLY_LIST = opt("only-list", null);
const ONLY = ONLY_LIST
  ? new Set(readFileSync(ONLY_LIST, "utf8").split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean))
  : null;

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE =
  process.env.SUPABASE_URL ||
  (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : process.env.VITE_SUPABASE_URL);
if (!KEY || !BASE) {
  console.error("::error::SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL/SUPABASE_PROJECT_REF are required");
  process.exit(1);
}
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = 0;
const MAX_CALLS = 1500;
async function req(method, path, body) {
  if (++calls > MAX_CALLS) throw new Error(`stopped at the ${MAX_CALLS}-request cap`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const text = await res.text();
    if (res.status === 404 && method === "GET" && path.startsWith("/auth/v1/admin/users/")) return null;
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} -> HTTP ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`${method} ${path.split("?")[0]} timed out after 20 s — aborting, nothing deleted by this call`);
    throw e;
  } finally {
    clearTimeout(timer);
    await sleep(300);
  }
}

// --redact-log: the repo is PUBLIC and workflow artifacts are downloadable, so
// the CI log shortens every UUID to its first 8 characters (the audit doc's own
// style). Paths stay recognisable and byte sizes exact; user ids do not leak.
const REDACT = flag("redact-log");
const redact = (s) => (REDACT ? s.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1…") : s);
function log(line) {
  appendFileSync(LOG, `${new Date().toISOString()} ${redact(line)}\n`);
}

async function listObjects() {
  const buckets = await req("GET", "/storage/v1/bucket");
  const objects = [];
  for (const { id } of buckets) {
    const stack = [""];
    while (stack.length) {
      const prefix = stack.pop();
      for (let offset = 0; ; offset += 100) {
        const rows = await req("POST", `/storage/v1/object/list/${id}`, { prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } });
        for (const r of rows) {
          const full = prefix ? `${prefix}/${r.name}` : r.name;
          if (r.id === null) stack.push(full);
          else objects.push({ bucket: id, name: full, size: Number(r.metadata?.size ?? 0), createdAt: r.created_at });
        }
        if (rows.length < 100) break;
      }
    }
  }
  return { buckets: buckets.map((b) => b.id), objects };
}

async function restAll(table, select, filter = "") {
  // Page until an EMPTY page, not until a short one: PostgREST's max-rows can
  // be lower than the limit asked for, and a truncated owner read would make
  // owned objects look orphaned. Ordered by the key so pages are stable.
  const out = [];
  const key = select.split(",")[0];
  for (let page = 0, offset = 0; ; page++) {
    if (page > 200) throw new Error(`${table} read exceeded 200 pages`);
    const rows = await req("GET", `/rest/v1/${table}?select=${select}${filter}&order=${key}.asc&limit=1000&offset=${offset}`);
    if (!Array.isArray(rows)) throw new Error(`${table} read returned a non-array`);
    if (rows.length === 0) break;
    out.push(...rows);
    offset += rows.length;
  }
  return out;
}

async function readWorld() {
  const readAt = Date.now();
  const profiles = await restAll("profiles", "user_id");
  const jobs = await restAll("jobs", "id");
  const msgs = await restAll("messages", "attachment_url", "&attachment_url=not.is.null");
  const authUserIds = new Set();
  for (let page = 1; ; page++) {
    if (page > 200) throw new Error("auth user read exceeded 200 pages");
    const r = await req("GET", `/auth/v1/admin/users?page=${page}&per_page=1000`);
    if (!Array.isArray(r?.users)) throw new Error("auth user read returned no users array");
    if (r.users.length === 0) break; // empty page, not a short one (see restAll)
    for (const u of r.users) authUserIds.add(u.id);
  }
  // A read that comes back empty on a populated project is a broken read, not
  // a project with no users. Refuse rather than call everything an orphan.
  if (profiles.length === 0 || authUserIds.size === 0 || jobs.length === 0) {
    throw new Error(`implausible owner read (profiles ${profiles.length}, auth ${authUserIds.size}, jobs ${jobs.length}) — refusing to classify`);
  }
  return {
    readAt,
    profileUserIds: new Set(profiles.map((p) => p.user_id).filter(Boolean)),
    authUserIds,
    jobIds: new Set(jobs.map((j) => j.id)),
    attachmentRefs: msgs.map((m) => m.attachment_url).filter(Boolean),
  };
}

/** Owner re-read for ONE object, immediately before it is deleted. */
async function stillOrphan(o) {
  const seg = o.name.split("/");
  const ids = [...new Set(seg.filter((s) => /^[0-9a-f-]{36}$/i.test(s)))];
  const inList = `(${ids.join(",")})`;
  const profiles = ids.length ? await req("GET", `/rest/v1/profiles?select=user_id&user_id=in.${inList}`) : [];
  const jobs = ids.length ? await req("GET", `/rest/v1/jobs?select=id&id=in.${inList}`) : [];
  const authUserIds = new Set();
  for (const id of ids) {
    const u = await req("GET", `/auth/v1/admin/users/${id}`);
    if (u?.id) authUserIds.add(u.id);
  }
  let attachmentRefs = [];
  if (o.bucket === "message-attachments") {
    const rows = await req("GET", `/rest/v1/messages?select=attachment_url&attachment_url=like.${encodeURIComponent(`*${o.name}*`)}`);
    attachmentRefs = rows.map((r) => r.attachment_url);
  }
  const world = {
    profileUserIds: new Set(profiles.map((p) => p.user_id)),
    authUserIds,
    jobIds: new Set(jobs.map((j) => j.id)),
    attachmentRefs,
  };
  return orphanReason(o.bucket, o.name, world);
}

async function slack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log(`(no SLACK_WEBHOOK_URL) ${text}`);
    return;
  }
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) console.error(`::warning::Slack rejected the summary: HTTP ${res.status}`);
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${redact(String(value)).replace(/\n/g, " ")}\n`);
}

async function main() {
  writeFileSync(LOG, "");
  log(`start dry_run=${DRY_RUN} wait_minutes=${WAIT_MIN} min_age_days=${MIN_AGE} max_files=${MAX_FILES} max_bucket_pct=${MAX_PCT}`);

  const { buckets, objects } = await listObjects();
  const totalBytes = objects.reduce((s, o) => s + o.size, 0);
  log(`listed ${objects.length} objects, ${totalBytes} bytes, ${buckets.length} buckets`);

  const first = await readWorld();
  const firstPass = objects.filter((o) => orphanReason(o.bucket, o.name, first));
  log(`read 1: ${firstPass.length} candidate orphan(s)`);

  if (firstPass.length > 0 && WAIT_MIN > 0) {
    log(`waiting ${WAIT_MIN} min before the second read`);
    await sleep(WAIT_MIN * 60_000);
  }
  const second = firstPass.length > 0 ? await readWorld() : { ...first, readAt: first.readAt + WAIT_MIN * 60_000 };

  const sel = selectOrphans({ objects, first, second, now: Date.now(), minAgeDays: MIN_AGE, waitMinutes: WAIT_MIN });
  if (sel.error) throw new Error(sel.error);
  if (ONLY) {
    const outside = sel.orphans.filter((o) => !ONLY.has(`${o.bucket}/${o.name}`));
    for (const o of outside) log(`skip-not-in-list ${o.bucket}/${o.name} ${o.size}`);
    sel.orphans = sel.orphans.filter((o) => ONLY.has(`${o.bucket}/${o.name}`));
  }
  for (const o of sel.skippedYoung) log(`skip-young ${o.bucket}/${o.name} ${o.size} (${o.reason}, created ${o.createdAt})`);
  for (const o of sel.skippedSecondRead) log(`skip-second-read ${o.bucket}/${o.name} ${o.size} (owner reappeared or identity rule)`);

  const orphanBytes = sel.orphans.reduce((s, o) => s + o.size, 0);
  for (const o of sel.orphans) log(`orphan ${o.bucket}/${o.name} ${o.size} (${o.reason})`);
  output("orphans", sel.orphans.length);

  const caps = checkCaps({ orphans: sel.orphans, objects, maxFiles: MAX_FILES, maxBucketPct: MAX_PCT });
  if (caps.tripped) {
    for (const r of caps.reasons) log(`CAP TRIPPED: ${r}`);
    const summary = `storage orphan sweep: CAP TRIPPED, nothing deleted — ${caps.reasons.join("; ")}`;
    output("summary", summary);
    output("cap_tripped", "true");
    await slack(`:rotating_light: CRITICAL ${summary}${process.env.RUN_URL ? `\n${process.env.RUN_URL}` : ""}`);
    console.error(`::error::${summary}`);
    return 2;
  }
  output("cap_tripped", "false");

  if (DRY_RUN || sel.orphans.length === 0) {
    const summary = `storage orphan sweep${DRY_RUN ? " (dry run)" : ""}: ${sel.orphans.length} files, ${formatMB(orphanBytes)} ${DRY_RUN ? "would be removed" : "removed"} (${objects.length} objects, ${formatMB(totalBytes)} total)`;
    log(summary);
    output("summary", summary);
    console.log(summary);
    if (!DRY_RUN) await slack(summary);
    return 0;
  }

  let removed = 0;
  let removedBytes = 0;
  const failures = [];
  for (const o of sel.orphans) {
    if (Date.now() - STARTED > BUDGET_MS) {
      failures.push(`time budget spent before ${o.bucket}/${o.name}; left for next week`);
      log(`STOP time budget spent; ${o.bucket}/${o.name} and the rest left for next week`);
      break;
    }
    try {
      const reason = await stillOrphan(o);
      if (!reason) {
        log(`skip-owner-present ${o.bucket}/${o.name} ${o.size}`);
        continue;
      }
      log(`deleting ${o.bucket}/${o.name} ${o.size} (${reason})`);
      const res = await req("DELETE", `/storage/v1/object/${o.bucket}`, { prefixes: [o.name] });
      // A 200 with an empty array removed nothing: say so, never count it.
      if (!Array.isArray(res) || !res.some((r) => r.name === o.name)) {
        failures.push(`${o.bucket}/${o.name}: delete answered without the object`);
        log(`FAILED ${o.bucket}/${o.name} ${o.size}: delete answered without the object`);
        continue;
      }
      removed++;
      removedBytes += o.size;
      log(`deleted ${o.bucket}/${o.name} ${o.size}`);
    } catch (e) {
      const msg = String(e?.message || e);
      failures.push(`${o.bucket}/${o.name}: ${msg}`);
      log(`FAILED ${o.bucket}/${o.name} ${o.size}: ${msg}`);
      if (/timed out/.test(msg)) break; // prod is struggling: stop.
    }
  }
  const summary = `storage orphan sweep: ${removed} files, ${formatMB(removedBytes)} removed${failures.length ? `, ${failures.length} failed` : ""}`;
  log(summary);
  output("summary", summary);
  console.log(summary);
  await slack(failures.length ? `:warning: ${summary}` : summary);
  return failures.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    const msg = String(e?.message || e);
    try {
      log(`ABORTED: ${msg}`);
    } catch {
      /* log file unwritable: stderr below still carries it */
    }
    console.error(`::error::storage orphan sweep aborted, nothing further deleted: ${redact(msg)}`);
    output("summary", `storage orphan sweep aborted: ${msg.slice(0, 200)}`);
    process.exit(1);
  });
