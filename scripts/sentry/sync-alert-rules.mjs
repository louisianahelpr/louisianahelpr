#!/usr/bin/env node
/**
 * Q185: create or update the Sentry issue alerts in scripts/sentry/alertRules.mjs
 * (mapped from docs/SENTRY_ALERT_RULES.md), then READ THEM BACK and fail unless
 * each one exists once with the expected name, environment, triggers,
 * conditions and email action. Run by .github/workflows/sentry-alert-rules.yml.
 *
 *   SENTRY_ALERTS_TOKEN  token with Alerts read+write and Project read. Absent ->
 *                        a ::notice:: naming it, exit 0 (nothing to do yet).
 *   SENTRY_ORG           org slug (helpr-4m), SENTRY_PROJECT project slug (javascript)
 *   LH_SENTRY_API_BASE   default https://sentry.io (tests point it at a stub)
 *   DRY_RUN=1            print the payloads; no network call at all
 *
 * Idempotent: lists every alert, matches by exact name, creates the missing,
 * updates the drifted (PUT by id), leaves identical ones alone. It never
 * deletes anything, and alerts with other names are never touched.
 * Endpoint and payload citations live beside each shape in alertRules.mjs.
 */
import { pathToFileURL } from "node:url";
import { RULES, buildPayload, planRules, verifyReadback } from "./alertRules.mjs";

const env = process.env;
const TOKEN_NAME = "SENTRY_ALERTS_TOKEN";
const DETECTOR_PLACEHOLDER = "<the project's issue_stream monitor id, read at run time>";

function dryRun() {
  console.log(`DRY_RUN=1: ${RULES.length} alert payloads, environment production, email only. No API call made.`);
  console.log(`Target: POST/PUT ${env.LH_SENTRY_API_BASE || "https://sentry.io"}/api/0/organizations/${env.SENTRY_ORG || "<SENTRY_ORG>"}/workflows/`);
  for (const rule of RULES) {
    const payload = { ...buildPayload(rule, { detectorId: 0 }), detectorIds: [DETECTOR_PLACEHOLDER] };
    console.log(`\n# ${rule.doc} (${rule.tier}): ${rule.name}`);
    console.log(JSON.stringify(payload));
  }
  return 0;
}

function apiBase() {
  const base = (env.LH_SENTRY_API_BASE || "https://sentry.io").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error(`LH_SENTRY_API_BASE must be an http(s) URL`);
  return base;
}

async function call(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // The body is Sentry's error message (validation detail); the token is never in it.
    throw new Error(`${method} ${new URL(url).pathname} -> HTTP ${res.status}: ${text.slice(0, 600)}`);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`${method} ${new URL(url).pathname} -> HTTP ${res.status} but the body is not JSON (${e instanceof Error ? e.message : e})`);
  }
  return { json, link: res.headers.get("link") };
}

/** Sentry pagination: `Link: <url>; rel="next"; results="true"; cursor="..."` (docs.sentry.io/api/pagination/). */
function nextPageUrl(link) {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      const m = part.match(/<([^>]+)>/);
      if (m) return m[1];
    }
  }
  return null;
}

async function listAll(url, token) {
  const out = [];
  let next = url;
  for (let page = 0; next; page++) {
    if (page >= 50) throw new Error(`more than 50 pages listing ${new URL(url).pathname}; refusing to guess the rest`);
    const { json, link } = await call("GET", next, token);
    if (!Array.isArray(json)) throw new Error(`GET ${new URL(next).pathname} did not return a list`);
    out.push(...json);
    next = nextPageUrl(link);
  }
  return out;
}

async function sync() {
  const token = env[TOKEN_NAME];
  if (!token) {
    console.log(`::notice title=Sentry alerts not synced::The ${TOKEN_NAME} secret is not set, so no Sentry alert was created or checked. Add it (a Sentry token with Alerts: Read & Write and Project: Read) under GitHub > Settings > Secrets and variables > Actions, then run this workflow again.`);
    return 0;
  }
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;
  if (!org || !project) {
    console.error(`::error::${TOKEN_NAME} is set but SENTRY_ORG or SENTRY_PROJECT is empty; both are needed to find the alerts.`);
    return 1;
  }
  const base = apiBase();
  const orgPath = `${base}/api/0/organizations/${encodeURIComponent(org)}`;

  // The project's issue_stream monitor: every error issue in the project reaches the
  // alerts connected to it (getsentry/sentry workflow_engine/processors/detector.py).
  const detectors = await listAll(`${orgPath}/detectors/?project=${encodeURIComponent(project)}&query=${encodeURIComponent("type:issue_stream")}&per_page=100`, token);
  const streams = detectors.filter((d) => d.type === "issue_stream" && String(d.projectId ?? "") !== "");
  if (streams.length !== 1) {
    console.error(`::error::expected exactly 1 issue_stream monitor for project ${project}, found ${streams.length}; refusing to guess which one the alerts belong to.`);
    return 1;
  }
  const detectorId = streams[0].id;
  console.log(`Project ${project}: issue_stream monitor ${detectorId}`);

  const desired = RULES.map((r) => buildPayload(r, { detectorId }));
  const listUrl = `${orgPath}/workflows/?per_page=100`;
  const before = await listAll(listUrl, token);
  const plan = planRules(desired, before);
  for (const step of plan) {
    console.log(`${step.action.padEnd(6)} ${step.name}${step.id ? ` (id ${step.id})` : ""}${step.diffs.length ? ` drifted: ${step.diffs.join(", ")}` : ""}`);
  }
  for (const step of plan) {
    if (step.action === "create") await call("POST", `${orgPath}/workflows/`, token, step.payload);
    if (step.action === "update") await call("PUT", `${orgPath}/workflows/${encodeURIComponent(step.id)}/`, token, step.payload);
  }

  const after = await listAll(listUrl, token);
  const failures = verifyReadback(desired, after);
  for (const p of desired) {
    const w = after.find((x) => x.name === p.name);
    console.log(`read back: ${w ? `id ${w.id}` : "MISSING"}  ${p.name}`);
  }
  const counts = Object.fromEntries(["create", "update", "skip"].map((a) => [a, plan.filter((s) => s.action === a).length]));
  if (failures.length > 0) {
    for (const f of failures) console.error(`::error::${f}`);
    console.error(`Read-back FAILED: ${failures.length} of ${desired.length} alerts are not as specified.`);
    return 1;
  }
  console.log(`Read-back OK: all ${desired.length} alerts exist once, as specified (created ${counts.create}, updated ${counts.update}, unchanged ${counts.skip}).`);
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const run = env.DRY_RUN === "1" ? Promise.resolve(dryRun()) : sync();
  run.then(
    (code) => process.exit(code),
    (e) => {
      console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
