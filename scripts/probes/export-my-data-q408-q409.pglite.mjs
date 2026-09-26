#!/usr/bin/env node
/**
 * PGlite proof for 20260926041143_export_my_data_rate_limit_and_email_scope
 * (Q408 rate limit, Q409 email-keyed rows).
 *
 *   node scripts/probes/export-my-data-q408-q409.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * SCHEMA. Derived from the export function itself, not typed here: every
 * `FROM public.<table> t` it reads is created with every `t.<column>` it
 * touches (uuid for ids and *_by, timestamptz for *_at, text otherwise). The
 * limiter's table and function come verbatim from 20260902035752.
 *
 * FIXTURE. U signs up at T0 with u@x.test. Before T0 the address belonged to
 * someone else; W is another current user.
 *   email_send_log:    one row to u@x.test before T0, one after.
 *   suppressed_emails: one before T0, one after.
 *   notification_logs: U's own row (user_id=U); a NULL-user row to the address
 *                      before T0 and one after; a row with user_id=W that went
 *                      to the address.
 *   gift_cards:        an UNCLAIMED gift to the address sent before T0 (U can
 *                      claim it); a gift to the address W already claimed.
 *
 *   RED-BEFORE (20260925232153 verbatim): the pre-T0 email/suppression rows,
 *     W's notification row and W's claimed gift are all in U's export; a 6th
 *     call in 10 minutes succeeds.
 *   AFTER (the new migration verbatim, applied 3x): only the after-T0 rows,
 *     U's own notification, and the unclaimed gift; the 6th call raises
 *     P0429; a second user is not limited by the first; anon cannot execute.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const mig = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const OLD = mig("20260925232153_export_my_data.sql");
const NEW = mig("20260926041143_export_my_data_rate_limit_and_email_scope.sql");
const LIMITER = mig("20260902035752_durable_edge_rate_limit.sql");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** Tables and columns the export body reads, from the body itself. */
function schemaFrom(body) {
  const tables = new Map();
  // One section per `v_out := v_out || …`; inside it, every `FROM public.<table> <alias>`
  // gets every `<alias>.<column>` the section mentions (and `- '<col>'` strips).
  for (const section of body.split(/v_out := v_out \|\|/).slice(1)) {
    for (const m of section.matchAll(/FROM public\.(\w+) (\w+)\b/g)) {
      const [, table, alias] = m;
      const cols = tables.get(table) ?? new Set(["id", "created_at"]);
      for (const c of section.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))) cols.add(c[1]);
      if (alias === "t") for (const c of section.matchAll(/- '(\w+)'/g)) cols.add(c[1]);
      tables.set(table, cols);
    }
  }
  return tables;
}
/** Columns the body compares to a boolean (`coalesce(t.x, false)`) are boolean. */
const BOOLEAN_COLS = new Set(
  [...OLD.matchAll(/coalesce\(\w+\.(\w+), *(?:true|false)\)/g)].map((m) => m[1]),
);
const typeOf = (c) =>
  BOOLEAN_COLS.has(c) ? "boolean" :
  c === "id" || /_id$/.test(c) || /_by$/.test(c) ? "uuid" : /_at$/.test(c) ? "timestamptz DEFAULT now()" : "text";

/** The limiter: its table, indexes and function, verbatim from 20260902035752. */
function limiterDDL() {
  const table = LIMITER.match(/CREATE TABLE IF NOT EXISTS public\.edge_rate_limit_log[\s\S]*?\);\n/)[0];
  const fn = LIMITER.match(/CREATE OR REPLACE FUNCTION public\.rate_limit_hit[\s\S]*?\$fn\$;\n/)[0];
  if (!table || !fn) throw new Error("could not locate the limiter DDL");
  return table + fn;
}

const U = "11111111-1111-4111-8111-111111111111";
const W = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const T0 = "2026-09-01T00:00:00Z";
const BEFORE = "2026-08-01T00:00:00Z";
const AFTER = "2026-09-10T00:00:00Z";

async function fresh(migrationText, times) {
  const db = new PGlite();
  const body = OLD.slice(OLD.indexOf("CREATE OR REPLACE FUNCTION public.export_my_data()"));
  const tables = schemaFrom(body);
  // Pin the Q409 columns even if the parser ever misses one.
  for (const [t, cs] of Object.entries({
    email_send_log: ["recipient_email", "created_at"],
    suppressed_emails: ["email", "created_at"],
    notification_logs: ["user_id", "recipient_email", "created_at"],
    gift_cards: ["donor_id", "recipient_id", "recipient_email", "claim_token", "created_at"],
  })) {
    const s = tables.get(t) ?? new Set(["id"]);
    cs.forEach((c) => s.add(c));
    tables.set(t, s);
  }
  let ddl = `
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION public.user_may_see_job_address(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  `;
  for (const [t, cols] of tables) {
    ddl += `CREATE TABLE public.${t} (${[...cols].map((c) => `${c} ${c === "id" ? "uuid DEFAULT gen_random_uuid()" : typeOf(c)}`).join(", ")});\n`;
  }
  await db.exec(ddl);
  await db.exec(limiterDDL());
  for (let i = 0; i < times; i++) await db.exec(migrationText);

  await db.exec(`
    INSERT INTO auth.users VALUES ('${U}', 'u@x.test', '${T0}'), ('${W}', 'w@x.test', '2026-01-01'), ('${V}', 'v@x.test', '${T0}');
    INSERT INTO public.email_send_log (recipient_email, created_at) VALUES ('U@x.test', '${BEFORE}'), ('u@x.test', '${AFTER}');
    INSERT INTO public.suppressed_emails (email, created_at) VALUES ('u@x.test', '${BEFORE}'), ('u@x.test', '${AFTER}');
    INSERT INTO public.notification_logs (user_id, recipient_email, created_at) VALUES
      ('${U}', 'u@x.test', '${AFTER}'),
      (NULL, 'u@x.test', '${BEFORE}'),
      (NULL, 'u@x.test', '${AFTER}'),
      ('${W}', 'u@x.test', '${AFTER}');
    INSERT INTO public.gift_cards (donor_id, recipient_id, recipient_email, claim_token, created_at) VALUES
      ('${W}', NULL, 'u@x.test', 'secret-1', '${BEFORE}'),
      ('${V}', '${W}', 'u@x.test', 'secret-2', '${BEFORE}');
  `);
  return db;
}

async function exportAs(db, uid) {
  await db.exec(`SET request.jwt.claim.sub = '${uid}'`);
  const r = await db.query(`SELECT public.export_my_data() AS x`);
  return r.rows[0].x;
}
const count = (x, k) => (Array.isArray(x[k]) ? x[k].length : -1);

// ── RED-BEFORE: the Q290 function verbatim ────────────────────────────────
{
  const db = await fresh(OLD, 1);
  const x = await exportAs(db, U);
  check("before: email_send_log leaks the pre-sign-up row (2 rows)", count(x, "email_send_log") === 2, `got ${count(x, "email_send_log")}`);
  check("before: suppressed_emails leaks the pre-sign-up row (2 rows)", count(x, "suppressed_emails") === 2, `got ${count(x, "suppressed_emails")}`);
  check("before: notification_logs includes W's and the pre-sign-up rows (4 rows)", count(x, "notification_logs") === 4, `got ${count(x, "notification_logs")}`);
  check("before: gift_cards includes the gift W claimed (2 rows)", count(x, "gift_cards") === 2, `got ${count(x, "gift_cards")}`);
  let sixth = "ok";
  for (let i = 0; i < 5; i++) await exportAs(db, U);
  sixth = await exportAs(db, U).then(() => "ok", (e) => e.code ?? String(e));
  check("before: a 6th call in 10 minutes is NOT limited", sixth === "ok", sixth);
  await db.close();
}

// ── AFTER: the new migration verbatim, applied 3x ─────────────────────────
{
  const db = await fresh(OLD + "\n" + NEW, 1);
  await db.exec(NEW);
  await db.exec(NEW);
  const x = await exportAs(db, U);
  check("after: email_send_log only since sign-up (1 row)", count(x, "email_send_log") === 1, `got ${count(x, "email_send_log")}`);
  check("after: suppressed_emails only since sign-up (1 row)", count(x, "suppressed_emails") === 1, `got ${count(x, "suppressed_emails")}`);
  const nl = x.notification_logs ?? [];
  check("after: notification_logs = U's own + the NULL-user row since sign-up (2 rows)", nl.length === 2, `got ${nl.length}`);
  check("after: notification_logs never includes W's row", !nl.some((r) => r.user_id === W));
  const gc = x.gift_cards ?? [];
  check("after: gift_cards keeps the UNCLAIMED pre-sign-up gift and drops W's claimed one (1 row)", gc.length === 1 && gc[0].recipient_id === null, JSON.stringify(gc.map((g) => g.recipient_id)));
  check("after: claim_token still stripped", gc.every((g) => !("claim_token" in g)));
  check("after: email and user_id header intact", x.email === "u@x.test" && x.user_id === U);

  for (let i = 0; i < 4; i++) await exportAs(db, U); // calls 2..5
  const sixth = await exportAs(db, U).then(() => "ok", (e) => e.code ?? String(e));
  check("after: the 6th call in 10 minutes raises P0429", sixth === "P0429", sixth);
  const other = await exportAs(db, V).then(() => "ok", (e) => e.code ?? String(e));
  check("after: another user is not limited by U's calls", other === "ok", other);
  const vol = await db.query(`SELECT provolatile FROM pg_proc WHERE proname = 'export_my_data'`);
  check("after: export_my_data is VOLATILE (it records a hit)", vol.rows[0]?.provolatile === "v", vol.rows[0]?.provolatile);
  const acl = await db.query(`SELECT has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE') AS anon,
                                     has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE') AS authd`);
  check("after: anon cannot execute; authenticated can", acl.rows[0].anon === false && acl.rows[0].authd === true, JSON.stringify(acl.rows[0]));
  await db.exec(`RESET request.jwt.claim.sub`);
  const unauth = await db.query(`SELECT public.export_my_data()`).then(() => "ok", (e) => e.code ?? String(e));
  check("after: no JWT is refused (42501)", unauth === "42501", unauth);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
