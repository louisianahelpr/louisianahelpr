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
 * confirmed, profile marked is_seed), its password reset to a fresh random one
 * each run (never stored), and asserted NOT admin and NOT a test account before
 * anything is judged (else the check would be vacuous). On the company domain,
 * not mailinator: a public inbox would let anyone reset its password.
 *
 * Fails closed: any read that errors, an empty registry, a missing secret, or
 * a non-boolean answer exits 1. Read-only apart from the probe account itself.
 *
 *   VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY \
 *   PLAYWRIGHT_POSTER_EMAIL PLAYWRIGHT_POSTER_PASSWORD node scripts/feature-switch-audience.mjs
 *
 * Verdict logic: judge() below, unit-tested in src/test/featureSwitchAudience.test.ts.
 * Wired nightly: .github/workflows/feature-switch-audience.yml (files nightly-red).
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PROBE_EMAIL = "helpr-switch-probe-1012@louisianahelpr.com";

/**
 * @param {{
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
  const env = process.env;
  const need = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PLAYWRIGHT_POSTER_EMAIL", "PLAYWRIGHT_POSTER_PASSWORD"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`::error::feature-switch-audience: missing ${missing.join(", ")}; the check cannot run and does not pass.`);
    process.exit(1);
  }
  const url = env.VITE_SUPABASE_URL;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, opts);

  const { data: switches, error: swErr } = await service.from("feature_switches").select("key, audience").order("key");
  if (swErr) {
    console.error(`::error::could not read public.feature_switches: ${swErr.message}`);
    process.exit(1);
  }

  // The probe account: find or create, then a fresh password.
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
  const password = randomBytes(24).toString("base64url");
  if (!probeId) {
    const { data, error } = await service.auth.admin.createUser({ email: PROBE_EMAIL, password, email_confirm: true });
    if (error || !data.user) {
      console.error(`::error::could not create the probe account: ${error?.message}`);
      process.exit(1);
    }
    probeId = data.user.id;
    console.log(`created the ordinary probe account ${PROBE_EMAIL} (${probeId})`);
  } else {
    const { error } = await service.auth.admin.updateUserById(probeId, { password, email_confirm: true });
    if (error) {
      console.error(`::error::could not reset the probe account's password: ${error.message}`);
      process.exit(1);
    }
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
  async function signedIn(email, pw) {
    const c = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY, opts);
    const { error } = await c.auth.signInWithPassword({ email, password: pw });
    if (error) {
      console.error(`::error::could not sign in as ${email}: ${error.message}`);
      process.exit(1);
    }
    return c;
  }

  const probeClient = await signedIn(PROBE_EMAIL, password);
  const testerClient = await signedIn(env.PLAYWRIGHT_POSTER_EMAIL, env.PLAYWRIGHT_POSTER_PASSWORD);
  const anonClient = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY, opts);
  const result = {
    switches,
    probe: await answers(probeClient),
    tester: await answers(testerClient),
    anon: await answers(anonClient),
    probeIsTester,
  };
  await probeClient.auth.signOut();
  await testerClient.auth.signOut();

  const problems = judge(result);
  console.log(`switches checked: ${switches.length} (${switches.map((s) => `${s.key}=${s.audience}`).join(", ")})`);
  console.log(`ordinary: ${JSON.stringify(result.probe)}  tester: ${JSON.stringify(result.tester)}  signed out: ${JSON.stringify(result.anon)}`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log("OK: every switch not set to everyone is OFF for an ordinary account; testers see testers switches.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`::error::feature-switch-audience crashed: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
