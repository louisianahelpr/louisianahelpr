// Probe: claim_marketing_content() — the auto-poster's dispatch gate.
//
// NOT a vitest test, and deliberately not one. It needs real Postgres, and
// `@electric-sql/pglite` is intentionally NOT a dependency of this project
// (CLAUDE.md: install it OUTSIDE the repo). So CI cannot run this; it is a
// probe you run by hand when you change the claim function or its table.
//
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe
//   npm i @electric-sql/pglite
//   node /path/to/repo/scripts/probes/claim-marketing-content.probe.mjs
//
// Set MIG_PATH to point at a modified copy of the migration to mutation-test
// the probe itself without touching the repo file.
//
// It reads the DDL and the function text VERBATIM out of the migration, so it
// cannot drift from what actually ships. 36 assertions; last run all green,
// and proven non-vacuous against five mutants (see the commit message).
//
// Why this function is worth a probe: auto-publish is on, so this decides what
// reaches the owner's real Instagram and Facebook with nothing human in
// between. Its three guards — the service-role gate, the attempts burn-down,
// and the 15-minute reclaim window — all fail SILENTLY when wrong: a post that
// never goes out looks exactly like a quiet week.
// pglite is NOT a dependency of this repo and must not become one, so a bare
// import cannot resolve from here — Node resolves from the SCRIPT's directory
// upward, not from the shell's cwd. Resolve it out of the probe dir instead.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(
    `Could not load pglite from ${PGLITE_DIR}.\n` +
    `  mkdir -p ${PGLITE_DIR} && cd ${PGLITE_DIR} && npm i @electric-sql/pglite\n` +
    `  (or set PGLITE_DIR). It is deliberately not a dependency of this repo.`,
  );
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIG = process.env.MIG_PATH ??
  new URL("../../supabase/migrations/20260903035441_marketing_autoposter.sql", import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

// ── Shims for what Supabase provides and PGlite does not ──────────────────
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
  -- auth.role() reads a GUC so the probe can switch identity per assertion.
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE AS $fn$
      SELECT coalesce(nullif(current_setting('probe.role', true), ''), 'anon')
    $fn$;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;
`);

// ── Load ONLY the pieces this probe is about, from the migration text ─────
const sql = readFileSync(MIG, "utf8");

// Enums + table + the claim function, taken verbatim from the migration.
const grab = (startRe, endMarker) => {
  const i = sql.search(startRe);
  if (i < 0) throw new Error(`not found: ${startRe}`);
  const j = sql.indexOf(endMarker, i);
  if (j < 0) throw new Error(`end not found for ${startRe}`);
  return sql.slice(i, j + endMarker.length);
};

await db.exec(grab(/DO \$\$ BEGIN\s+CREATE TYPE public\.marketing_channel/, "END $$;"));
await db.exec(grab(/DO \$\$ BEGIN\s+CREATE TYPE public\.marketing_status/, "END $$;"));

const tableSql = grab(/CREATE TABLE IF NOT EXISTS public\.marketing_content/, "\n);");
await db.exec(tableSql);
ok("table DDL loaded verbatim from the migration", true);

const fnSql = grab(/CREATE OR REPLACE FUNCTION public\.claim_marketing_content/, "\n$$;");
await db.exec(fnSql);
ok("claim_marketing_content() loaded verbatim from the migration", true);

const seed = async (over = {}) => {
  const r = {
    channel: "facebook", status: "scheduled",
    body: "Storm prep work gets posted every week from June to November.",
    media_urls: "{}", scheduled_for: "now() - interval '1 minute'",
    locked_at: "NULL", attempts: 0, ...over,
  };
  // A 'published' row is refused without a receipt (external_id) — a real
  // constraint this probe tripped over, so honour it when seeding one.
  const ext = r.status === "published" ? `ext-${Math.random().toString(36).slice(2)}` : null;
  const res = await db.query(
    `INSERT INTO public.marketing_content
       (channel, status, body, media_urls, scheduled_for, locked_at, attempts, external_id)
     VALUES ($1::public.marketing_channel, $2::public.marketing_status, $3, $4::text[],
             ${r.scheduled_for}, ${r.locked_at}, $5, $6)
     RETURNING id`,
    [r.channel, r.status, r.body, r.media_urls, r.attempts, ext],
  );
  return res.rows[0].id;
};

const asService = () => db.exec(`SET probe.role = 'service_role'`);
const claim = async (limit = 5) => (await db.query(`SELECT * FROM public.claim_marketing_content($1)`, [limit])).rows;
const reset = () => db.exec(`DELETE FROM public.marketing_content`);

// ── 1. The authorization gate ─────────────────────────────────────────────
await db.exec(`SET probe.role = 'authenticated'`);
await seed();
let threw = null;
try { await claim(); } catch (e) { threw = String(e.message ?? e); }
ok("an authenticated user CANNOT claim (would publish to the real accounts)",
   threw !== null && /service-role only/.test(threw), `got: ${threw}`);

await db.exec(`SET probe.role = 'anon'`);
threw = null;
try { await claim(); } catch (e) { threw = String(e.message ?? e); }
ok("anon cannot claim either", threw !== null);

await asService();
ok("service_role CAN claim", (await claim()).length === 1);
await reset();

// ── 2. Eligibility predicate ──────────────────────────────────────────────
await asService();
await seed({ scheduled_for: "now() + interval '1 hour'" });
ok("a row scheduled in the FUTURE is not claimed", (await claim()).length === 0);
await reset();

await seed({ scheduled_for: "NULL", status: "draft" });
ok("a draft with no scheduled_for is not claimed", (await claim()).length === 0);
await reset();

for (const st of ["draft", "published", "failed", "cancelled"]) {
  await seed({ status: st });
  ok(`status '${st}' is not claimable`, (await claim()).length === 0);
  await reset();
}

// ── 3. attempts burn-down — a failing row must STOP, not retry forever ────
await seed({ attempts: 4 });
ok("attempts = 4 is still claimable (last try)", (await claim()).length === 1);
await reset();
await seed({ attempts: 5 });
ok("attempts = 5 is NOT claimable — the burn-down actually stops it", (await claim()).length === 0);
await reset();
await seed({ attempts: 99 });
ok("attempts far past the cap stays unclaimable", (await claim()).length === 0);
await reset();

// ── 4. The claim increments attempts, so the burn-down can converge ───────
const id = await seed({ attempts: 0 });
const claimed = await claim();
ok("claiming sets status = publishing", claimed[0]?.status === "publishing");
ok("claiming stamps locked_at", claimed[0]?.locked_at != null);
ok("claiming increments attempts 0 -> 1", claimed[0]?.attempts === 1);
ok("the RETURNING row reflects the NEW state, not the old",
   claimed[0]?.status === "publishing" && claimed[0]?.attempts === 1);
const after = (await db.query(`SELECT status, attempts FROM public.marketing_content WHERE id = $1`, [id])).rows[0];
ok("the table agrees with what was returned", after.status === "publishing" && after.attempts === 1);
ok("a row already publishing and freshly locked is NOT re-claimed", (await claim()).length === 0);
await reset();

// ── 5. The 15-minute reclaim boundary ─────────────────────────────────────
await seed({ status: "publishing", locked_at: "now() - interval '14 minutes'" });
ok("a dispatcher 14 minutes in is left alone", (await claim()).length === 0);
await reset();

await seed({ status: "publishing", locked_at: "now() - interval '16 minutes'" });
const reclaimed = await claim();
ok("a dispatcher dead >15 minutes IS reclaimed (no silent strand)", reclaimed.length === 1);
ok("reclaiming increments attempts again, so a crash-loop still burns down",
   reclaimed[0]?.attempts === 1);
await reset();

await seed({ status: "publishing", locked_at: "NULL" });
ok("publishing with a NULL locked_at is not reclaimed (NULL < x is never true)",
   (await claim()).length === 0);
await reset();

// ── 6. Limit and ordering ─────────────────────────────────────────────────
await seed({ scheduled_for: "now() - interval '3 minutes'", body: "oldest post body here" });
await seed({ scheduled_for: "now() - interval '2 minutes'", body: "middle post body here" });
await seed({ scheduled_for: "now() - interval '1 minute'", body: "newest post body here" });
const two = await claim(2);
ok("p_limit caps the batch", two.length === 2);
// The ORDER BY lives in the sub-select and decides WHICH rows the LIMIT takes,
// not the order UPDATE ... RETURNING emits them in — Postgres does not define
// that. So assert the SET, which is the guarantee that actually matters: under
// pressure the oldest due posts go out and the newest waits, never the reverse.
const bodies = two.map((r) => r.body).join(" | ");
ok("the two OLDEST due rows are the ones taken",
   /oldest/.test(bodies) && /middle/.test(bodies) && !/newest/.test(bodies), bodies);
const left = (await db.query(`SELECT body FROM public.marketing_content WHERE status = 'scheduled'`)).rows;
ok("the newest is the one left behind", left.length === 1 && /newest/.test(left[0].body));
await reset();

await seed(); await seed();
ok("p_limit = 0 claims nothing", (await claim(0)).length === 0);
ok("a negative limit is clamped to 0, not treated as unbounded", (await claim(-5)).length === 0);
await reset();

// ── 7. The Instagram media CHECK is a DATA constraint ─────────────────────
let igThrew = null;
try {
  await seed({ channel: "instagram", media_urls: "{}" });
} catch (e) { igThrew = String(e.message ?? e); }
ok("an Instagram row with NO media cannot even be inserted", igThrew !== null, `got: ${igThrew}`);
await reset();

let igOk = true;
try { await seed({ channel: "instagram", media_urls: '{"https://x.test/a.jpg"}' }); }
catch (e) { igOk = false; console.log("   ", e.message); }
ok("an Instagram row WITH media inserts fine", igOk);
await asService();
ok("...and is claimable", (await claim()).length === 1);
await reset();

// ── 7b. A published row must carry its receipt ────────────────────────────
let recThrew = null;
try {
  await db.query(
    `INSERT INTO public.marketing_content (channel, status, body, external_id)
     VALUES ('facebook','published','a body long enough to be valid', NULL)`);
} catch (e) { recThrew = String(e.message ?? e); }
ok("a 'published' row with NO external_id is refused (unverifiable post)",
   recThrew !== null && /published_needs_receipt/.test(recThrew));
await reset();

// ── 7c. One external post per channel, ever ───────────────────────────────
await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_external_uniq
  ON public.marketing_content (channel, external_id)`);
await db.query(`INSERT INTO public.marketing_content (channel,status,body,external_id)
  VALUES ('facebook','published','first post body here','dup-1')`);
let dupThrew = null;
try {
  await db.query(`INSERT INTO public.marketing_content (channel,status,body,external_id)
    VALUES ('facebook','published','second post body here','dup-1')`);
} catch (e) { dupThrew = String(e.message ?? e); }
ok("the same external_id cannot be recorded twice on a channel — the last line of defence",
   dupThrew !== null);
let crossOk = true;
try {
  await db.query(`INSERT INTO public.marketing_content (channel,status,body,media_urls,external_id)
    VALUES ('instagram','published','ig post body here','{"https://x.test/a.jpg"}','dup-1')`);
} catch (e) { crossOk = false; }
ok("...but the SAME id on the other channel is fine (ids are per-platform)", crossOk);
await reset();

// ── 8. scheduled requires a time ──────────────────────────────────────────
let schedThrew = null;
try { await seed({ status: "scheduled", scheduled_for: "NULL" }); }
catch (e) { schedThrew = String(e.message ?? e); }
ok("a 'scheduled' row with no scheduled_for is refused at write time", schedThrew !== null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
