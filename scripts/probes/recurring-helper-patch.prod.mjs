// Q356 live repro: can a signed-in user point jobs.recurring_helper_id at
// someone by a plain PostgREST PATCH? charge-recurring-visits (daily cron,
// service role) books recurring_helper_id onto every future visit of a series
// and charges the poster's saved card for each, so that column is a hire.
//
//   node scripts/probes/recurring-helper-patch.prod.mjs
//
// PROD, shared seed accounts only. Every job is is_seed, owned by poster-e2e,
// and deleted (with its notifications, applications, messages) in `finally`.
// No Stripe object is created; the jobs are born payment_status='escrow' by
// the service role so the award gates behave as on a funded job.
//
// Doors (a bypass when the write LANDS; exit 1 if any does):
//   A  poster PATCHes recurrence_days + recurring_helper_id=<someone who never
//      applied> on their own open job.
//   B  the pending direct-offer target PATCHes recurring_helper_id=self.
// Controls (must SUCCEED, else exit 1 — a fix that breaks series is no fix):
//   C  poster clears recurring_helper_id (PATCH null) on a series that has one.
//   D  the real series path: accept_application by the poster, then the
//      helper's own confirm PATCH (helper_confirmed_at, exactly as
//      useOfferHandlers sends it) — stamp_recurring_series_helper must stamp
//      recurring_helper_id = the hired helper.
import { rest, session, URL_, ANON } from "./lib/prodEnv.mjs";

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f"; // poster-e2e
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5"; // helper-e2e
const OTHER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f"; // helper (seed)

async function asUser(token, path, { method = "GET", body } = {}) {
  // RETURNING * is refused for `authenticated` (offered_to_helper_id is withheld).
  const named = /[?&]select=/.test(path) || path.startsWith("rpc/") ? path : `${path}${path.includes("?") ? "&" : "?"}select=id`;
  const res = await fetch(`${URL_}/rest/v1/${named}`, {
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
const CHILD_TABLES = ["notifications", "notification_logs", "applications", "messages"];
async function drop(id) {
  for (const t of CHILD_TABLES) await rest(`${t}?job_id=eq.${id}`, { method: "DELETE" });
  await rest(`jobs?id=eq.${id}&select=id`, { method: "DELETE" });
}

async function mkJob(tag, extra = {}) {
  const [row] = await rest("jobs?select=id", {
    method: "POST", prefer: "return=representation",
    body: {
      title: `Q356 probe ${tag}`, description: "Q356 recurring_helper_id PATCH probe; deleted by the probe.",
      date_needed: date, budget: 50, customer_id: POSTER, status: "open",
      payment_status: "escrow", is_seed: true, category: "other", location: "4412 Highland Rd, Baton Rouge, LA 70808",
      ...extra,
    },
  });
  return row.id;
}

const summarise = (r) => ({ status: r.status, rows: Array.isArray(r.json) ? r.json.length : 0, msg: r.json?.message });

const made = [];
const results = {};
let failed = false;
try {
  const posterTok = session("poster-e2e").access_token;
  const helperTok = session("helper-e2e").access_token;

  // A
  const a = await mkJob("A"); made.push(a);
  const ra = await asUser(posterTok, `jobs?id=eq.${a}&select=id,recurring_helper_id`, {
    method: "PATCH", body: { recurrence_days: [1, 3], recurrence_weeks: 4, recurring_helper_id: OTHER },
  });
  results.A_poster_patch_recurring_helper = summarise(ra);
  await drop(a);

  // B
  const b = await mkJob("B", {
    recurrence_days: [2], recurrence_weeks: 4,
    offered_to_helper_id: HELPER, direct_offer_status: "pending",
    direct_offer_expires_at: new Date(Date.now() + 8 * 3600e3).toISOString(),
  }); made.push(b);
  const rb = await asUser(helperTok, `jobs?id=eq.${b}&select=id,recurring_helper_id`, {
    method: "PATCH", body: { recurring_helper_id: HELPER },
  });
  results.B_target_patch_recurring_helper = summarise(rb);
  await drop(b);

  // C (control): clearing stays allowed. Seeded by the service role.
  const c = await mkJob("C", { recurrence_days: [4], recurrence_weeks: 4 }); made.push(c);
  await rest(`jobs?id=eq.${c}&select=id`, { method: "PATCH", body: { recurring_helper_id: OTHER } });
  const rc = await asUser(posterTok, `jobs?id=eq.${c}&select=id,recurring_helper_id`, {
    method: "PATCH", body: { recurring_helper_id: null },
  });
  results.C_control_poster_clears = { ...summarise(rc), cleared: rc.json?.[0]?.recurring_helper_id === null };
  await drop(c);

  // D (control): the real series path stamps the hired helper.
  const d = await mkJob("D", { recurrence_days: [5], recurrence_weeks: 4 }); made.push(d);
  const [app] = await rest("applications", { method: "POST", prefer: "return=representation", body: { job_id: d, helper_id: HELPER, status: "pending" } });
  const acc = await asUser(posterTok, "rpc/accept_application", {
    method: "POST",
    body: { p_application_id: app.id, p_deadline: new Date(Date.now() + 4 * 3600e3).toISOString(), p_offer_message: null },
  });
  const confirmedAt = new Date().toISOString();
  const conf = await asUser(helperTok, `jobs?id=eq.${d}&status=eq.accepted&helper_confirmed_at=is.null&select=id,helper_id,recurring_helper_id`, {
    method: "PATCH", body: { helper_confirmed_at: confirmedAt, response_deadline: null },
  });
  const [jd] = await rest(`jobs?id=eq.${d}&select=helper_id,recurring_helper_id,helper_confirmed_at`);
  results.D_control_accept_then_confirm = {
    accept_status: acc.status, accept_msg: acc.json?.message,
    confirm: summarise(conf), stamped: jd.recurring_helper_id === HELPER && jd.helper_id === HELPER,
  };
  await drop(d);

  for (const k of ["A_poster_patch_recurring_helper", "B_target_patch_recurring_helper"]) {
    const r = results[k];
    r.verdict = r.status < 300 && r.rows > 0 ? "BYPASS (write landed)" : "refused";
    if (r.verdict !== "refused") failed = true;
  }
  const cOk = results.C_control_poster_clears.status < 300 && results.C_control_poster_clears.cleared;
  results.C_control_poster_clears.verdict = cOk ? "ok" : "CONTROL BROKEN";
  const dOk = results.D_control_accept_then_confirm.stamped;
  results.D_control_accept_then_confirm.verdict = dOk ? "ok" : "CONTROL BROKEN";
  if (!cOk || !dOk) failed = true;
} catch (err) {
  failed = true;
  results.error = String(err?.message ?? err);
} finally {
  const ids = made.join(",");
  if (made.length) {
    for (const t of CHILD_TABLES) {
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
