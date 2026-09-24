// Q346 live repro: can a signed-in user HIRE by writing the hire columns
// straight through PostgREST, skipping every hire RPC?
//
//   node scripts/probes/direct-patch-hire.prod.mjs
//
// Runs against PROD with the shared seed accounts only. Every job it makes is
// is_seed, owned by poster-e2e, and deleted (with its notifications,
// applications and roster rows) in `finally`, whatever happened.
//
// The jobs are born payment_status='escrow' by the service role (no Stripe PI
// exists; nothing ever charges or pays them) because a funded open job is the
// only state in which the award gates let a hire through at all, i.e. the
// state a real poster's job is in when it is hireable.
//
// Doors (a direct write is a bypass when it SUCCEEDS; exit 1 if any does):
//   A  poster PATCHes helper_id=<helper>, status=accepted on their own job,
//      helper never applied.
//   B  the direct-offer target PATCHes helper_id=self, status=accepted.
//   C  poster re-points offered_to_helper_id at a different person.
//   D  poster INSERTs a group_job_helpers row for someone on their group job.
// Controls (must SUCCEED, else exit 1 — a fix that breaks hiring is no fix):
//   E  accept_application RPC on a real application.
//   F  respond_to_direct_offer(accept) RPC by the offer target.
import { rest, session, URL_, ANON } from "./lib/prodEnv.mjs";

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f"; // poster-e2e
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5"; // helper-e2e
const OTHER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f"; // helper (seed)

async function asUser(token, path, { method = "GET", body } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const date = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
// Each door's job is dropped as soon as it is measured: poster-e2e sits near
// enforce_open_job_limit's 5-open-funded cap, so six live at once would trip it.
async function drop(id) {
  for (const t of ["notifications", "notification_logs", "applications", "group_job_helpers", "messages"]) {
    await rest(`${t}?job_id=eq.${id}`, { method: "DELETE" });
  }
  await rest(`jobs?id=eq.${id}`, { method: "DELETE" });
}

async function mkJob(tag, extra = {}) {
  const [row] = await rest("jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      title: `Q346 probe ${tag}`, description: "Q346 direct-PATCH hire probe; deleted by the probe.",
      date_needed: date, budget: 50, customer_id: POSTER, status: "open",
      payment_status: "escrow", is_seed: true, category: "other", location: "Baton Rouge, LA",
      ...extra,
    },
  });
  return row.id;
}

const made = [];
const results = {};
let failed = false;
try {
  const posterTok = session("poster-e2e").access_token;
  const helperTok = session("helper-e2e").access_token;
  const offerExtra = {
    offered_to_helper_id: HELPER, direct_offer_status: "pending",
    direct_offer_expires_at: new Date(Date.now() + 8 * 3600e3).toISOString(),
  };

  // A
  const a = await mkJob("A"); made.push(a);
  const ra = await asUser(posterTok, `jobs?id=eq.${a}&select=id`, { method: "PATCH", body: { helper_id: HELPER, status: "accepted" } });
  results.A_poster_patch_hire = { status: ra.status, rows: Array.isArray(ra.json) ? ra.json.length : 0, msg: ra.json?.message };

  await drop(a);

  // B
  const b = await mkJob("B", offerExtra); made.push(b);
  const rb = await asUser(helperTok, `jobs?id=eq.${b}&select=id`, { method: "PATCH", body: { helper_id: HELPER, status: "accepted" } });
  results.B_target_patch_hire = { status: rb.status, rows: Array.isArray(rb.json) ? rb.json.length : 0, msg: rb.json?.message };

  await drop(b);

  // C
  const c = await mkJob("C", offerExtra); made.push(c);
  const rc = await asUser(posterTok, `jobs?id=eq.${c}&select=id`, { method: "PATCH", body: { offered_to_helper_id: OTHER } });
  results.C_poster_repoint_offer = { status: rc.status, rows: Array.isArray(rc.json) ? rc.json.length : 0, msg: rc.json?.message };

  await drop(c);

  // D
  const d = await mkJob("D", { is_group_job: true, helpers_needed: 2 }); made.push(d);
  const rd = await asUser(posterTok, "group_job_helpers?select=id", { method: "POST", body: { job_id: d, helper_id: HELPER } });
  results.D_poster_insert_roster = { status: rd.status, rows: Array.isArray(rd.json) ? rd.json.length : 0, msg: rd.json?.message };

  await drop(d);

  // E (control)
  const e = await mkJob("E"); made.push(e);
  const [app] = await rest("applications", { method: "POST", prefer: "return=representation", body: { job_id: e, helper_id: HELPER, status: "pending" } });
  const re = await asUser(posterTok, "rpc/accept_application", {
    method: "POST",
    body: { p_application_id: app.id, p_deadline: new Date(Date.now() + 4 * 3600e3).toISOString(), p_offer_message: null },
  });
  const [je] = await rest(`jobs?id=eq.${e}&select=helper_id,status`);
  results.E_control_accept_application = { status: re.status, msg: re.json?.message, helper_id_set: je.helper_id === HELPER, job_status: je.status };

  await drop(e);

  // F (control)
  const f = await mkJob("F", offerExtra); made.push(f);
  const rf = await asUser(helperTok, "rpc/respond_to_direct_offer", { method: "POST", body: { p_job_id: f, p_accept: true } });
  const [jf] = await rest(`jobs?id=eq.${f}&select=helper_id,status`);
  results.F_control_respond_to_direct_offer = { status: rf.status, msg: rf.json?.message, helper_id_set: jf.helper_id === HELPER, job_status: jf.status };

  await drop(f);

  for (const k of ["A_poster_patch_hire", "B_target_patch_hire", "C_poster_repoint_offer", "D_poster_insert_roster"]) {
    const r = results[k];
    r.verdict = r.status < 300 && r.rows > 0 ? "BYPASS (write landed)" : "refused";
    if (r.verdict !== "refused") failed = true;
  }
  for (const k of ["E_control_accept_application", "F_control_respond_to_direct_offer"]) {
    const r = results[k];
    r.verdict = r.status < 300 && r.helper_id_set ? "hired via RPC (ok)" : "CONTROL BROKEN";
    if (r.verdict !== "hired via RPC (ok)") failed = true;
  }
} catch (err) {
  failed = true;
  results.error = String(err?.message ?? err);
} finally {
  const ids = made.join(",");
  if (made.length) {
    for (const t of ["notifications", "notification_logs", "applications", "group_job_helpers", "messages"]) {
      try { await rest(`${t}?job_id=in.(${ids})`, { method: "DELETE" }); }
      catch (err) { results[`cleanup_${t}`] = String(err.message).slice(0, 200); }
    }
    try { await rest(`jobs?id=in.(${ids})`, { method: "DELETE" }); }
    catch (err) { failed = true; results.cleanup_jobs = String(err.message).slice(0, 300); }
    const left = await rest(`jobs?id=in.(${ids})&select=id`);
    results.jobs_left_after_cleanup = left.length;
    if (left.length) failed = true;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), jobs: made, results }, null, 2));
  process.exit(failed ? 1 : 0);
}
