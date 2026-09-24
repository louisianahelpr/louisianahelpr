/**
 * PGlite proof for 20260923205635_notification_producers_carry_their_subject
 * (docs/OPEN.md Q139).
 *
 *   node src/test/pglite/notificationProducersCarrySubject.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/notificationProducersCarrySubject.pglite.mjs  # RED: the previous definitions
 *   NEW_MIGRATION_FILE=<path> node src/test/pglite/notificationProducersCarrySubject.pglite.mjs  # run another cut of the file
 *
 * The PREVIOUS state is built the way prod got it: each function's newest
 * CREATE FUNCTION text, with the two in-place link rewrites (20260831232514,
 * 20260901021929: pg_get_functiondef + regexp_replace + EXECUTE) executed
 * verbatim at their point in the timeline. The first cut of Q139 restated from
 * the newest TEXT and reverted 14 of those links; the "keeps every link" checks
 * below fail on it (NEW_MIGRATION_FILE=<that file>).
 *
 * Runs the REAL Q137 boundary (20260923121354, verbatim) and the REAL producer
 * definitions: with the new migration applied 3x (replay-safety), or, with
 * NEW_MIGRATION=skip, each function's newest definition from BEFORE it (parsed
 * out of supabase/migrations, so the RED run is the state prod had).
 *
 * For every producer that can be driven here, the same event is fired twice:
 *   - on a SEED job (or by a SEED member) with a REAL recipient: no row lands,
 *     and notification_logs records a 'suppressed_seed' drop;
 *   - on a REAL job (or member): the row lands exactly as before, now with
 *     job_id set (or the member in the link).
 * open_dispute_as is not driven here (it needs the whole dispute stack); its
 * change is covered by src/test/seedNeverNotifiesReal.test.ts and by applying
 * the file 3x below.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(MIG_DIR + f, "utf8");
const LINK_REWRITES = [
  "20260831232514_notification_links_land_on_the_right_spot.sql",
  "20260901021929_notification_links_never_carry_a_fixed_filter.sql",
];
const NEW_FILE = "20260923205635_notification_producers_carry_their_subject.sql";
const BOUNDARY = mig("20260923121354_seed_subject_never_notifies_real.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the PREVIOUS definitions (expect FAILs)`);

const FNS = [
  "check_referral_bonus", "track_revision_scope_creep", "notify_poster_on_status_change", "notify_helper_on_tip",
  "notify_helper_on_direct_offer", "notify_helper_application_viewed", "respond_to_direct_offer",
  "expire_unanswered_offers", "sweep_dayof_confirm_reminders", "apply_job_denial_consequence",
  "sweep_release_last_chance", "helper_abort_job", "apply_low_rating_flag", "apply_consequence_ladder",
  "notify_on_payment_escrowed", "open_dispute_as",
];

/** The newest CREATE FUNCTION statement for `name` in migrations strictly before `before`, and its file. */
function previousDefinition(name, before) {
  let last = null;
  let file = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?"?${name}"?\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index + tag[0].length;
      const close = rest.indexOf(tag[1], open) + tag[1].length;
      const end = rest.indexOf(";", close);
      last = rest.slice(0, end + 1).replace(/^CREATE\s+FUNCTION/i, "CREATE OR REPLACE FUNCTION");
      file = f;
    }
  }
  if (!last) throw new Error(`no previous definition of ${name}`);
  return { stmt: last, file };
}

/** Every link a body writes ('/…' literal + `|| x[::t]` chain), '&user=' || x folded away. */
function linksOf(src) {
  return (src.match(/'\/[^']*'(?:\s*\|\|\s*[\w.]+(?:::\w+)?)*/g) ?? [])
    .map((l) => l.replace(/\s+/g, " ").replace(/&user=' \|\| [\w.]+(?:::\w+)?$/, "'"))
    .sort();
}
async function linksByFunction() {
  const { rows } = await db.query(`SELECT proname, prosrc FROM pg_proc WHERE proname = ANY($1::text[])`, [FNS]);
  return new Map(rows.map((r) => [r.proname, linksOf(r.prosrc)]));
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const J = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const REAL_POSTER = U(1);
const REAL_HELPER = U(2);
const SEED_POSTER = U(3);
const SEED_HELPER = U(4);
const REAL_ADMIN = U(5);
const REAL_REFERRER = U(6);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'revision_requested', 'completed', 'cancelled', 'disputed');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false, full_name text, email text,
  ban_status text DEFAULT 'active', subscription_tier text, subscription_expires_at timestamptz, auto_suspended_until timestamptz,
  parish text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid,
  status public.job_status DEFAULT 'open', payment_status text, is_seed boolean DEFAULT false, budget numeric DEFAULT 100,
  helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz, poster_completed_at timestamptz,
  revision_requested_at timestamptz, revision_count integer DEFAULT 0, revision_note text, revision_deadline timestamptz,
  release_last_chance_notif_sent_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz,
  date_needed date, start_time time, helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz,
  poster_confirmed_at timestamptz, response_deadline timestamptz, offered_to_helper_id uuid, direct_offer_status text,
  direct_offer_expires_at timestamptz, proof_before_urls text[], proof_after_urls text[], dispute_status text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL, type text NOT NULL DEFAULT 'info', read boolean DEFAULT false, link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL);
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, recipient_email text,
  category text NOT NULL, channel text NOT NULL, status text NOT NULL, subject text, job_id uuid, error_message text,
  message_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_preferences (user_id uuid UNIQUE, transit_updates boolean, work_status boolean, financial_alerts boolean);
CREATE TABLE public.match_digest_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL);
CREATE TABLE public.tips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, amount numeric, payment_status text);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, message text,
  status text DEFAULT 'pending', poster_viewed_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.referrals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid, referred_id uuid, referral_code_id uuid);
CREATE TABLE public.referral_credits (user_id uuid, amount numeric, reason text, referral_code_id uuid, referred_user_id uuid);
CREATE TABLE public.fraud_flags (user_id uuid, flag_type text, details text, job_id uuid);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, description text,
  job_id uuid, action_taken text, reported_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.user_bans (user_id uuid, ban_type text, reason text, banned_by uuid);
CREATE TABLE public.reviews (reviewer_id uuid, reviewee_id uuid, rating integer);

CREATE FUNCTION public.log_notification(_user_id uuid, _category text, _channel text, _status text, _subject text DEFAULT NULL,
  _job_id uuid DEFAULT NULL, _error text DEFAULT NULL, _message_id text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN RAISE WARNING 'cron defect % %: %', a, b, c; END $$;

-- live notification_job_id_from_link + notifications_fill_job_id (20260901035600)
CREATE FUNCTION public.notification_job_id_from_link(p_link text) RETURNS uuid LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO 'public', 'pg_temp' AS $$
  SELECT NULLIF(COALESCE(
      (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
      (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]), '')::uuid $$;
CREATE FUNCTION public.notifications_fill_job_id() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_job uuid;
BEGIN
  IF NEW.job_id IS NOT NULL OR NEW.link IS NULL THEN RETURN NEW; END IF;
  v_job := public.notification_job_id_from_link(NEW.link);
  IF v_job IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = v_job) THEN NEW.job_id := v_job; END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_notifications_fill_job_id BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION notifications_fill_job_id();
`);

// The REAL Q137 boundary, verbatim.
await db.exec(BOUNDARY);

// The previous state, as prod got it: newest text, then the in-place link
// rewrites at their point in the timeline.
{
  const prev = FNS.map((fn) => ({ fn, ...previousDefinition(fn, NEW_FILE) })).sort((a, b) => (a.file < b.file ? -1 : 1));
  let k = 0;
  for (const r of LINK_REWRITES) {
    for (; k < prev.length && prev[k].file < r; k++) await db.exec(prev[k].stmt);
    await db.exec(mig(r));
  }
  for (; k < prev.length; k++) await db.exec(prev[k].stmt);
}
const linksBefore = await linksByFunction();
check("previous state: all 16 producers defined", linksBefore.size === FNS.length, `${linksBefore.size}`);
check(
  "previous state: the in-place rewrites landed (notify_poster_on_status_change links ?job=, no fixed ?filter=)",
  (linksBefore.get("notify_poster_on_status_change") ?? []).filter((l) => l === "'/posts?job=' || NEW.id::text").length === 2 &&
    !(linksBefore.get("notify_poster_on_status_change") ?? []).some((l) => l.includes("?filter=")),
  JSON.stringify(linksBefore.get("notify_poster_on_status_change")),
);

// The producers: new migration x3, or stay on the previous definitions.
if (MODE !== "skip") {
  const file = process.env.NEW_MIGRATION_FILE ? readFileSync(process.env.NEW_MIGRATION_FILE, "utf8") : mig(NEW_FILE);
  for (let i = 0; i < 3; i++) await db.exec(file);
  check("the migration applies 3x (replay-safe)", true);
  const linksAfter = await linksByFunction();
  for (const fn of FNS) {
    const a = JSON.stringify(linksBefore.get(fn));
    const b = JSON.stringify(linksAfter.get(fn));
    check(`${fn} keeps every link it wrote (only '&user=' may be added)`, a === b, a === b ? "" : `was ${a} now ${b}`);
  }
}

await db.exec(`
CREATE TRIGGER check_referral_bonus_on_job AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION check_referral_bonus();
CREATE TRIGGER jobs_track_revision_scope_creep BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION track_revision_scope_creep();
CREATE TRIGGER trg_notify_poster_status AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_poster_on_status_change();
CREATE TRIGGER trg_notify_on_payment_escrowed AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_on_payment_escrowed();
CREATE TRIGGER trg_notify_helper_on_direct_offer AFTER INSERT OR UPDATE OF offered_to_helper_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_helper_on_direct_offer();
CREATE TRIGGER trg_notify_helper_tip AFTER INSERT OR UPDATE ON public.tips FOR EACH ROW EXECUTE FUNCTION notify_helper_on_tip();
CREATE TRIGGER on_application_viewed AFTER UPDATE OF poster_viewed_at ON public.applications FOR EACH ROW EXECUTE FUNCTION notify_helper_application_viewed();

INSERT INTO public.profiles (user_id, is_seed, full_name) VALUES
  ('${REAL_POSTER}', false, 'Real Poster'), ('${REAL_HELPER}', false, 'Real Helper'),
  ('${SEED_POSTER}', true, 'Seed Poster'), ('${SEED_HELPER}', true, 'Seed Helper'),
  ('${REAL_ADMIN}', false, 'Real Admin'), ('${REAL_REFERRER}', false, 'Real Referrer');
INSERT INTO public.user_roles VALUES ('${REAL_ADMIN}', 'admin');
`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const rowsFor = (user, title) =>
  q(`SELECT user_id, title, link, job_id FROM public.notifications WHERE user_id = $1 AND title = $2`, [user, title]);
const suppressed = (user, subject) =>
  q(`SELECT 1 FROM public.notification_logs WHERE user_id = $1 AND status = 'suppressed_seed' AND subject = $2`, [user, subject]);
let jobN = 0;
const newJob = async (seed, cols = {}) => {
  const id = J(++jobN);
  const base = { id, title: `Job ${jobN}`, customer_id: REAL_POSTER, helper_id: REAL_HELPER, is_seed: seed, ...cols };
  const keys = Object.keys(base);
  await db.query(
    `INSERT INTO public.jobs (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
    keys.map((k) => base[k]),
  );
  return id;
};
const reset = () => db.exec("DELETE FROM public.notifications; DELETE FROM public.notification_logs;");

/** Fire `act(jobId)` on a seed job and a real job; the recipient is always REAL. */
async function pair(label, title, recipient, setup, act, { expectLink } = {}) {
  for (const seed of [true, false]) {
    await reset();
    const job = await setup(seed);
    await act(job);
    const rows = await rowsFor(recipient, title);
    if (seed) {
      check(`${label}: a SEED job does not notify a REAL account`, rows.length === 0, `${rows.length} row(s)`);
      check(`${label}: the drop is recorded as suppressed_seed`, (await suppressed(recipient, title)).length === 1);
    } else {
      check(`${label}: a REAL job still notifies (unchanged)`, rows.length === 1, `${rows.length} row(s)`);
      if (expectLink) check(`${label}: link names the subject`, rows[0]?.link === expectLink(job), rows[0]?.link);
      else check(`${label}: the row carries job_id`, rows[0]?.job_id === job, String(rows[0]?.job_id));
    }
  }
}

// 1. notify_helper_on_tip
await pair("notify_helper_on_tip", "You got a $5 tip!", REAL_HELPER, (s) => newJob(s),
  (job) => db.query(`INSERT INTO public.tips (job_id, helper_id, amount, payment_status) VALUES ($1, $2, 5, 'paid')`, [job, REAL_HELPER]));

// 2. notify_helper_on_direct_offer (AFTER INSERT: the job row exists for the FK)
for (const seed of [true, false]) {
  await reset();
  const job = await newJob(seed, { helper_id: null, offered_to_helper_id: REAL_HELPER, direct_offer_status: "pending" });
  const rows = await rowsFor(REAL_HELPER, "You got a direct job offer!");
  if (seed) check("notify_helper_on_direct_offer (insert): a SEED job does not notify a REAL helper", rows.length === 0, `${rows.length}`);
  else check("notify_helper_on_direct_offer (insert): a REAL job carries job_id", rows.length === 1 && rows[0].job_id === job);
}

// 3. notify_poster_on_status_change
await pair("notify_poster_on_status_change", "Real Helper is on the way", REAL_POSTER, (s) => newJob(s, { status: "accepted" }),
  (job) => db.query(`UPDATE public.jobs SET helper_on_the_way_at = now() WHERE id = $1`, [job]));

// 4. track_revision_scope_creep (BEFORE UPDATE on jobs)
await pair("track_revision_scope_creep (poster)", "⚠️ Scope creep detected", REAL_POSTER,
  (s) => newJob(s, { status: "in_progress", revision_count: 2 }),
  (job) => db.query(`UPDATE public.jobs SET status = 'revision_requested' WHERE id = $1`, [job]));
await pair("track_revision_scope_creep (helper)", "⚠️ Multiple revisions on this job", REAL_HELPER,
  (s) => newJob(s, { status: "in_progress", revision_count: 2 }),
  (job) => db.query(`UPDATE public.jobs SET status = 'revision_requested' WHERE id = $1`, [job]));

// 5. check_referral_bonus (the referrer's half; the helper is the referred account)
await pair("check_referral_bonus", "Referral bonus!", REAL_REFERRER,
  async (s) => {
    await db.exec("DELETE FROM public.referrals; DELETE FROM public.referral_credits;");
    await db.query(`INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id) VALUES ($1, $2, gen_random_uuid())`, [REAL_REFERRER, REAL_HELPER]);
    return newJob(s, { status: "in_progress" });
  },
  (job) => db.query(`UPDATE public.jobs SET status = 'completed' WHERE id = $1`, [job]));

// 6. notify_helper_application_viewed
await pair("notify_helper_application_viewed", "Your application was seen", REAL_HELPER,
  async (s) => {
    const job = await newJob(s, { helper_id: null });
    await db.query(`INSERT INTO public.applications (job_id, helper_id) VALUES ($1, $2)`, [job, REAL_HELPER]);
    return job;
  },
  (job) => db.query(`UPDATE public.applications SET poster_viewed_at = now() WHERE job_id = $1`, [job]));

// 7. notify_on_payment_escrowed: 'Payout released'
await pair("notify_on_payment_escrowed (Payout released)", "Payout released", REAL_HELPER,
  (s) => newJob(s, { payment_status: "payout_pending", status: "completed" }),
  (job) => db.query(`UPDATE public.jobs SET payment_status = 'released' WHERE id = $1`, [job]));

// 8. sweep_release_last_chance
await pair("sweep_release_last_chance", "Last chance to review", REAL_POSTER,
  (s) => newJob(s, { status: "in_progress", payment_status: "escrow", helper_completed_at: new Date(Date.now() - 23 * 3600e3).toISOString() }),
  () => db.query(`SELECT public.sweep_release_last_chance()`));

// 9. sweep_dayof_confirm_reminders (helper + poster halves)
const soon = () => {
  const d = new Date(Date.now() + 6 * 3600e3);
  const ct = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const p = Object.fromEntries(ct.map((x) => [x.type, x.value]));
  return { date_needed: `${p.year}-${p.month}-${p.day}`, start_time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
};
await pair("sweep_dayof_confirm_reminders (helper)", "Still on for tomorrow?", REAL_HELPER,
  (s) => newJob(s, { status: "accepted", ...soon() }), () => db.query(`SELECT public.sweep_dayof_confirm_reminders()`));
await pair("sweep_dayof_confirm_reminders (poster)", "Still on for tomorrow?", REAL_POSTER,
  (s) => newJob(s, { status: "accepted", ...soon() }), () => db.query(`SELECT public.sweep_dayof_confirm_reminders()`));
await pair("sweep_dayof_confirm_reminders (unanswered)", "Your Helpr hasn't confirmed yet", REAL_POSTER,
  (s) => newJob(s, { status: "accepted", ...soon() }), () => db.query(`SELECT public.sweep_dayof_confirm_reminders()`));

// 10. expire_unanswered_offers (both halves)
for (const [who, title] of [[REAL_POSTER, "Offer expired — job reopened"], [REAL_HELPER, "You lost a job offer"]]) {
  await pair(`expire_unanswered_offers (${title})`, title, who,
    (s) => newJob(s, { status: "accepted", response_deadline: new Date(Date.now() - 3600e3).toISOString() }),
    () => db.query(`SELECT public.expire_unanswered_offers()`));
}

// 11. respond_to_direct_offer (decline)
await pair("respond_to_direct_offer (decline)", "Offer declined", REAL_POSTER,
  (s) => newJob(s, { helper_id: null, offered_to_helper_id: REAL_HELPER, direct_offer_status: "pending" }),
  async (job) => {
    await db.exec(`SET test.uid = '${REAL_HELPER}'`);
    await db.query(`SELECT public.respond_to_direct_offer($1, false)`, [job]);
    await db.exec(`RESET test.uid`);
  });

// 12. helper_abort_job (not started: reopened)
await pair("helper_abort_job (reopened)", "Your Helpr couldn't finish", REAL_POSTER,
  (s) => newJob(s, { status: "in_progress" }),
  async (job) => {
    await db.exec(`SET test.uid = '${REAL_HELPER}'`);
    await db.query(`SELECT public.helper_abort_job($1, 'sick')`, [job]);
    await db.exec(`RESET test.uid`);
  });

// 13. apply_job_denial_consequence: Elite shield
await db.exec(`UPDATE public.profiles SET subscription_tier = 'elite' WHERE user_id = '${REAL_HELPER}'`);
await pair("apply_job_denial_consequence (Elite shield)", "Your Elite shield absorbed this one", REAL_HELPER,
  async (s) => { await db.exec("DELETE FROM public.user_violations"); return newJob(s); },
  (job) => db.query(`SELECT public.apply_job_denial_consequence($1, $2, 'x')`, [REAL_HELPER, job]));
await db.exec(`UPDATE public.profiles SET subscription_tier = NULL WHERE user_id = '${REAL_HELPER}'`);

// 14/15. member alerts to a REAL admin: a SEED member's is dropped; a real member's names the member.
async function memberPair(label, title, fire) {
  for (const [member, seed] of [[SEED_HELPER, true], [REAL_HELPER, false]]) {
    await reset();
    await fire(member);
    const rows = await rowsFor(REAL_ADMIN, title);
    if (seed) {
      check(`${label}: a SEED member's alert does not reach a REAL admin`, rows.length === 0, `${rows.length} row(s)`);
      check(`${label}: the drop is recorded as suppressed_seed`, (await suppressed(REAL_ADMIN, title)).length === 1);
    } else {
      check(`${label}: a REAL member's alert still lands (unchanged)`, rows.length === 1, `${rows.length} row(s)`);
      check(`${label}: its link names the member`, (rows[0]?.link ?? "").endsWith(`&user=${member}`), rows[0]?.link);
    }
  }
}
await memberPair("apply_low_rating_flag", "Low rating alert", async (member) => {
  await db.exec("DELETE FROM public.reviews; DELETE FROM public.user_violations;");
  await db.query(`INSERT INTO public.reviews VALUES ($1, $2, 1), ($1, $2, 1), ($1, $2, 2)`, [REAL_POSTER, member]);
  await db.exec(`SET test.uid = '${REAL_POSTER}'`);
  await db.query(`SELECT public.apply_low_rating_flag($1)`, [member]);
  await db.exec(`RESET test.uid`);
});
await memberPair("apply_consequence_ladder (ban review)", "Ban review needed", async (member) => {
  await db.query(
    `SELECT public.apply_consequence_ladder($1, 'job_denial', 'x', NULL, 3,
       ARRAY['none','warning','temp_ban','pending_ban_review'], ARRAY['record','final_warning','suspend','permanent'],
       '[null,null,null,{"title":"t","message":"m"}]'::jsonb, true, 7, false, '%s has %s strikes', 'r')`,
    [member],
  );
});
await db.exec(`UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL`);

// Seed-to-seed stays allowed: a seed job's tip to a SEED helper still lands.
await reset();
{
  const job = await newJob(true, { customer_id: SEED_POSTER, helper_id: SEED_HELPER });
  await db.query(`INSERT INTO public.tips (job_id, helper_id, amount, payment_status) VALUES ($1, $2, 5, 'paid')`, [job, SEED_HELPER]);
  const rows = await rowsFor(SEED_HELPER, "You got a $5 tip!");
  check("seed-to-seed is unchanged (a seed job's tip reaches its seed helper)", rows.length === 1 && rows[0].job_id === job);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
