#!/usr/bin/env node
/**
 * PGlite proof for 20261030080734_contact_leak_nfkc.sql (Q1881: the shared contact-leak filter NFKC-normalises and
 * catches spaced single digits).
 *
 *   node src/test/pglite/contactLeakNfkc.pglite.mjs                    # after (3x replay): all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/contactLeakNfkc.pglite.mjs # before (newest older body): RED
 *   MUTANT=<name> node src/test/pglite/contactLeakNfkc.pglite.mjs      # a planted defect: RED
 *
 * World: only public.contact_leak_reason, the REAL newest body (this migration, or with
 * NEW_MIGRATION=skip the newest definition before it), plus the roles its grants name.
 * Each case is a text a member could type; every existing kind of catch is re-checked so the
 * rewrite drops none, and ordinary job text (times, dates, prices, "four or five hours") stays allowed.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261030080734_contact_leak_nfkc.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

function newest(name, before) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

const MUTANTS = {
  // No NFKC: math digits and fullwidth letters pass again.
  nfkc: ["translate(normalize(p_text, NFKC), ", "translate(p_text, "],
  // The payment check reads the raw text again.
  payraw: ["  ELSIF v_norm ~* '\\mvenmo\\M", "  ELSIF p_text ~* '\\mvenmo\\M"],
  // The spaced-digit rule is gone.
  spaced: ["  ELSIF v_tokens ~ '(^|[^0-9])[0-9]([^0-9a-z]{1,3}[0-9]){9}(?![0-9])' THEN", "  ELSIF false THEN"],
  // Number words no longer count as digits in the spaced rule.
  words: ["regexp_replace(v_tokens, '\\mfive\\M', '5', 'g')", "v_tokens"],
};

let sql = skip ? newest("contact_leak_reason", THIS) : readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const [from, to] = MUTANTS[MUTANT] ?? [];
  if (!from || !sql.includes(from)) throw new Error(`mutant ${MUTANT}: anchor not found`);
  sql = sql.replace(from, to);
}

const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
`);
for (let i = 0; i < (skip ? 1 : 3); i++) await db.exec(sql); // replay-safe: applied 3x

const PHONE = "Phone number detected";
const PAY = "Off-platform payment service mentioned";
const CASES = [
  // Q1881: the four forms the review measured passing.
  ["spaced single digits", "call 5 0 4 5 5 5 1 2 1 2 tonight", PHONE],
  ["dashed single digits", "my cell 5-0-4-5-5-5-1-2-1-2", PHONE],
  ["math bold digits", "text 𝟓𝟎𝟒𝟓𝟓𝟓𝟏𝟐𝟏𝟐", PHONE],
  ["digits mixed with words", "five 0 four 5 5 5 one 2 1 2", PHONE],
  ["fullwidth payment app", "pay me on ｃａｓｈａｐｐ", PAY],
  ["fullwidth email", "ｍｅ＠ｅｘａｍｐｌｅ．ｃｏｍ", "Email address detected"],
  // Already caught, must stay caught.
  ["plain 10 digits", "5045551212", PHONE],
  ["3-3-4 groups", "(504) 555-1212", PHONE],
  ["fullwidth digits", "５０４５５５１２１２", PHONE],
  ["seven number words", "five zero four five five five one two one two", PHONE],
  ["email", "me@example.com", "Email address detected"],
  ["venmo", "venmo me", PAY],
  ["intent", "let's do this off the app", "Off-platform payment intent detected"],
  ["location share", "📍 Location: 30.224090,-92.019843", null],
  // Ordinary text stays allowed.
  ["times and dates", "Saturday 10/30/26 at 10:30, about 2-3 hours", null],
  ["prices", "$25 to $30 an hour, 4 or 5 hours", null],
  ["four number words", "it takes four or five hours, one or two people", null],
  ["a short count", "1 2 3 4 5 go", null],
  ["an address number", "1234 Main St, Lafayette LA 70506", null],
  ["blank", "   ", null],
];

let failed = 0;
for (const [label, text, want] of CASES) {
  const { rows } = await db.query("SELECT public.contact_leak_reason($1) AS r", [text]);
  const got = rows[0].r;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
}

// Grants: callable by authenticated and service_role, never anon or PUBLIC.
if (!skip) {
  const { rows } = await db.query(`
    SELECT has_function_privilege('anon', 'public.contact_leak_reason(text)', 'EXECUTE') AS anon,
           has_function_privilege('authenticated', 'public.contact_leak_reason(text)', 'EXECUTE') AS authd,
           has_function_privilege('service_role', 'public.contact_leak_reason(text)', 'EXECUTE') AS svc`);
  const g = rows[0];
  const ok = !g.anon && g.authd && g.svc;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  grants: anon=${g.anon} authenticated=${g.authd} service_role=${g.svc}`);
}

console.log(failed ? `RED: ${failed} failing` : "GREEN: all pass");
process.exit(failed ? 1 : 0);
