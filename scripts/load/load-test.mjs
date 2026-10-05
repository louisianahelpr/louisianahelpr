#!/usr/bin/env node
/**
 * Q60: bounded, ramped load test against PROD Supabase (there is no staging).
 *
 * One Node process. Drives the real app's query shapes with the shared test
 * accounts (sessions minted by scripts/test-signin-link.mjs; no new auth users):
 *
 *   browse      open_jobs_browse, the guest/browse feed shape (src/boot/guestJobsPrefetch.ts)
 *   job_detail  jobs?id=eq.<id>&select=<JOB_READABLE_COLUMN_LIST> (ids from browse results)
 *   inbox       messages or(sender,receiver) order created_at desc limit 200
 *               (src/pages/messages/messagesData/loadConversations.ts)
 *   notif_list / notif_unread / notif_count
 *               the three notification feed reads (src/components/notificationPanel/notificationFeed.ts)
 *   msg_send    a FEW message inserts between poster-e2e and helper-e2e on their
 *               seed job, tagged "[q60-loadtest <runId>]" so cleanup can find them.
 *               Capped per sender under the 30/hour enforce_message_rate trigger.
 *   realtime    N supabase-js clients, one socket each, one channel each with
 *               user-scoped postgres_changes filters (messages receiver_id,
 *               notifications user_id). Measures join success/time and event
 *               delivery latency from the timestamp embedded in each sent message.
 *
 * Ramp (default): VUs 5 -> 25 -> 50 -> 100, realtime 10 -> 50 -> 100 -> 200,
 * 120 s per step. Aborts at once when, over the last 30 s, error rate > 5%
 * (min 20 requests), p95 > 3000 ms, or >= 5 HTTP 5xx in 10 s. Never exceeds the
 * top step.
 *
 * Usage:
 *   node scripts/load/load-test.mjs [--steps 5,25,50,100] [--rt 10,50,100,200]
 *        [--step-seconds 120] [--sends-per-sender 8] [--out ~/.lh-shots/q60]
 *
 * It prints the run tag. Cleanup (messages + notifications carrying the tag) is
 * done afterwards with read-write SQL by the operator and proved by count
 * queries; the write-up is docs/audit/q60-load-test-2026-09-27.md.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { supabaseBase } from "../lib/apiBase.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const STEPS = arg("steps", "5,25,50,100").split(",").map(Number);
const RT_STEPS = arg("rt", "10,50,100,200").split(",").map(Number);
const STEP_MS = Number(arg("step-seconds", "120")) * 1000;
const SENDS_PER_SENDER = Number(arg("sends-per-sender", "8"));
const OUT = arg("out", join(homedir(), ".lh-shots/q60"));
// The seed job both e2e accounts are party to (in_progress, escrow).
const SEED_JOB = arg("job", "bb2c3732-476a-4f66-aae6-372cbdfcfdf6");
if (STEPS.length !== RT_STEPS.length) throw new Error("--steps and --rt need the same length");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const URL_BASE = supabaseBase(env.VITE_SUPABASE_URL);
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");

const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const TAG = `[q60-loadtest ${runId}]`;

function mint(name) {
  const out = execFileSync("node", [join(ROOT, "scripts/test-signin-link.mjs"), name, "--session", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const { session } = JSON.parse(out.slice(out.indexOf("{")));
  return { name, token: session.access_token, uid: session.user.id };
}

// ---------- metrics ----------
const TYPES = ["browse", "job_detail", "inbox", "notif_list", "notif_unread", "notif_count", "msg_send"];
let step = null; // current step record
const recent = []; // {t, ms, ok, s5xx}
function newStep(idx) {
  return {
    idx,
    vus: STEPS[idx],
    rtTarget: RT_STEPS[idx],
    startedAt: new Date().toISOString(),
    lat: Object.fromEntries(TYPES.map((t) => [t, []])),
    err: Object.fromEntries(TYPES.map((t) => [t, 0])),
    status: {},
    rt: { attempted: 0, joined: 0, failed: 0, joinMs: [], deliveries: [], notifDeliveries: [] },
  };
}
function record(type, ms, ok, status) {
  const now = Date.now();
  if (step) {
    step.lat[type].push(ms);
    if (!ok) step.err[type]++;
    step.status[status] = (step.status[status] || 0) + 1;
  }
  recent.push({ t: now, ms, ok, s5xx: status >= 500 });
  while (recent.length && recent[0].t < now - 30_000) recent.shift();
}
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

// ---------- HTTP ----------
async function rest(type, user, path, { method = "GET", body, headers = {} } = {}) {
  const t0 = performance.now();
  let status = 0;
  let data = null;
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    status = r.status;
    if (method !== "HEAD") data = await r.json().catch(() => null);
  } catch {
    status = 599; // network error / timeout: counted as a 5xx-class failure
  }
  const ms = performance.now() - t0;
  record(type, ms, status >= 200 && status < 300, status);
  return { status, data };
}

let jobIds = [SEED_JOB];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browse(u) {
  const { data } = await rest(
    "browse",
    u,
    "open_jobs_browse?select=*&order=boosted_at.desc.nullslast,created_at.desc&limit=40",
  );
  if (Array.isArray(data) && data.length) jobIds = data.map((j) => j.id).filter(Boolean);
}
// select=* is refused (403: offered_to_helper_id is column-revoked), so read the
// app's own readable column list from src/lib/jobColumns.ts, as the app does.
const JOB_COLS = (() => {
  const src = readFileSync(join(ROOT, "src/lib/jobColumns.ts"), "utf8");
  const body = src.match(/JOB_READABLE_COLUMN_LIST = \[([\s\S]*?)\]/)[1];
  return [...body.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]).join(",");
})();
const jobDetail = (u) => rest("job_detail", u, `jobs?id=eq.${pick(jobIds)}&select=${JOB_COLS}`);
const inbox = (u) =>
  rest(
    "inbox",
    u,
    `messages?select=*&or=(sender_id.eq.${u.uid},receiver_id.eq.${u.uid})&order=created_at.desc&limit=200`,
  );
async function notifications(u) {
  await rest("notif_list", u, `notifications?select=*&user_id=eq.${u.uid}&order=created_at.desc&limit=50`);
  await rest("notif_unread", u, `notifications?select=*&user_id=eq.${u.uid}&read=eq.false&order=created_at.desc&limit=50`);
  await rest("notif_count", u, `notifications?select=id&user_id=eq.${u.uid}&read=eq.false`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
}

let stopping = false;
async function vu(users, id) {
  const u = users[id % users.length];
  while (!stopping && id < activeVus) {
    const r = Math.random();
    if (r < 0.35) await browse(u);
    else if (r < 0.55) await jobDetail(u);
    else if (r < 0.75) await inbox(u);
    else await notifications(u);
    await sleep(1000 + Math.random() * 2000); // think time 1-3 s
  }
}

// ---------- realtime ----------
const rtClients = [];
const sentAt = new Map(); // seq -> ms
function addSubscriber(u, i) {
  const c = createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { accessToken: async () => u.token },
  });
  // Without this the channel joins with the anon key and RLS silently drops
  // every row event (measured in the first smoke run: joined 2/2, 0 events).
  c.realtime.setAuth(u.token);
  const t0 = Date.now();
  const s = step;
  s.rt.attempted++;
  const onEvent = (kind) => (payload) => {
    const text = kind === "msg" ? payload.new?.content : payload.new?.message;
    if (!text || !text.startsWith(TAG)) return;
    const m = text.match(/ts=(\d+)/);
    if (m && step) (kind === "msg" ? step.rt.deliveries : step.rt.notifDeliveries).push(Date.now() - Number(m[1]));
  };
  const ch = c
    .channel(`q60-${runId}-${i}-${randomUUID().slice(0, 8)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${u.uid}` }, onEvent("msg"))
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${u.uid}` },
      onEvent("notif"),
    );
  let settled = false;
  ch.subscribe((status) => {
    if (settled) return;
    if (status === "SUBSCRIBED") {
      settled = true;
      s.rt.joined++;
      s.rt.joinMs.push(Date.now() - t0);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      settled = true;
      s.rt.failed++;
    }
  });
  rtClients.push({ c, ch });
}

// ---------- writes ----------
const sendLog = [];
async function hourlyCount(u) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const r = await fetch(`${URL_BASE}/rest/v1/messages?select=id&sender_id=eq.${u.uid}&created_at=gte.${since}`, {
    method: "HEAD",
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, Prefer: "count=exact" },
  });
  return Number((r.headers.get("content-range") || "*/0").split("/")[1]);
}
async function sendOne(from, to, seq) {
  const ts = Date.now();
  sentAt.set(seq, ts);
  const { status, data } = await rest("msg_send", from, "messages?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { client_id: randomUUID(), job_id: SEED_JOB, sender_id: from.uid, receiver_id: to.uid, content: `${TAG} ts=${ts} n=${seq}` },
  });
  sendLog.push({ seq, from: from.name, status, id: Array.isArray(data) ? data[0]?.id : null, err: status >= 300 ? data : undefined });
}

// ---------- main ----------
let activeVus = 0;
const steps = [];
let abortReason = null;

function checkAbort() {
  const now = Date.now();
  if (recent.length >= 20) {
    const errs = recent.filter((r) => !r.ok).length / recent.length;
    if (errs > 0.05) return `error rate ${(errs * 100).toFixed(1)}% over last 30 s`;
    const p95 = pct(recent.map((r) => r.ms), 95);
    if (p95 > 3000) return `p95 ${p95} ms over last 30 s`;
  }
  const burst = recent.filter((r) => r.s5xx && r.t > now - 10_000).length;
  if (burst >= 5) return `${burst} 5xx in 10 s`;
  return null;
}

function summarize(s) {
  const out = { step: s.idx + 1, vus: s.vus, rtTarget: s.rtTarget, startedAt: s.startedAt, endedAt: s.endedAt, types: {} };
  let n = 0;
  let e = 0;
  for (const t of TYPES) {
    const a = s.lat[t];
    if (!a.length) continue;
    n += a.length;
    e += s.err[t];
    out.types[t] = { n: a.length, errors: s.err[t], p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: pct(a, 100) };
  }
  out.requests = n;
  out.errorRate = n ? +(e / n).toFixed(4) : 0;
  out.rps = +(n / ((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)).toFixed(1);
  out.status = s.status;
  out.realtime = {
    attempted: s.rt.attempted,
    joined: s.rt.joined,
    failed: s.rt.failed,
    joinP50: pct(s.rt.joinMs, 50),
    joinP95: pct(s.rt.joinMs, 95),
    msgEvents: s.rt.deliveries.length,
    msgDeliveryP50: pct(s.rt.deliveries, 50),
    msgDeliveryP95: pct(s.rt.deliveries, 95),
    msgDeliveryMax: pct(s.rt.deliveries, 100),
    notifEvents: s.rt.notifDeliveries.length,
    notifDeliveryP50: pct(s.rt.notifDeliveries, 50),
    notifDeliveryP95: pct(s.rt.notifDeliveries, 95),
  };
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`run ${runId} tag "${TAG}" steps ${STEPS} rt ${RT_STEPS} ${STEP_MS / 1000}s/step`);
  const users = ["poster-e2e", "helper-e2e", "poster", "helper"].map(mint);
  const [pe, he] = users;
  console.log("sessions:", users.map((u) => `${u.name}=${u.uid}`).join(" "));

  // Sends: stay well under enforce_message_rate (30/h/sender; fraud flag at 29).
  const budget = {};
  for (const u of [pe, he]) budget[u.name] = Math.max(0, Math.min(SENDS_PER_SENDER, 20 - (await hourlyCount(u))));
  console.log("send budget this run:", budget);

  const vuPromises = [];
  let seq = 0;
  let rtIdx = 0;
  for (let i = 0; i < STEPS.length && !abortReason; i++) {
    if (step) {
      step.endedAt = new Date().toISOString();
      steps.push(summarize(step));
      console.log(JSON.stringify(steps.at(-1)));
    }
    step = newStep(i);
    // Realtime: add subscribers up to this step's target, ~10/s, round-robin over users.
    const rtAdd = (async () => {
      while (rtClients.length < RT_STEPS[i] && !stopping) {
        addSubscriber(users[rtIdx % users.length], rtIdx);
        rtIdx++;
        await sleep(100);
      }
    })();
    // VUs
    const prev = activeVus;
    activeVus = STEPS[i];
    for (let v = prev; v < activeVus; v++) {
      vuPromises.push(vu(users, v));
      await sleep(50);
    }
    await rtAdd;
    // Step body: abort check every second; one send every ~STEP/4 alternating direction.
    const end = Date.now() + STEP_MS;
    let nextSend = Date.now() + 15_000;
    while (Date.now() < end) {
      await sleep(1000);
      const why = checkAbort();
      if (why) {
        abortReason = `step ${i + 1} (${STEPS[i]} VUs): ${why}`;
        console.error("ABORT:", abortReason);
        break;
      }
      if (Date.now() >= nextSend) {
        let from = seq % 2 === 0 ? he : pe;
        if (budget[from.name] <= 0) from = from === he ? pe : he;
        const to = from === he ? pe : he;
        if (budget[from.name] > 0) {
          budget[from.name]--;
          await sendOne(from, to, ++seq);
        }
        nextSend = Date.now() + STEP_MS / 4;
      }
    }
  }
  // Let the last deliveries arrive before closing the step.
  await sleep(abortReason ? 0 : 5000);
  step.endedAt = new Date().toISOString();
  steps.push(summarize(step));
  console.log(JSON.stringify(steps.at(-1)));

  stopping = true;
  await Promise.race([Promise.all(vuPromises), sleep(20_000)]);
  for (const { c, ch } of rtClients) {
    try {
      await c.removeChannel(ch);
      c.realtime.disconnect();
    } catch {
      /* teardown best-effort; counted below */
    }
  }
  const result = { runId, tag: TAG, seedJob: SEED_JOB, abortReason, steps, sends: sendLog, finishedAt: new Date().toISOString() };
  const file = join(OUT, `run-${runId}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`wrote ${file}${abortReason ? ` (ABORTED: ${abortReason})` : ""}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
