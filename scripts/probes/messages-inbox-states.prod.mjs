#!/usr/bin/env node
/**
 * Seed — and then UNDO — the four inbox/job states a screenshot pass could not
 * reach on prod, so they can be LOOKED AT rather than reasoned about.
 *
 *   node scripts/probes/messages-inbox-states.prod.mjs seed     [ledger.json]
 *   node scripts/probes/messages-inbox-states.prod.mjs cancel   [ledger.json]
 *   node scripts/probes/messages-inbox-states.prod.mjs restore  [ledger.json]
 *   node scripts/probes/messages-inbox-states.prod.mjs verify   [ledger.json]
 *
 * PROD, NEVER A MOCK (CLAUDE.md, owner 2026-09-12 twice). Every row this
 * touches is either (1) owned by a seeded `is_seed` test account, or (2) a row
 * this script CREATED and will delete. Nothing else is written, and `restore`
 * re-queries afterwards so "I put it back" is a measurement, not a claim.
 *
 * THE FOUR STATES, and why prod could not show them:
 *
 *  (a) UNREAD THREADS. `poster-e2e` had 29 conversations and ZERO unread
 *      inbound messages, so the 8px burnt-sienna dot — the only unread signal
 *      left now that the Unread tab is gone — had nothing to render. We flip
 *      `read` to false on the newest inbound message of three LIVE threads,
 *      interleaved with read ones on purpose: "can you tell at a glance" is a
 *      question about a MIXED list, not about a list where everything is bold.
 *
 *  (b) THE HIDDEN-UNREAD BANNER. Active is `LIVE_JOB_STATUSES`, which excludes
 *      `open`, so an applicant's unread question on a job you have not awarded
 *      is invisible on the landing tab. Prod had no such thread at all. We
 *      create one: a new `open` job plus one inbound unread message on it.
 *
 *  (c) THE CANCELLED-THREAD NOTICE AND ITS "Not sent" DRAFT. Needs a thread
 *      that is LIVE while you are typing and CANCELLED a moment later. We make
 *      a second throwaway job for that, and `cancel` is a separate step the
 *      browser driver calls mid-run, with the compose box holding text.
 *
 *  (d) THE TIME TILE. Prod had 184 jobs with a null `start_time` and ZERO with
 *      `is_flexible_schedule = true` — so of the tile's three states, only
 *      "nothing" existed anywhere. We put a clock time on one funded open
 *      listing and the flexible flag on another, leaving a third untouched as
 *      the control. Two columns of two existing rows, both recorded.
 *
 * WHY NEW JOBS ARE `payment_status: 'unpaid'` for (b) and (c): they never need
 * to reach browse — they are read through the INBOX, which keys on the message
 * thread — and an unpaid row touches no Stripe object, so there is nothing to
 * refund when it is deleted. The (d) rows are existing ESCROW listings because
 * the job-detail dialog reads `open_jobs_browse`, which admits funded rows
 * only; those are edited in place on two columns and put back.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { rest } from "./lib/prodEnv.mjs";

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f"; // poster-e2e ("Perry Poster")
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5"; // helper-e2e

/** Newest inbound message of three LIVE threads — flipped to unread for (a). */
const UNREAD_MESSAGE_IDS = [
  "41925ef0-9a69-41bd-8f0c-8d72d605ebd7", // Setup crew for a backyard reception (in_progress)
  "26f85c9b-0ea3-4814-b625-a709a3cc8602", // Clear leaves and clean gutters      (in_progress)
  "4fe2e22f-a8e9-47d0-b110-73ae51965fd0", // Bring in patio furniture…           (in_progress)
];

/** (d) two funded open listings, edited on ONE column each. */
const TIME_TILE_EDITS = [
  { id: "ff278393-8def-454f-891f-487de2252263", patch: { start_time: "14:30:00" } }, // Deep clean a 3-bed
  { id: "3c2028d5-7479-4c96-80b7-35e4f34254e9", patch: { is_flexible_schedule: true } }, // Pick up and deliver a washer
];
/** The control: neither a time nor the flag. Never written, only read. */
export const TIME_TILE_CONTROL = "222de826-b918-4c4d-b897-52602ad7dacd"; // Trim crepe myrtles

const LEDGER_DEFAULT = "test-results/messages-inbox-states.ledger.json";
const [cmd, ledgerPathArg] = process.argv.slice(2);
const LEDGER = ledgerPathArg || LEDGER_DEFAULT;

const centralDatePlus = (days) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + days * 86_400_000));

async function newJob(title, description) {
  const [row] = await rest("jobs", {
    method: "POST",
    prefer: "return=representation",
    body: {
      customer_id: POSTER,
      is_seed: true,
      title,
      description,
      category: "handyman",
      location: "4412 Highland Rd, Baton Rouge, LA 70808",
      parish: "East Baton Rouge",
      latitude: 30.4028,
      longitude: -91.1714,
      date_needed: centralDatePlus(9),
      budget: 60,
      status: "open",
      payment_status: "unpaid",
      pricing_mode: "set_price",
    },
  });
  return row.id;
}

async function newMessage(jobId, content, { read }) {
  const [row] = await rest("messages", {
    method: "POST",
    prefer: "return=representation",
    body: { job_id: jobId, sender_id: HELPER, receiver_id: POSTER, content, read },
  });
  // The INSERT default and the scan trigger both run before we see the row, so
  // assert the flag we actually need rather than assuming the body won.
  if (!!row.read !== !!read) {
    await rest(`messages?id=eq.${row.id}`, { method: "PATCH", body: { read, read_at: read ? new Date().toISOString() : null } });
  }
  return row.id;
}

if (cmd === "seed") {
  const before = await rest(`messages?id=in.(${UNREAD_MESSAGE_IDS.join(",")})&select=id,read,read_at`);
  const tiles = await rest(`jobs?id=in.(${TIME_TILE_EDITS.map((e) => e.id).join(",")})&select=id,start_time,is_flexible_schedule`);

  // (a) three live threads go unread.
  for (const id of UNREAD_MESSAGE_IDS) {
    await rest(`messages?id=eq.${id}`, { method: "PATCH", body: { read: false, read_at: null } });
  }

  // (b) an unread question on an OPEN posting — the thread Active hides.
  const openJobId = await newJob(
    "SEED probe — question on an open posting",
    "Throwaway fixture for the hidden-unread banner. It is deleted by this script's `restore` step.",
  );
  const openMsgId = await newMessage(openJobId, "Is this still available for Saturday morning?", { read: false });

  // (c) a live thread to be cancelled underneath an open compose box.
  const cancelJobId = await newJob(
    "SEED probe — cancelled while you were typing",
    "Throwaway fixture for the closed-thread notice and the unsent draft. Deleted by `restore`.",
  );
  const cancelMsgId = await newMessage(cancelJobId, "Morning — are we still on for this one?", { read: true });

  // (d) one clock time, one flexible flag.
  for (const e of TIME_TILE_EDITS) {
    await rest(`jobs?id=eq.${e.id}`, { method: "PATCH", body: e.patch });
  }

  const ledger = {
    seededAt: new Date().toISOString(),
    messagesReadBefore: before,
    createdJobs: [openJobId, cancelJobId],
    createdMessages: [openMsgId, cancelMsgId],
    openJobId,
    cancelJobId,
    timeTilesBefore: tiles,
    timeTileControl: TIME_TILE_CONTROL,
  };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(JSON.stringify(ledger, null, 2));
  console.log(`\nledger → ${LEDGER}`);
}

if (cmd === "cancel") {
  // Called by the browser driver WHILE the compose box holds text. Direct
  // UPDATE, not poster_cancel_job(): the RPC applies the reliability ladder
  // and a refund, and this row is unpaid and about to be deleted — the point
  // under test is the CLIENT's reaction to `status = 'cancelled'`.
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  await rest(`jobs?id=eq.${ledger.cancelJobId}`, { method: "PATCH", body: { status: "cancelled" } });
  const [row] = await rest(`jobs?id=eq.${ledger.cancelJobId}&select=id,status`);
  console.log(JSON.stringify(row));
}

if (cmd === "restore") {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  for (const m of ledger.messagesReadBefore) {
    await rest(`messages?id=eq.${m.id}`, { method: "PATCH", body: { read: m.read, read_at: m.read_at } });
  }
  for (const t of ledger.timeTilesBefore) {
    await rest(`jobs?id=eq.${t.id}`, { method: "PATCH", body: { start_time: t.start_time, is_flexible_schedule: t.is_flexible_schedule } });
  }
  // Children first: messages and anything the job's own triggers fanned out.
  for (const j of ledger.createdJobs) {
    await rest(`messages?job_id=eq.${j}`, { method: "DELETE" });
    await rest(`notifications?job_id=eq.${j}`, { method: "DELETE" }).catch(() => {});
    await rest(`jobs?id=eq.${j}`, { method: "DELETE" });
  }
  console.log("restored — run `verify` for the proof re-query");
}

if (cmd === "verify") {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  const msgs = await rest(`messages?id=in.(${ledger.messagesReadBefore.map((m) => m.id).join(",")})&select=id,read,read_at`);
  const tiles = await rest(`jobs?id=in.(${ledger.timeTilesBefore.map((t) => t.id).join(",")})&select=id,start_time,is_flexible_schedule`);
  const jobs = await rest(`jobs?id=in.(${ledger.createdJobs.join(",")})&select=id,status`);
  const orphanMsgs = await rest(`messages?job_id=in.(${ledger.createdJobs.join(",")})&select=id`);
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  const now = byId(msgs), wasM = byId(ledger.messagesReadBefore);
  const nowT = byId(tiles), wasT = byId(ledger.timeTilesBefore);

  let bad = 0;
  for (const id of Object.keys(wasM)) {
    const same = now[id] && now[id].read === wasM[id].read && (now[id].read_at ?? null) === (wasM[id].read_at ?? null);
    console.log(`${same ? "OK  " : "FAIL"} message ${id} read=${now[id]?.read} read_at=${now[id]?.read_at} (was ${wasM[id].read} / ${wasM[id].read_at})`);
    if (!same) bad++;
  }
  for (const id of Object.keys(wasT)) {
    const same = nowT[id] && (nowT[id].start_time ?? null) === (wasT[id].start_time ?? null)
      && !!nowT[id].is_flexible_schedule === !!wasT[id].is_flexible_schedule;
    console.log(`${same ? "OK  " : "FAIL"} job ${id} start_time=${nowT[id]?.start_time} is_flexible_schedule=${nowT[id]?.is_flexible_schedule} (was ${wasT[id].start_time} / ${wasT[id].is_flexible_schedule})`);
    if (!same) bad++;
  }
  console.log(`${jobs.length === 0 ? "OK  " : "FAIL"} created jobs remaining: ${jobs.length} ${JSON.stringify(jobs)}`);
  console.log(`${orphanMsgs.length === 0 ? "OK  " : "FAIL"} messages on created jobs remaining: ${orphanMsgs.length}`);
  if (jobs.length || orphanMsgs.length) bad++;
  console.log(bad === 0 ? "\nALL PROD FIXTURES RESTORED (re-queried)" : `\n${bad} NOT RESTORED`);
  process.exitCode = bad ? 1 : 0;
}

if (!["seed", "cancel", "restore", "verify"].includes(cmd)) {
  console.error("usage: messages-inbox-states.prod.mjs seed|cancel|restore|verify [ledger.json]");
  process.exit(2);
}
if (cmd === "seed" && !existsSync(LEDGER)) process.exitCode = 1;
