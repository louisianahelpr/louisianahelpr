#!/usr/bin/env node
/**
 * PGlite proof for 20261109215021_notices_our_team_and_no_strike (Part 3: F177, wording only; F176 left out, see the migration).
 *
 *   npx tsx src/test/pglite/noticesOurTeamNoStrike.pglite.mjs [--replay] [--before]
 *
 * --before installs each function's previous definition (byte-equal to LIVE prosrc on 11-09): W2-W5 FAIL, S1 PASS.
 *
 *   S1 wording only: every body equals its previous definition with the string literals blanked; grants as live
 *   W2 open_dispute_as's member notices and hints say "our team", never "an admin"/"An admin"
 *   W3 rpc_escalate_dispute: "Our team will decide this dispute", never "escalated to an admin"
 *   W4 rpc_supersede_dispute_decision: "Our team is taking another look"
 *   W5 admin_reverse_violation: "Our team reviewed a warning"
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261109215021_notices_our_team_and_no_strike.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
const FNS = ["open_dispute_as", "rpc_escalate_dispute", "rpc_supersede_dispute_decision", "admin_reverse_violation"];

/** The newest CREATE FUNCTION public.<fn> statement in `sql` (any dollar tag), or null. */
function lastDefinition(sql, fn) {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  let out = null;
  for (const m of sql.matchAll(head)) {
    const rest = sql.slice(m.index);
    const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
    const close = rest.indexOf(tag[1], tag.index + tag[0].length);
    out = rest.slice(0, close + tag[1].length) + ";";
  }
  return out;
}
/** The previous definition: the newest one in any migration BEFORE this one. */
function previousDefinition(fn) {
  let out = null;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const d = lastDefinition(readFileSync(DIR + f, "utf8"), fn);
    if (d) out = d;
  }
  return out;
}
/** A body with every '...' literal blanked and -- comments dropped: what must not change. */
const shape = (src) => src.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ").trim();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
-- plpgsql bodies are parsed at CREATE, not planned: the tables they name need not exist for this proof.
SET check_function_bodies = on;
-- The one row type a DECLARE names (admin_reverse_violation: v_row public.user_violations%ROWTYPE).
CREATE TABLE public.user_violations (id uuid PRIMARY KEY, user_id uuid);
`);
const prev = Object.fromEntries(FNS.map((fn) => [fn, previousDefinition(fn)]));
for (const fn of FNS) if (!prev[fn]) throw new Error(`no previous definition of ${fn}`);
if (BEFORE) {
  for (const fn of FNS) await db.exec(prev[fn]);
} else {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}
const src = {};
for (const fn of FNS) {
  const r = await db.query(`SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE proname = $1`, [fn]);
  src[fn] = r.rows[0]?.prosrc ?? "";
  const acl = r.rows[0]?.acl ?? "";
  const authOk = ["rpc_escalate_dispute", "rpc_supersede_dispute_decision", "admin_reverse_violation"].includes(fn);
  if (!BEFORE) check(`grants: ${fn} as live (service_role${authOk ? " + authenticated" : ""}), never PUBLIC/anon`, /service_role=X/.test(acl) && !/anon=|[{,]=/.test(acl) && (authOk ? /authenticated=X/.test(acl) : !/authenticated=/.test(acl)), acl);
}
const prevBody = (fn) => { const d = prev[fn]; const tag = d.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/); const s = tag.index + tag[0].length; return d.slice(s, d.indexOf(tag[1], s)); };
check("S1 wording only: every body equals its previous definition with the string literals blanked",
  FNS.every((fn) => shape(src[fn]) === shape(prevBody(fn))),
  FNS.filter((fn) => shape(src[fn]) !== shape(prevBody(fn))).join(", "));
/** The string literals of a body, its -- comments dropped first (an apostrophe in a comment is not a quote). */
const lit = (fn) => [...src[fn].replace(/--[^\n]*/g, "").matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]);
check("W2 open_dispute_as says our team, never an admin, in member words", lit("open_dispute_as").filter((t) => /\b[Aa]n admin\b/.test(t)).length === 0 && src.open_dispute_as.includes("add your side so our team hears from you both."));
check("W3 escalation says Our team will decide this dispute", (src.rpc_escalate_dispute.match(/'Our team will decide this dispute'/g) ?? []).length === 2 && !src.rpc_escalate_dispute.includes("'Dispute escalated to an admin'"));
check("W4 re-opened dispute says our team", (src.rpc_supersede_dispute_decision.match(/Our team is taking another look/g) ?? []).length === 2);
check("W5 removed warning says our team", src.admin_reverse_violation.includes("Our team reviewed a warning on your account"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
