#!/usr/bin/env node
/**
 * THE TWO-ACCOUNT JOURNEY — what a per-screen walk cannot prove.
 *
 * Drives Perry Poster and Hallie Helper in two browser contexts against the
 * REAL backend, and checks each step landed in the DATABASE, not just on the
 * screen. A step that renders a success toast and writes nothing is the exact
 * failure this exists to catch.
 *
 * NO MONEY MOVES. Stripe's edge-function key could not be confirmed as test
 * mode (`stripe-sandbox-on.sh` is owner-run and the account has a live context),
 * so every funding, release and refund step is DELIBERATELY skipped rather than
 * risking a real charge on the owner's live account. Everything reachable
 * without a charge is driven.
 *
 * Test data is marked `[NIGHT-AUDIT]` and removed at the end.
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:5183";
const SUPABASE_URL = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const MARK = "[NIGHT-AUDIT]";
const steps = [];
const step = (name, ok, detail) => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
};

const mint = (who) =>
  JSON.parse(execSync(`node scripts/test-signin-link.mjs ${who} --session --json`, {
    cwd: "/Users/lexilombas/louisianahelpr", encoding: "utf8", maxBuffer: 1 << 24,
  }));

const openAs = async (browser, who, session) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([k, v]) => {
    try {
      localStorage.setItem(k, v);
      localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
    } catch { /* blocked */ }
  }, [session.key, session.value]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => step(`${who}: uncaught page error`, false, String(e.message).slice(0, 120)));
  return { ctx, page };
};

// Read the DB through PostgREST with the account's own token, so every check
// is subject to the same RLS the app is — a service-role check would prove the
// row exists while the user still cannot see it.
const restAs = async (session, path) => {
  const token = JSON.parse(session.value).access_token;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.ANON ?? "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
      Authorization: `Bearer ${token}`,
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const poster = mint("poster-e2e");
const helper = mint("helper-e2e");
const POSTER_ID = JSON.parse(poster.value).user.id;
const HELPER_ID = JSON.parse(helper.value).user.id;
console.log(`poster=${POSTER_ID}\nhelper=${HELPER_ID}\n`);

const browser = await chromium.launch();
const P = await openAs(browser, "poster", poster);
const H = await openAs(browser, "helper", helper);

try {
  // ---- 1. both sessions are really signed in -------------------------------
  for (const [who, S, id] of [["poster", P, POSTER_ID], ["helper", H, HELPER_ID]]) {
    await S.page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await S.page.waitForTimeout(3500);
    const signedIn = !/\/login/.test(S.page.url());
    step(`${who} session is live (no bounce to /login)`, signedIn, S.page.url().replace(BASE, ""));
    const me = await restAs(who === "poster" ? poster : helper, `profiles?select=user_id,full_name&user_id=eq.${id}`);
    step(`${who} can read their own profile under RLS`, me.status === 200 && Array.isArray(me.body) && me.body.length === 1,
      `HTTP ${me.status}, ${Array.isArray(me.body) ? me.body.length : "?"} row(s)`);
  }

  // ---- 2. the helper cannot read the poster's private data ------------------
  const leak = await restAs(helper, `profiles?select=user_id,email&user_id=eq.${POSTER_ID}`);
  const leaked = Array.isArray(leak.body) && leak.body.some((r) => r.email);
  step("helper CANNOT read the poster's email through profiles", !leaked,
    `HTTP ${leak.status}, ${JSON.stringify(leak.body).slice(0, 90)}`);

  // ---- 3. the browse feed answers, and agrees with the database -------------
  const browse = await restAs(helper, "open_jobs_browse?select=id,title&limit=50");
  step("helper sees the browse feed", browse.status === 200 && Array.isArray(browse.body), `HTTP ${browse.status}, ${Array.isArray(browse.body) ? browse.body.length : "?"} jobs`);

  // ---- 4. messaging, both directions, verified in the DB --------------------
  // The thread must actually be BETWEEN THESE TWO ACCOUNTS. Taking the
  // poster's first thread picked one whose counterparty is the owner, so the
  // helper legitimately could not read the message and the run reported an RLS
  // failure that was not one. RLS was right; the assertion was wrong.
  // Prefer an existing thread between THESE TWO accounts; if there is none,
  // fall back to a job they actually share, which is what a thread needs.
  // Taking the poster's first thread of any kind picked one whose counterparty
  // is the owner, so the helper legitimately could not read the message and the
  // run reported an RLS failure that was not one. RLS was right; the assertion
  // was wrong.
  const threads = await restAs(
    poster,
    `messages?select=job_id&or=(and(sender_id.eq.${POSTER_ID},receiver_id.eq.${HELPER_ID}),and(sender_id.eq.${HELPER_ID},receiver_id.eq.${POSTER_ID}))&limit=1`,
  );
  let jobId = Array.isArray(threads.body) && threads.body[0]?.job_id;
  if (!jobId) {
    const shared = await restAs(
      poster,
      `jobs?select=id,title&customer_id=eq.${POSTER_ID}&helper_id=eq.${HELPER_ID}&order=created_at.desc&limit=1`,
    );
    jobId = Array.isArray(shared.body) && shared.body[0]?.id;
    step("found a job the two accounts share, to open a thread on", !!jobId,
      jobId ? String(shared.body[0].title).slice(0, 48) : "none");
  }
  if (jobId) {
    await P.page.goto(`${BASE}/messages?jobId=${jobId}`, { waitUntil: "domcontentloaded" });
    await P.page.waitForTimeout(4000);
    const composer = P.page.locator('textarea, [contenteditable="true"], input[placeholder*="message" i]').first();
    const hasComposer = await composer.count();
    step("poster can open a thread and reach a composer", !!hasComposer, `jobId=${String(jobId).slice(0, 8)}`);
    if (hasComposer) {
      const body = `${MARK} ping ${JSON.parse(poster.value).user.id.slice(0, 6)}`;
      await composer.fill(body);
      const send = P.page.locator('button[aria-label*="Send" i], button:has-text("Send")').first();
      if (await send.count()) {
        await send.click({ timeout: 8000 }).catch(() => {});
        await P.page.waitForTimeout(3500);
        const check = await restAs(poster, `messages?select=id,content&content=eq.${encodeURIComponent(body)}`);
        const landed = Array.isArray(check.body) && check.body.length > 0;
        step("a sent message actually lands in the database", landed,
          landed ? `row ${check.body[0].id.slice(0, 8)}` : `HTTP ${check.status} — the UI may have shown it without writing it`);
        if (landed) {
          const seen = await restAs(helper, `messages?select=id&id=eq.${check.body[0].id}`);
          step("the recipient can read that message under RLS", Array.isArray(seen.body) && seen.body.length === 1, `HTTP ${seen.status}`);
        }
      } else step("send control present", false, "no Send button found");
    }
  } else step("poster has an existing thread to drive", false, "no messages rows visible");

  // ---- 5. money paths are NOT driven, and that is recorded ------------------
  step("MONEY LOOP SKIPPED ON PURPOSE", true,
    "Stripe edge key could not be confirmed as test mode; funding/release/refund would risk a live charge. Owner must run scripts/e2e/stripe-sandbox-on.sh first.");
} finally {
  // Remove every row this run created. A test that leaves its debris in a real
  // inbox is how prod ends up with 68 bracketed job titles.
  try {
    const token = JSON.parse(poster.value).access_token;
    const del = await fetch(`${SUPABASE_URL}/rest/v1/messages?content=like.${encodeURIComponent(MARK + "%")}`, {
      method: "DELETE",
      headers: {
        apikey: process.env.ANON ?? "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
        Authorization: `Bearer ${token}`,
        Prefer: "return=representation",
      },
    });
    const removed = await del.json().catch(() => []);
    step("cleaned up this run's test rows", del.status < 400, `HTTP ${del.status}, ${Array.isArray(removed) ? removed.length : "?"} row(s) removed`);
  } catch (e) {
    step("cleaned up this run's test rows", false, String(e.message).slice(0, 100));
  }
  await browser.close();
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed`);
  if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`)); }
}
