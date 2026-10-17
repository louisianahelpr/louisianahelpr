#!/usr/bin/env node
/**
 * Nightly prod check: a hidden feature switch never reaches an ordinary account.
 *
 * Hidden feature switches (migration 20261012031120, owner decision 2026-10-11)
 * are on only for testers (admin role + public.test_accounts) until an admin
 * flips one to 'everyone'. This signs in to PROD as an ORDINARY account (not an
 * admin, not in test_accounts) and asks public.feature_enabled_for(key) for
 * every switch in the registry:
 *
 *   audience off / testers   -> must answer exactly false   (the leak this exists for)
 *   audience everyone        -> must answer exactly true
 *
 * and, so a function that answers false to everyone cannot pass this vacuously,
 * a POSITIVE CONTROL: a test account (PLAYWRIGHT_POSTER_*, enrolled in
 * test_accounts) must get exactly true for every 'testers' switch, and at
 * least one 'testers' switch must exist (switch_canary is created as one).
 * A signed-out caller must be refused or answered false.
 *
 * THE ORDINARY ACCOUNT. Every shared CI account is a tester, so there is no
 * ordinary credential to borrow. The probe is one dedicated account,
 * PROBE_EMAIL below: created on first run with the service role (email
 * confirmed, profile marked is_seed, no password: every session here is minted
 * with the service role, scripts/lib/adminSession.mjs, Q1314), and asserted NOT
 * admin and NOT a test account before
 * anything is judged (else the check would be vacuous). A @mailinator.com
 * fixture inbox (2026-10-13): mintAdminSession signs in only the shared test
 * accounts and mailinator fixture inboxes (Q1422), and the company-domain probe
 * it first used was refused, so the nightly run went red (nightly-red #2978,
 * run 38446754274). The account holds nothing (no password, is_seed, no role);
 * someone who reset it through the public inbox would hold an empty member.
 *
 * EVERY REGISTRY KEY HAS A LIVE ROW, both ways (Q1847). The app's registry
 * (FEATURE_SWITCH_KEYS, src/config/featureSwitches.ts) must equal the keys of
 * the live public.feature_switches rows. feature_enabled_for answers false for
 * a key with no row, so if functions-deploy ships a function gated on a switch
 * whose migration db-deploy never applied, that function refuses everyone
 * (the App Review account included) with no other signal. A live row the
 * registry no longer lists is a leftover no screen reads.
 *
 * Fails closed: any read that errors, an empty registry, a missing secret, or
 * a non-boolean answer exits 1. Read-only apart from the probe account itself.
 *
 *   VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY \
 *   PLAYWRIGHT_POSTER_EMAIL node scripts/feature-switch-audience.mjs
 *
 * Verdict logic: judge() below, unit-tested in src/test/featureSwitchAudience.test.ts.
 * Wired nightly: .github/workflows/feature-switch-audience.yml (files nightly-red).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROBE_EMAIL = "helpr-switch-probe-1013@mailinator.com";

/** The client registry file whose FEATURE_SWITCH_KEYS must match the live rows. */
export const REGISTRY_FILE = join(import.meta.dirname, "..", "src", "config", "featureSwitches.ts");

/**
 * The keys of FEATURE_SWITCH_KEYS, read from the TypeScript source (this runs
 * under plain node, which cannot import .ts). Each key sits on its own line as
 * `"key",`; comment lines between them never start with a double quote.
 * src/test/featureSwitchAudience.test.ts holds this to the imported array.
 * @param {string} src
 * @returns {string[] | null} null when the array cannot be found
 */
export function registryKeysFromSource(src) {
  const m = /export const FEATURE_SWITCH_KEYS = \[\n([\s\S]*?)\n\] as const;/.exec(String(src));
  if (!m) return null;
  return [...m[1].matchAll(/^\s*"([a-z0-9_]+)",?\s*$/gm)].map((x) => x[1]);
}

/**
 * The registry keys read from the file on disk; null (after an ::error:: line)
 * when the file cannot be read, so judge() fails closed.
 * @param {string} [file]
 * @returns {string[] | null}
 */
export function readRegistryKeys(file = REGISTRY_FILE) {
  try {
    return registryKeysFromSource(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`::error::could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * @param {{
 *   registry: string[] | null,            // FEATURE_SWITCH_KEYS (registryKeysFromSource)
 *   switches: { key: string, audience: string }[] | null,
 *   probe: Record<string, unknown>,       // key -> answer for the ordinary account ({ error } on failure)
 *   tester: Record<string, unknown>,      // key -> answer for the test account
 *   anon: Record<string, unknown>,        // key -> answer signed out
 *   probeIsTester: boolean | null,        // admin role or test_accounts row
 * }} r
 * @returns {string[]} problems; empty = pass
 */
export function judge(r) {
  const problems = [];
  if (!Array.isArray(r.switches)) return ["could not read public.feature_switches"];
  if (r.switches.length === 0) return ["public.feature_switches is empty: nothing to check (switch_canary should exist)"];
  if (!Array.isArray(r.registry) || r.registry.length === 0) {
    return ["could not read FEATURE_SWITCH_KEYS from src/config/featureSwitches.ts: the live rows cannot be held to the registry"];
  }
  const live = new Set(r.switches.map((s) => s.key));
  for (const key of r.registry) {
    if (!live.has(key)) {
      problems.push(`${key}: in FEATURE_SWITCH_KEYS but NO live feature_switches row, so feature_enabled_for answers false for everyone and every function gated on it refuses (did db-deploy fail after functions-deploy shipped? Q1847)`);
    }
  }
  const registry = new Set(r.registry);
  for (const key of live) {
    if (!registry.has(key)) problems.push(`${key}: a live feature_switches row FEATURE_SWITCH_KEYS does not list (a leftover, or the registry lost it)`);
  }
  if (r.probeIsTester !== false) {
    return [`the probe account's tester status is ${r.probeIsTester === true ? "TRUE (admin or test account)" : "unknown"}: an ordinary account is required`];
  }
  const testersSwitches = r.switches.filter((s) => s.audience === "testers");
  if (testersSwitches.length === 0) {
    problems.push("no switch is set to 'testers', so the positive control cannot run (set switch_canary back to Testers only)");
  }
  for (const { key, audience } of r.switches) {
    const p = r.probe[key];
    if (typeof p !== "boolean") {
      problems.push(`${key}: the ordinary account got no boolean answer (${JSON.stringify(p)})`);
    } else if (audience === "everyone" ? p !== true : p !== false) {
      problems.push(`${key} (audience ${audience}): ordinary account got ${p}${audience === "everyone" ? "" : " — LEAK: a hidden feature reaches a non-tester"}`);
    }
    if (audience === "testers" && r.tester[key] !== true) {
      problems.push(`${key} (testers): the test account got ${JSON.stringify(r.tester[key])}, expected true (positive control)`);
    }
    const a = r.anon[key];
    if (a === true) problems.push(`${key}: a signed-out caller got true`);
  }
  return problems;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { mintAdminSession, resolveServiceKey } = await import("./lib/adminSession.mjs");
  const env = process.env;
  const serviceKey = resolveServiceKey();
  const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "PLAYWRIGHT_POSTER_EMAIL"].filter((k) => !env[k]);
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`::error::feature-switch-audience: missing ${missing.join(", ")}; the check cannot run and does not pass.`);
    process.exit(1);
  }
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, serviceKey, opts);

  const { data: switches, error: swErr } = await service.from("feature_switches").select("key, audience").order("key");
  if (swErr) {
    console.error(`::error::could not read public.feature_switches: ${swErr.message}`);
    process.exit(1);
  }

  // The probe account: find it, or create it (email confirmed, no password:
  // sessions are minted with the service role, never a password grant, Q1314).
  let probeId = null;
  for (let page = 1; page <= 50 && !probeId; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error(`::error::could not list users to find the probe account: ${error.message}`);
      process.exit(1);
    }
    probeId = data.users.find((u) => u.email?.toLowerCase() === PROBE_EMAIL)?.id ?? null;
    if (data.users.length < 1000) break;
  }
  if (!probeId) {
    // seed-policy: patched below (profiles.is_seed set to true right after)
    const { data, error } = await service.auth.admin.createUser({ email: PROBE_EMAIL, email_confirm: true });
    if (error || !data.user) {
      console.error(`::error::could not create the probe account: ${error?.message}`);
      process.exit(1);
    }
    probeId = data.user.id;
    console.log(`created the ordinary probe account ${PROBE_EMAIL} (${probeId})`);
  }
  // Test-owned data is marked is_seed (CLAUDE.md). The profile row is created by
  // the signup trigger; a failure here is reported but does not change the verdict.
  const { error: seedErr } = await service.from("profiles").update({ is_seed: true }).eq("user_id", probeId);
  if (seedErr) console.warn(`::warning::could not mark the probe profile is_seed: ${seedErr.message}`);

  const [{ data: roles, error: rErr }, { data: tests, error: tErr }] = await Promise.all([
    service.from("user_roles").select("role").eq("user_id", probeId).eq("role", "admin"),
    service.from("test_accounts").select("user_id").eq("user_id", probeId),
  ]);
  const probeIsTester = rErr || tErr ? null : (roles?.length ?? 0) > 0 || (tests?.length ?? 0) > 0;

  async function answers(client) {
    const out = {};
    for (const { key } of switches ?? []) {
      const { data, error } = await client.rpc("feature_enabled_for", { p_key: key });
      out[key] = error ? { error: error.message } : data;
    }
    return out;
  }
  async function signedIn(email) {
    let session;
    try {
      session = await mintAdminSession({ email, serviceKey, supabaseUrl: url, anonKey });
    } catch (err) {
      console.error(`::error::could not mint a session for ${email}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${session.access_token}` } } });
  }

  const registry = readRegistryKeys();
  const result = {
    registry,
    switches,
    probe: await answers(await signedIn(PROBE_EMAIL)),
    tester: await answers(await signedIn(env.PLAYWRIGHT_POSTER_EMAIL)),
    anon: await answers(createClient(url, anonKey, opts)),
    probeIsTester,
  };

  const problems = judge(result);
  console.log(`registry keys: ${registry?.length ?? "unreadable"} (${(registry ?? []).join(", ")})`);
  console.log(`switches checked: ${switches.length} (${switches.map((s) => `${s.key}=${s.audience}`).join(", ")})`);
  console.log(`ordinary: ${JSON.stringify(result.probe)}  tester: ${JSON.stringify(result.tester)}  signed out: ${JSON.stringify(result.anon)}`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log("OK: every registry key has a live row and every live row is in the registry; every switch not set to everyone is OFF for an ordinary account; testers see testers switches.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`::error::feature-switch-audience crashed: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
