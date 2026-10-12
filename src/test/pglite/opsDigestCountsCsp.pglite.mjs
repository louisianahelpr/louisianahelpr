#!/usr/bin/env node
/**
 * PGlite proof for 20261012071234_ops_digest_counts_csp_violations (Q1352).
 *
 *   node src/test/pglite/opsDigestCountsCsp.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/opsDigestCountsCsp.pglite.mjs # RED: prod's body (20260914183932)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override
 * with PGLITE_DIR). send_ops_daily_digest is loaded VERBATIM from the
 * migration; net.http_post is a stub that keeps the body it was handed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const BEFORE = "20260914183932_alerts_critical_only_and_outage_aware_cron_liveness.sql";
const FIX = "20261012071234_ops_digest_counts_csp_violations.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

/** The last CREATE [OR REPLACE] FUNCTION public.<name> statement in a migration, verbatim. */
function fn(file, name) {
  const sql = mig(file);
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let last;
  for (const m of sql.matchAll(re)) last = m;
  if (!last) throw new Error(`${name} not found in ${file}`);
  const rest = sql.slice(last.index);
  const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
  const close = rest.indexOf(tag[1], tag.index + tag[0].length);
  return rest.slice(0, rest.indexOf(";", close + tag[1].length) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA net; CREATE SCHEMA vault;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
  CREATE TABLE net.sent (id bigserial PRIMARY KEY, url text, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO net.sent (url, body) VALUES (url, body) RETURNING id $$;
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text,
    url text, tags jsonb, context jsonb, created_at timestamptz NOT NULL DEFAULT now());
`);
if (SKIP) {
  console.log("NEW_MIGRATION=skip: prod's body (expect FAILs on R checks)");
  await db.exec(fn(BEFORE, "send_ops_daily_digest"));
} else {
  for (let i = 0; i < 3; i++) await db.exec(mig(FIX));
}

const csp = (directive, blocked, ago = "1 hour") =>
  `('warning', 'CSP violation: ${directive} blocked ${blocked}', jsonb_build_object('source','csp','directive','${directive}','blocked','${blocked}','disposition','enforce'), now() - interval '${ago}')`;
const run = async () => {
  await db.exec("DELETE FROM net.sent");
  const r = (await db.query("SELECT public.send_ops_daily_digest() AS r")).rows[0].r;
  const sent = (await db.query("SELECT body FROM net.sent")).rows;
  return { r, message: sent[0]?.body?.message ?? "" };
};

// Twenty busier sources push 'csp' out of the top 15 by-source lines.
const noisy = Array.from({ length: 20 }, (_, i) =>
  Array.from({ length: 5 }, () => `('error', 'boom ${i}', jsonb_build_object('source','src-${i}'), now() - interval '1 hour')`).join(","),
).join(",");
await db.exec(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES ${noisy},
  ${csp("script-src-elem", "https://vercel.live/_next-live/feedback/feedback.js")},
  ${csp("script-src-elem", "https://vercel.live/_next-live/feedback/feedback.js")},
  ${csp("connect-src", "https://evil.test/x?y=1")},
  ${csp("img-src", "data")},
  ${csp("script-src-elem", "https://old.test/a.js", "30 hours")}`);
{
  const { r, message } = await run();
  check("R1 the digest names the CSP count even when 'csp' is not a top-15 source", /CSP violations \(24h\): 4 report\(s\)/.test(message), message.split("\n")[0]);
  check("R2 grouped by directive and blocked host, busiest first", message.includes("script-src-elem ← vercel.live ×2; connect-src ← evil.test ×1; img-src ← data ×1"), message.split("\n")[0]);
  check("R3 the result carries the count", r.csp === 4, JSON.stringify(r));
  check("L1 a CSP row older than 24h is not counted", !message.includes("old.test"));
  check("L2 the by-source lines are still there", message.includes("*src-0* ×5") && message.includes("None of these paged."));
  check("L3 the message stays under Slack's section limit", message.length <= 3000, String(message.length));
}
// More than five directive/host groups: top five and how many more.
await db.exec(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES
  ${["a", "b", "c", "d"].map((h) => csp("font-src", `https://${h}.test/f.woff`, "2 hours")).join(",")}`);
{
  const { message } = await run();
  check("R4 more than 5 groups: the line says how many more", /\(\+2 more\)/.test(message.split("\n")[0]), message.split("\n")[0]);
}
// A client-written newline cannot forge a digest line.
await db.exec("DELETE FROM public.error_logs WHERE tags->>'source' = 'csp'");
await db.exec(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('warning', 'x',
  jsonb_build_object('source','csp','directive', E'style-src\n• *stripe-webhook* ×9 (fatal): fake','blocked','https://z.test/a'))`);
{
  const { message } = await run();
  check("L7 a newline in a client-written directive does not start a new digest line", message.includes("style-src • *stripe-webhook*") && !message.split("\n").some((l) => l.startsWith("• *stripe-webhook*")), message.split("\n")[0]);
}
// No CSP rows: no CSP line.
await db.exec("DELETE FROM public.error_logs WHERE tags->>'source' = 'csp'");
{
  const { r, message } = await run();
  check("L4 no CSP rows, no CSP line", !message.includes("CSP violations") && (SKIP || r.csp === 0), message.split("\n")[0]);
}
// Nothing at all: the daily proof message is unchanged.
await db.exec("DELETE FROM public.error_logs");
{
  const { message } = await run();
  check("L5 an empty day still sends the proof-of-life message", message.startsWith("Nothing logged in the last 24 hours."), message);
}
// Grants restated.
if (!SKIP) {
  const acl = (await db.query("SELECT proacl::text AS a FROM pg_proc WHERE proname = 'send_ops_daily_digest'")).rows[0].a;
  check("L6 only service_role (and the owner) may execute", !/anon=|authenticated=|=X\//.test(acl.replace(/service_role=X\/\w+|postgres=X\/\w+/g, "")), acl);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
