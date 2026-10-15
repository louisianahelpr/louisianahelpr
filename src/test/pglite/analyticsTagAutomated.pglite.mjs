#!/usr/bin/env node
/**
 * PGlite proof for 20261015022106_analytics_tag_automated (Q?analytics-test-traffic):
 * robot rows in analytics_events are TAGGED on insert (seed user, local
 * preview Origin, headless user agent), a client tag keeps its reason, real
 * people (web, iOS capacitor://localhost, Android https://localhost) are left
 * alone, the funnel view leaves robots out, and the backfill MARKS past robot
 * rows without deleting any.
 *
 *   node src/test/pglite/analyticsTagAutomated.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/analyticsTagAutomated.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The migration
 * is applied 3x (replay safety). request.headers is set the way PostgREST sets it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = "20261015022106_analytics_tag_automated.sql";
const sql = readFileSync(new URL(`../../../supabase/migrations/${MIG}`, import.meta.url).pathname, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SEED = "00000000-0000-0000-0000-0000000000a1";
const REAL = "00000000-0000-0000-0000-0000000000b2";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles VALUES ('${SEED}', true), ('${REAL}', false);
CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  url text,
  referrer text,
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.analytics_events TO anon, authenticated;
GRANT ALL ON public.analytics_events TO service_role;
-- Rows written BEFORE the migration (the backfill's input).
INSERT INTO public.analytics_events (user_id, event, referrer) VALUES
  ('${SEED}', 'old_seed', NULL),
  (NULL, 'old_local', 'http://127.0.0.1:4173/signup'),
  (NULL, 'old_anon', NULL),
  (NULL, 'old_fb', 'https://facebook.com/'),
  ('${REAL}', 'old_real', NULL);
`);

if (!skip) for (let i = 0; i < 3; i++) await db.exec(sql);

const PROD_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
async function insertAs(role, { event, userId = null, origin, ua = PROD_UA, props = {}, rawHeaders }) {
  const headers = rawHeaders ?? JSON.stringify({ ...(origin ? { origin } : {}), "user-agent": ua });
  await db.exec("BEGIN");
  await db.query("SELECT set_config('request.headers', $1, true)", [headers]);
  await db.exec(`SET LOCAL ROLE ${role}`);
  let err = null;
  try {
    await db.query("INSERT INTO public.analytics_events (user_id, event, properties) VALUES ($1, $2, $3)", [userId, event, JSON.stringify(props)]);
  } catch (e) {
    err = e;
  }
  await db.exec("COMMIT");
  return err;
}
const propsOf = async (event) =>
  (await db.query("SELECT properties FROM public.analytics_events WHERE event = $1", [event])).rows[0]?.properties ?? null;
const reasonOf = async (event) => (await propsOf(event))?.automation ?? null;

await insertAs("anon", { event: "preview_anon", origin: "http://127.0.0.1:4173" });
await insertAs("anon", { event: "localhost_dev", origin: "http://localhost:8080" });
await insertAs("anon", { event: "headless", origin: "https://www.louisianahelpr.com", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36" });
await insertAs("authenticated", { event: "seed_signed_in", userId: SEED, origin: "https://www.louisianahelpr.com" });
await insertAs("anon", { event: "client_tagged", origin: "https://www.louisianahelpr.com", props: { step: 1, automated: true, automation: "webdriver" } });
await insertAs("anon", { event: "person_web", origin: "https://www.louisianahelpr.com", props: { source: "web" } });
await insertAs("authenticated", { event: "person_ios", userId: REAL, origin: "capacitor://localhost" });
await insertAs("authenticated", { event: "person_android", userId: REAL, origin: "https://localhost" });
await insertAs("anon", { event: "spoofed_false", origin: "http://127.0.0.1:4173", props: { automated: false } });
const badErr = await insertAs("anon", { event: "bad_headers", rawHeaders: "{not json" });
await insertAs("anon", { event: "no_headers", rawHeaders: "" });

check("a local preview build (Origin http://127.0.0.1:4173) is tagged local_origin", (await reasonOf("preview_anon")) === "local_origin", String(await reasonOf("preview_anon")));
check("a dev build (Origin http://localhost:8080) is tagged local_origin", (await reasonOf("localhost_dev")) === "local_origin");
check("a HeadlessChrome user agent is tagged headless_ua", (await reasonOf("headless")) === "headless_ua");
check("a test profile's row is tagged seed_user", (await reasonOf("seed_signed_in")) === "seed_user");
check("a client-tagged row keeps its own reason", (await reasonOf("client_tagged")) === "webdriver");
check("a client tag cannot un-tag a local preview row (automated:false)", (await reasonOf("spoofed_false")) === "local_origin");
for (const e of ["person_web", "person_ios", "person_android"]) {
  const p = await propsOf(e);
  check(`a person's row (${e}) is NOT tagged`, p !== null && !("automated" in p), JSON.stringify(p));
}
check("unreadable request.headers never fails the insert", badErr === null && (await propsOf("bad_headers")) !== null, String(badErr?.message ?? ""));
check("an insert with no headers is stored untagged", (await propsOf("no_headers")) !== null && !("automated" in ((await propsOf("no_headers")) ?? {})));
check("caller props survive the tag", (await propsOf("client_tagged"))?.step === 1);

// Backfill: marks, never deletes.
const total = Number((await db.query("SELECT count(*)::int n FROM public.analytics_events")).rows[0].n);
check("nothing was deleted (5 old rows + 11 inserted)", total === 16, String(total));
check("the backfill marked a test profile's past row", (await reasonOf("old_seed")) === "backfill_seed_user");
check("the backfill marked a local-preview referrer's past row", (await reasonOf("old_local")) === "backfill_local_referrer");
for (const e of ["old_anon", "old_fb", "old_real"]) {
  check(`the backfill left ${e} unmarked`, !("automated" in ((await propsOf(e)) ?? {})));
}

// The funnel view.
let viewRows = [];
try {
  viewRows = (await db.query("SELECT event FROM public.analytics_events_real ORDER BY event")).rows.map((r) => r.event);
} catch (e) {
  viewRows = [`<error: ${e.message}>`];
}
const expected = ["bad_headers", "no_headers", "old_anon", "old_fb", "old_real", "person_android", "person_ios", "person_web"];
check("analytics_events_real holds exactly the people's rows", JSON.stringify(viewRows) === JSON.stringify(expected), viewRows.join(","));

for (const role of ["anon", "authenticated"]) {
  let denied = false;
  await db.exec("BEGIN");
  await db.exec(`SET LOCAL ROLE ${role}`);
  try {
    await db.query("SELECT 1 FROM public.analytics_events_real LIMIT 1");
  } catch {
    denied = true;
  }
  await db.exec("ROLLBACK");
  check(`${role} cannot read analytics_events_real`, denied);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
