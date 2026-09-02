#!/usr/bin/env node
/**
 * Reusable full-surface audit capture script.
 *
 * Captures every app surface (authed, admin, guest) as PNGs on disk at
 * two viewports, plus a machine-readable flags report, so later review
 * (human or model) only needs to look at flagged screens.
 *
 * Usage:
 *   node scripts/audit-capture.mjs                 # capture (read-only)
 *   node scripts/audit-capture.mjs --restore       # restore the last snapshot
 *                                                  # and exit, capturing nothing
 *
 * ============================================================================
 * ⚠️  READ THIS BEFORE ADDING ANY CLICK TO A SWEEP  ⚠️
 * ============================================================================
 * THIS script is READ-ONLY: it navigates, measures and screenshots. It never
 * clicks a control, and it must stay that way.
 *
 * A sweep that DOES click controls MUTATES THE SEEDED TEST ACCOUNT, and the
 * damage is invisible until a later audit reads the account as broken. This
 * has already happened: a control sweep flipped
 *   - `notification_preferences.push_enabled` -> false, and
 *   - all 7 `helper_availability.is_available` rows -> false
 * on the seeded helper (`eli.test.helper@louisianahelpr.com`) and left them
 * that way. Every subsequent audit then saw a helper with no availability and
 * push disabled, which reads exactly like a product defect.
 *
 * So: **any sweep that clicks, toggles, submits or drags MUST snapshot the
 * account's mutable state first and restore it afterwards** — including when
 * it crashes. `snapshotAccountState()` / `restoreAccountState()` below do
 * this; call them, don't reinvent them:
 *
 *   const snap = await snapshotAccountState(env);   // writes snapshot.json
 *   try { ...your clicking sweep... }
 *   finally { await restoreAccountState(env, snap); }
 *
 * The snapshot is also written to disk (`<OUT_DIR>/account-snapshot.json` and
 * `~/lh-audit-shots/latest-account-snapshot.json`) so a run that is killed
 * mid-sweep can still be undone afterwards with `--restore`.
 *
 * Extend TRACKED_TABLES below whenever a sweep starts touching a new table.
 * A control you can toggle in the UI that is NOT in that list is a hole.
 * ============================================================================
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ---------- config ----------
const TARGET = 'https://www.louisianahelpr.com';
const TEST_EMAIL = 'eli.test.helper@louisianahelpr.com';
const TEST_USER_ID = '6bdc1f67-ae1f-46a0-8edf-4035629a6147';
// Was a hardcoded date that had to be edited by hand before every run — forget
// and you silently overwrite the previous capture. Defaults to today.
const DATE_DIR = process.env.AUDIT_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(process.env.HOME, 'lh-audit-shots', DATE_DIR);
const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },
  { name: '1440x900', width: 1440, height: 900 },
];
const NAV_TIMEOUT = 25000;
const EXTRA_WAIT_MS = 1500;
const PARALLELISM = 3;

const AUTHED_ROUTES = [
  '/dashboard', '/browse', '/my-jobs', '/my-jobs?filter=scheduled', '/my-jobs?filter=waiting',
  '/my-jobs?filter=completed', '/my-posts', '/my-posts?filter=scheduled', '/my-posts?filter=waiting',
  // '/subscription' and '/family' were REMOVED: neither is a registered route
  // any more, so both render the 404 page. Sweeping them graded NotFound twice
  // under names that read like real screens. The membership screen is
  // /profile?tab=subscription, already covered by PROFILE_TABS.
  // Seven more left this list on 2026-09-02 for the SAME reason as
  // /subscription and /family above: /pets, /analytics, /home-history,
  // /work-record, /auto-tip, /str-settings and /wrapped are no longer routes.
  // They are Profile tabs now and are covered by PROFILE_ROUTES below, derived
  // from the Tab union itself so they cannot be missed.
  '/my-posts?filter=done', '/messages', '/post-job', '/jobs', '/settings',
  '/settings/profile', '/availability', '/schedule', '/earnings',
  '/saved-helpers', '/data-rights', '/gift-card', '/payment-success', '/help', '/support',
  '/legal', '/privacy', '/terms', '/rules',
  '/user/e977a30f-7065-4e75-8498-dba435ac2044',
];

// DERIVED from src/pages/profile/types.ts, not mirrored by hand.
//
// This was a hand-kept copy of the `Tab` union, and its own comment records it
// having drifted twice already — posted_jobs and completed_jobs lingered after
// they stopped being tabs, and 'accessibility' was simply missing. A list that
// has to be remembered is a list that goes stale, and a stale one here is
// invisible: it does not error, it just quietly stops capturing a screen.
// Seven new tabs landed on 2026-09-02 and would have been missed a third time.
//
// Parsed from TAB_TITLES, which is the constant the app itself renders and
// routes on, so a tab cannot exist without appearing here. Throws rather than
// falling back to a partial list — a capture sweep that silently covers less
// than it claims is worse than one that fails.
const TAB_TITLES_SRC = fs.readFileSync(
  new URL('../src/pages/profile/types.ts', import.meta.url), 'utf8',
);
const TAB_BLOCK = TAB_TITLES_SRC.slice(
  TAB_TITLES_SRC.indexOf('TAB_TITLES'),
  TAB_TITLES_SRC.indexOf('};', TAB_TITLES_SRC.indexOf('TAB_TITLES')),
);
const PROFILE_TABS = [...TAB_BLOCK.matchAll(/^\s*(\w+):\s*"/gm)].map((m) => m[1]);
if (PROFILE_TABS.length < 10) {
  throw new Error(
    `audit-capture: parsed only ${PROFILE_TABS.length} Profile tabs from types.ts — ` +
    'the TAB_TITLES shape must have changed. Fix the parse; do not hand-list them again.',
  );
}
const PROFILE_ROUTES = ['/profile', ...PROFILE_TABS.map((t) => `/profile?tab=${t}`)];

// Mirror of `type View` in src/pages/Admin.tsx — re-derive from that union when
// it changes. This list had drifted: parishtax, idv, geography, business_verify
// and business_accounts are all DELETED views. /admin coerces their dead deep
// links to home, so sweeping them silently graded the dashboard under five
// extra names and reported them as covered.
const ADMIN_VIEWS = [
  'analytics', 'people', 'jobs', 'settings', 'disputes', 'broadcasts', 'notifications', 'notiflogs',
  'reports', 'support', 'referrals', 'subscriptions', 'fraud', 'audit', 'health', 'export', 'payouts',
  'tiers', 'marketing', 'idvreview', 'credentials', 'exceptions', 'banreview',
];
const ADMIN_ROUTES = ['/admin', ...ADMIN_VIEWS.map((v) => `/admin?view=${v}`)];

const GUEST_ROUTES = [
  '/', '/login', '/signup', '/forgot-password', '/help', '/legal', '/privacy', '/terms', '/rules',
  // '/wrapped' removed 2026-09-02 — it is a Profile tab now, and as a guest
  // route it graded the 404 screen under a name that reads like a real one.
  '/nonexistent-audit-404',
];

// ---------- helpers ----------
function sanitize(cellName) {
  return cellName.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}

function readEnv() {
  const envPath = path.join(repoRoot, '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function mintSession(supabaseUrl, serviceKey) {
  const genRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL }),
  });
  if (!genRes.ok) {
    throw new Error(`generate_link failed: ${genRes.status} ${await genRes.text()}`);
  }
  const genJson = await genRes.json();
  const actionLink = genJson.action_link || genJson.properties?.action_link;
  if (!actionLink) throw new Error('generate_link response had no action_link');

  const linkRes = await fetch(actionLink, { redirect: 'manual' });
  const location = linkRes.headers.get('location');
  if (!location) throw new Error(`no Location header from action_link (status ${linkRes.status})`);

  const hashIdx = location.indexOf('#');
  if (hashIdx === -1) throw new Error(`Location had no hash fragment: ${location}`);
  const hash = new URLSearchParams(location.slice(hashIdx + 1));
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  const expires_at = Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + 3600;
  if (!access_token || !refresh_token) {
    throw new Error(`missing tokens in hash fragment: ${location}`);
  }

  // THE REAL USER OBJECT, FETCHED — not `{ id }`.
  //
  // This used to fabricate `user: { id: TEST_USER_ID }`, and that one shortcut
  // made this harness screenshot THE WRONG SCREEN, silently, under every other
  // screen's name. supabase-js hands back whatever is in localStorage from
  // getSession() without re-fetching, so `user.email_confirmed_at` came back
  // undefined; ProtectedRoute.tsx's email-unconfirmed gate then bounced to
  // /account-pending, which (profile IS approved) immediately re-navigated to
  // /dashboard. Every non-`allowPending` protected route therefore rendered the
  // DASHBOARD, and the sweep filed that PNG under the route's own name.
  // Measured: /post-job and /gift-card both produced byte-comparable dashboard
  // captures. It reproduced on cold load, on reload and on pushState nav, so it
  // was not a first-paint race.
  //
  // Nothing about it looked wrong. The run succeeded, the files were written,
  // the names were right — so any lane grading /post-job or /gift-card from
  // ~/lh-audit-shots was grading the dashboard and had no way to know.
  // Found by lh-visual-critic. NOT a product defect: the same account reads
  // approval_status 'approved' and a real email_confirmed_at in prod.
  //
  // The assert is the point. Restoring the fetch fixes it today; asserting the
  // field is what stops it silently regressing to the same shape tomorrow.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`could not fetch the authenticated user (${userRes.status}) — refusing to mint a session with a fabricated user object`);
  }
  const user = await userRes.json();
  if (!user?.email_confirmed_at) {
    throw new Error(
      'minted session has no email_confirmed_at — ProtectedRoute will bounce every protected route to /account-pending and this sweep would capture the dashboard under every screen name',
    );
  }

  return {
    access_token,
    refresh_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at,
    user,
  };
}

/**
 * Runs before first paint in every context (authed AND guest).
 *
 * Two jobs:
 *  1. install the minted session, when there is one;
 *  2. ALWAYS suppress the onboarding tour.
 *
 * (2) is not optional. `OnboardingTour` (src/components/OnboardingTour.tsx,
 * mounted by src/pages/Dashboard.tsx) opens on /dashboard 1.5s after load in
 * every fresh browser context — and every context here is fresh. It is a Radix
 * dialog that blurs the page behind it and intercepts clicks, so without this
 * the /dashboard captures are screenshots of the TOUR over a blurred
 * dashboard, the layout metrics measure the tour, and the flags report grades
 * the tour. Worse, EXTRA_WAIT_MS is 1500 — exactly the tour's delay — so it
 * appeared in some runs and not others, which reads as flakiness in the app.
 *
 * The tour is gated purely on localStorage: key `helpr_onboarding`, shape
 * `{completed, currentStep, completedSteps}`, and `completed: true` retires it
 * permanently. Auditing the tour ITSELF means deliberately not seeding this
 * key in a dedicated context — never by leaving the whole sweep exposed to it.
 */
function installSession({ key, val }) {
  try {
    if (key && val) window.localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(
      'helpr_onboarding',
      JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
    );
  } catch {
    /* ignore */
  }
}

async function captureCell({ browser, cellName, url, viewport, outDirBase, sessionArgs, flagRedirectToLogin, isAuthed }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  // Always installed — with a session when we have one, and in every case to
  // suppress the onboarding tour. Guest contexts need the tour suppression
  // too: a guest cell that lands on /dashboard mid-redirect can still catch it.
  await context.addInitScript(installSession, sessionArgs ?? { key: null, val: null });
  const page = await context.newPage();

  const consoleErrors = new Set();
  const failedResponses = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.add(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => consoleErrors.add(String(err).slice(0, 300)));
  page.on('response', (res) => {
    if (res.status() >= 500) failedResponses.push(`${res.status()} ${res.url()}`);
  });

  const result = {
    cell: cellName,
    viewport: viewport.name,
    requestedUrl: `${TARGET}${url}`,
    finalUrl: null,
    title: null,
    timeout: false,
    overflow: false,
    overflowElementCount: 0,
    overflowSelectors: [],
    truncatedTextCount: 0,
    consoleErrors: [],
    failedResponses: [],
    bodyTextLength: 0,
    blank: false,
    hasBottomNav: null,
    redirectedToLogin: false,
    flagged: false,
    flagReasons: [],
    screenshot: null,
    screenshotBottom: null,
  };

  try {
    await page.goto(`${TARGET}${url}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
  } catch (e) {
    result.timeout = true;
    result.flagReasons.push(`nav-timeout: ${String(e).slice(0, 200)}`);
  }

  await page.waitForTimeout(EXTRA_WAIT_MS);

  try {
    result.finalUrl = page.url();
    result.title = await page.title();

    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth > de.clientWidth;
      const all = Array.from(document.querySelectorAll('body *'));
      const vw = de.clientWidth;
      const wide = [];
      let truncatedCount = 0;
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width > vw + 2 && wide.length < 5) {
          let sel = el.tagName.toLowerCase();
          if (el.id) sel += `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            sel += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
          }
          wide.push(sel);
        }
        if (
          el.scrollWidth > el.clientWidth + 2 &&
          el.textContent &&
          el.textContent.trim().length > 3 &&
          el.children.length === 0
        ) {
          truncatedCount++;
        }
      }
      const bodyTextLength = (document.body.innerText || '').trim().length;
      const hasBottomNav = !!document.querySelector('[data-bottom-nav], nav[class*="bottom"], [class*="BottomNav"]');
      return { overflow, wide, truncatedCount, bodyTextLength, hasBottomNav };
    });

    result.overflow = metrics.overflow;
    result.overflowSelectors = metrics.wide;
    result.overflowElementCount = metrics.wide.length;
    result.truncatedTextCount = metrics.truncatedCount;
    result.bodyTextLength = metrics.bodyTextLength;
    result.hasBottomNav = metrics.hasBottomNav;
    result.blank = metrics.bodyTextLength < 200;
  } catch (e) {
    result.flagReasons.push(`eval-error: ${String(e).slice(0, 200)}`);
  }

  result.consoleErrors = Array.from(consoleErrors);
  result.failedResponses = failedResponses;

  if (isAuthed && flagRedirectToLogin && result.finalUrl && /\/login(\?|$)/.test(result.finalUrl)) {
    result.redirectedToLogin = true;
  }

  // screenshots
  const sanitized = sanitize(cellName);
  const outDir = path.join(outDirBase, viewport.name);
  fs.mkdirSync(outDir, { recursive: true });
  const shotPath = path.join(outDir, `${sanitized}.png`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
    result.screenshot = shotPath;
  } catch (e) {
    result.flagReasons.push(`screenshot-error: ${String(e).slice(0, 200)}`);
  }

  try {
    const scrolled = await page.evaluate(() => {
      let target = document.scrollingElement || document.documentElement;
      let maxDelta = target.scrollHeight - target.clientHeight;
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const delta = el.scrollHeight - el.clientHeight;
        if (delta > maxDelta && el.scrollHeight > el.clientHeight) {
          maxDelta = delta;
          target = el;
        }
      }
      if (maxDelta > 100) {
        target.scrollTo({ top: target.scrollHeight, behavior: 'instant' });
        return true;
      }
      return false;
    });
    if (scrolled) {
      await page.waitForTimeout(300);
      const bottomPath = path.join(outDir, `${sanitized}-bottom.png`);
      await page.screenshot({ path: bottomPath, fullPage: true });
      result.screenshotBottom = bottomPath;
    }
  } catch {
    // non-fatal
  }

  // flagging
  if (result.overflow) result.flagReasons.push('horizontal-overflow');
  if (result.consoleErrors.length > 0) result.flagReasons.push(`consoleErrors:${result.consoleErrors.length}`);
  if (result.failedResponses.length > 0) result.flagReasons.push(`5xx:${result.failedResponses.length}`);
  if (result.blank) result.flagReasons.push('blank-page');
  if (result.timeout) result.flagReasons.push('timeout');
  if (result.redirectedToLogin) result.flagReasons.push('redirected-to-login');
  if (result.title === '') result.flagReasons.push('empty-title');
  result.flagged = result.flagReasons.length > 0;

  await context.close();
  return result;
}

// ---------- snapshot / restore of the seeded account's mutable state ----------
//
// See the ⚠️ block at the top of this file. Any sweep that CLICKS must bracket
// itself with these two calls; this capture script is read-only and calls
// snapshotAccountState() only so a restore point always exists for whatever
// runs next.
//
// Add a row here whenever a sweep starts touching a new table. `filter` is the
// PostgREST predicate that selects exactly the test account's rows — never
// widen it; a restore that PATCHes more than the test account is worse than
// the mutation it was undoing.
const TRACKED_TABLES = [
  {
    table: 'notification_preferences',
    filter: `user_id=eq.${TEST_USER_ID}`,
    // A control sweep flipped push_enabled to false here and left it.
    columns: null, // null = whole row
  },
  {
    table: 'helper_availability',
    filter: `helper_id=eq.${TEST_USER_ID}`,
    // A control sweep flipped all 7 is_available rows to false and left them.
    columns: null,
  },
];

const LATEST_SNAPSHOT_PATH = path.join(process.env.HOME, 'lh-audit-shots', 'latest-account-snapshot.json');

async function restGet(env, table, filter) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${table}?${filter}&select=*`, {
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
  });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restPatchById(env, table, id, row) {
  // PATCH by primary key only. Restoring row-by-row (rather than one bulk
  // PATCH over the filter) is deliberate: a bulk PATCH would flatten rows that
  // legitimately differ from each other — e.g. the 7 helper_availability rows,
  // which have different day_of_week/start_time values.
  const body = { ...row };
  delete body.id;
  delete body.created_at;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table} ${id} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  // A null error does NOT mean the write happened: PATCH matching zero rows
  // returns 200 with []. This is the repeat-offender bug class in this repo —
  // check the representation, not the status.
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`PATCH ${table} ${id} matched ZERO rows — restore did not happen`);
  }
  return rows[0];
}

/**
 * Read the test account's mutable state and write it to disk. Returns the
 * snapshot object (also usable in-process).
 */
async function snapshotAccountState(env, outDir) {
  const snapshot = { takenAt: new Date().toISOString(), userId: TEST_USER_ID, tables: {} };
  for (const spec of TRACKED_TABLES) {
    snapshot.tables[spec.table] = await restGet(env, spec.table, spec.filter);
  }
  const counts = Object.entries(snapshot.tables)
    .map(([t, rows]) => `${t}:${rows.length}`)
    .join(' ');
  const json = JSON.stringify(snapshot, null, 2);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'account-snapshot.json'), json);
  }
  fs.mkdirSync(path.dirname(LATEST_SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(LATEST_SNAPSHOT_PATH, json);
  console.log(`Account snapshot taken (${counts}) -> ${LATEST_SNAPSHOT_PATH}`);
  return snapshot;
}

/**
 * Put every snapshotted row back exactly as it was. Safe to run when nothing
 * changed (it just re-writes identical values), so `finally { restore }` is
 * always the right shape — including on a crash.
 */
async function restoreAccountState(env, snapshot) {
  if (!snapshot) throw new Error('restoreAccountState called with no snapshot');
  let restored = 0;
  const failures = [];
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    for (const row of rows) {
      try {
        await restPatchById(env, table, row.id, row);
        restored++;
      } catch (e) {
        failures.push(String(e).slice(0, 300));
      }
    }
  }
  console.log(`Account state restored: ${restored} row(s).`);
  if (failures.length) {
    console.error(`RESTORE FAILURES (${failures.length}) — the test account may still be dirty:`);
    for (const f of failures) console.error(`  ${f}`);
  }
  return { restored, failures };
}

async function runPool(items, worker, poolSize) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: poolSize }, () => next()));
  return results;
}

async function main() {
  const env = readEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const restEnv = { supabaseUrl, serviceKey };

  // `--restore` undoes a previous (clicking) sweep from the snapshot on disk
  // and exits without capturing anything. This is the escape hatch for a run
  // that was killed before its own `finally { restore }` could fire.
  if (process.argv.includes('--restore')) {
    if (!supabaseUrl || !serviceKey) {
      console.error('Cannot restore: .env is missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
      process.exit(1);
    }
    if (!fs.existsSync(LATEST_SNAPSHOT_PATH)) {
      console.error(`Cannot restore: no snapshot at ${LATEST_SNAPSHOT_PATH}.`);
      process.exit(1);
    }
    const snap = JSON.parse(fs.readFileSync(LATEST_SNAPSHOT_PATH, 'utf8'));
    console.log(`Restoring account state from snapshot taken ${snap.takenAt}...`);
    const { failures } = await restoreAccountState(restEnv, snap);
    process.exit(failures.length ? 1 : 0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Output dir: ${OUT_DIR}`);

  // Take a restore point even though THIS script never clicks: it makes the
  // seeded account's known-good state recoverable for whatever runs next, and
  // it is nearly free (two GETs). See the ⚠️ block at the top of the file.
  if (supabaseUrl && serviceKey) {
    try {
      await snapshotAccountState(restEnv, OUT_DIR);
    } catch (e) {
      console.error(`Snapshot failed (continuing — this script is read-only): ${String(e).slice(0, 300)}`);
    }
  }

  const projectRefMatch = supabaseUrl && supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = projectRefMatch ? projectRefMatch[1] : 'fncmgoasalhdgfwzhsqa';
  const storageKey = `sb-${projectRef}-auth-token`;

  let sessionArgs = null; // { key, val } passed to addInitScript, NOT a closure
  let authOk = false;

  if (supabaseUrl && serviceKey) {
    try {
      const session = await mintSession(supabaseUrl, serviceKey);
      const sessionJson = JSON.stringify(session);
      sessionArgs = { key: storageKey, val: sessionJson };
      console.log('Minted magic-link session for test account.');
    } catch (e) {
      console.error(`AUTH SETUP FAILED: ${String(e).slice(0, 500)}`);
      console.error('Continuing with GUEST pass only.');
    }
  } else {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — GUEST pass only.');
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error(`Failed to launch chromium (headless blocked?): ${e}`);
    console.error('Retrying with a real Chrome UA string will not help a launch failure; aborting.');
    process.exit(1);
  }

  // Verify auth works by loading /dashboard once.
  if (sessionArgs) {
    const verifyContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await verifyContext.addInitScript(installSession, sessionArgs);
    const verifyPage = await verifyContext.newPage();
    try {
      await verifyPage.goto(`${TARGET}/dashboard`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      await verifyPage.waitForTimeout(1500);
      const finalUrl = verifyPage.url();
      if (/\/login(\?|$)/.test(finalUrl)) {
        console.error(`AUTH VERIFY FAILED: /dashboard redirected to ${finalUrl}`);
        console.error('Continuing with GUEST pass only.');
        sessionArgs = null;
      } else {
        authOk = true;
        console.log(`Auth verified: /dashboard loaded at ${finalUrl}`);
      }
    } catch (e) {
      console.error(`AUTH VERIFY FAILED: ${String(e).slice(0, 300)}`);
      console.error('Continuing with GUEST pass only.');
      sessionArgs = null;
    }
    await verifyContext.close();
  }

  // Build the cell list.
  const cells = [];
  for (const vp of VIEWPORTS) {
    for (const route of GUEST_ROUTES) {
      cells.push({ cellName: `guest:${route}`, url: route, viewport: vp, authed: false, group: 'guest' });
    }
    if (authOk) {
      for (const route of AUTHED_ROUTES) {
        cells.push({ cellName: `authed:${route}`, url: route, viewport: vp, authed: true, group: 'authed' });
      }
      for (const route of PROFILE_ROUTES) {
        cells.push({ cellName: `profile:${route}`, url: route, viewport: vp, authed: true, group: 'profile' });
      }
      for (const route of ADMIN_ROUTES) {
        cells.push({ cellName: `admin:${route}`, url: route, viewport: vp, authed: true, group: 'admin' });
      }
    }
  }

  console.log(`Capturing ${cells.length} cells with parallelism ${PARALLELISM}...`);

  const results = await runPool(
    cells,
    async (cell) => {
      try {
        return await captureCell({
          browser,
          cellName: cell.cellName,
          url: cell.url,
          viewport: cell.viewport,
          outDirBase: OUT_DIR,
          sessionArgs: cell.authed ? sessionArgs : null,
          flagRedirectToLogin: cell.authed,
          isAuthed: cell.authed,
        });
      } catch (e) {
        return {
          cell: cell.cellName,
          viewport: cell.viewport.name,
          requestedUrl: `${TARGET}${cell.url}`,
          flagged: true,
          flagReasons: [`fatal-error: ${String(e).slice(0, 300)}`],
        };
      }
    },
    PARALLELISM
  );

  await browser.close();

  const flagged = results.filter((r) => r.flagged);
  const report = {
    target: TARGET,
    date: DATE_DIR,
    generatedAt: new Date().toISOString(),
    authOk,
    totalCells: results.length,
    flaggedCount: flagged.length,
    results,
  };

  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Auth: ${authOk ? 'OK (authed + admin + profile cells captured)' : 'FAILED (guest-only pass)'}`);
  console.log(`Total cells captured: ${results.length}`);
  console.log(`Flagged: ${flagged.length}`);
  if (flagged.length > 0) {
    console.log('\nFlagged cells:');
    for (const r of flagged) {
      console.log(`  [${r.viewport}] ${r.cell} -> ${r.flagReasons.join(', ')}`);
    }
  }
  console.log(`\nReport: ${reportPath}`);
  console.log(`Screenshots: ${OUT_DIR}`);
}

// Exported so a clicking sweep can bracket itself without copy-pasting the
// snapshot/restore logic (see the ⚠️ block at the top):
//   import { snapshotAccountState, restoreAccountState, readEnv } from './audit-capture.mjs';
// Importing this file must therefore NOT start a capture — hence the guard.
export { snapshotAccountState, restoreAccountState, readEnv, TRACKED_TABLES, LATEST_SNAPSHOT_PATH };

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
