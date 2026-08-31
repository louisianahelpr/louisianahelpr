#!/usr/bin/env node
/**
 * Reusable full-surface audit capture script.
 *
 * Captures every app surface (authed, admin, guest) as PNGs on disk at
 * two viewports, plus a machine-readable flags report, so later review
 * (human or model) only needs to look at flagged screens.
 *
 * Usage: node scripts/audit-capture.mjs
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
  '/my-posts?filter=done', '/messages', '/post-job', '/jobs', '/settings',
  '/settings/profile', '/availability', '/schedule', '/earnings', '/analytics', '/pets',
  '/pay-it-forward', '/benefits', '/home-history', '/work-record', '/saved-helpers', '/auto-tip',
  '/str-settings', '/data-rights', '/gift-card', '/wrapped', '/payment-success', '/help', '/support',
  '/legal', '/privacy', '/terms', '/rules',
  '/user/e977a30f-7065-4e75-8498-dba435ac2044',
];

// Mirror of the `Tab` union in src/pages/profile/types.ts (minus 'landing',
// which is plain /profile). posted_jobs and completed_jobs are NOT tabs any
// more; 'accessibility' is and was missing.
const PROFILE_TABS = [
  'profile', 'earnings', 'schedule', 'availability', 'payment', 'security', 'legal', 'reviews',
  'referral', 'subscription', 'support', 'notifications',
  'warnings', 'credentials', 'saved_helpers', 'accessibility',
];
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
  '/wrapped', '/nonexistent-audit-404',
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

  return {
    access_token,
    refresh_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at,
    user: { id: TEST_USER_ID },
  };
}

function installSession({ key, val }) {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

async function captureCell({ browser, cellName, url, viewport, outDirBase, sessionArgs, flagRedirectToLogin, isAuthed }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  if (sessionArgs) {
    await context.addInitScript(installSession, sessionArgs);
  }
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
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Output dir: ${OUT_DIR}`);

  const env = readEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
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

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
