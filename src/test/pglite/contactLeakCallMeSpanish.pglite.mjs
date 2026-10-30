#!/usr/bin/env node
/**
 * PGlite proof for 20261030150556_contact_leak_call_me_spanish.sql (Messages audit E3 M3, via the lead 09:12).
 *
 *   node src/test/pglite/contactLeakCallMeSpanish.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/contactLeakCallMeSpanish.pglite.mjs   # RED (prod's function)
 *
 * Before: contact_leak_reason verbatim from the newest migration (20261030080734_contact_leak_nfkc), md5 pinned. Applies the migration 3x
 * and runs the real Postgres regex engine on each case:
 *   - "call me" / "text me" / "llámame" alone pass; next to a phone number or email they are still refused;
 *   - a phone number spelled in Spanish (or Spanish and English mixed) is refused;
 *   - everything else the gate refused before is still refused (payment apps, phrases, email, digits);
 *   - grants unchanged: authenticated executes it, anon does not.
 */
import { PGlite, SCHEMA, readMigration, loadLive, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030150556_contact_leak_call_me_spanish.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const db = new PGlite();
await db.exec(SCHEMA);
// The NEWEST definition, 20261030080734_contact_leak_nfkc (Q1881, on main; prod read 33d05779 on 2026-10-30, the
// definition before it). Pinned so a later restatement cannot slip in under this proof.
await loadLive(db, "contact_leak_reason", NEW, "96e269f7027e94b534af32cd83cfb9a0");
await db.exec(`REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_leak_reason(text) TO authenticated, service_role;`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(NEW));

const reason = async (t) => (await db.query(`SELECT public.contact_leak_reason($1) AS r`, [t])).rows[0].r;

const PASSES = [
  "Call me when you get here",
  "Text me when you're outside",
  "call me if the gate is locked",
  "Llámame cuando llegues",
  "Escríbeme cuando estés afuera",
  "I'll text message you through the app",
];
for (const t of PASSES) check(`passes: "${t}"`, (await reason(t)) === null, String(await reason(t)));

const REFUSED = [
  ["call me at 504-555-0100", "Phone number detected"],
  ["text me jane.doe@gmail.com", "Email address detected"],
  ["llámame al cinco cero cuatro cinco cinco cinco cero uno cero cero", "Phone number detected"],
  ["mi número es cinco cero cuatro, cinco cinco cinco, cero uno cero cero", "Phone number detected"],
  ["five oh four cinco cinco cinco cero one cero cero", "Phone number detected"],
  ["one two three four five six seven", "Phone number detected"],
  ["venmo works", "Off-platform payment service mentioned"],
  ["cash only please", "Off-platform payment intent detected"],
  ["dm me on whatsapp", "Off-platform payment intent detected"],
  ["skip the fee and pay outside", "Off-platform payment intent detected"],
];
for (const [t, want] of REFUSED) check(`refused: "${t}" -> ${want}`, (await reason(t)) === want, String(await reason(t)));

check("a short run of Spanish number words is not a phone number", (await reason("tengo dos perros y tres gatos")) === null);
check("the app's own location share still passes", (await reason("📍 Location: 30.451468,-91.187146")) === null);

const g = (await db.query(`SELECT has_function_privilege('anon', 'public.contact_leak_reason(text)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.contact_leak_reason(text)', 'EXECUTE') b`)).rows[0];
check("grants unchanged: authenticated executes, anon does not", g.a === false && g.b === true, JSON.stringify(g));

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
