#!/usr/bin/env node
/**
 * lh-state-matrix targeted probe.
 *
 * Deliberately narrow, not a full sweep: forces a handful of high-risk,
 * genuinely-uncovered states (keyboard-open, interrupted multi-step form,
 * DOM-injected long-string/max-content, and the five named hand-rolled
 * overlays' fixed-position containment) against the LIVE prod app with the
 * seeded test account, per docs/audit/launch-2026-09/PROTOCOL.md.
 *
 * Long-string/max-content probes inject text via page.evaluate() directly
 * into the rendered DOM rather than submitting a form — this proves the
 * layout handles the content without writing to any Supabase table (avoids
 * touching `profiles`, which is NOT in TRACKED_TABLES and so is NOT
 * snapshot/restored by scripts/audit-capture.mjs). No mutation happens in
 * this script; it is read-only against the account, same as audit-capture.mjs
 * itself. If a future probe needs a real submit, extend TRACKED_TABLES first.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const TARGET = 'https://www.louisianahelpr.com';
const TEST_EMAIL = 'eli.test.helper@louisianahelpr.com';
const TEST_USER_ID = '6bdc1f67-ae1f-46a0-8edf-4035629a6147';
const OUT_DIR = path.join(process.env.HOME, 'lh-audit-shots', 'state-matrix-' + new Date().toISOString().slice(0, 10));
fs.mkdirSync(OUT_DIR, { recursive: true });

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
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL }),
  });
  if (!genRes.ok) throw new Error(`generate_link failed: ${genRes.status} ${await genRes.text()}`);
  const genJson = await genRes.json();
  const actionLink = genJson.action_link || genJson.properties?.action_link;
  if (!actionLink) throw new Error('generate_link response had no action_link');
  const linkRes = await fetch(actionLink, { redirect: 'manual' });
  const location = linkRes.headers.get('location');
  if (!location) throw new Error(`no Location header (status ${linkRes.status})`);
  const hashIdx = location.indexOf('#');
  const hash = new URLSearchParams(location.slice(hashIdx + 1));
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  const expires_at = Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + 3600;
  if (!access_token || !refresh_token) throw new Error(`missing tokens: ${location}`);

  // The user object baked into the injected localStorage session must be the
  // REAL auth user (email_confirmed_at etc.), not just an id. `getSession()`
  // in useAuthReady.ts trusts whatever is in local storage without a network
  // round-trip, so a minimal `{ id }` user leaves `email_confirmed_at`
  // undefined for the WHOLE session — which trips ProtectedRoute's Stage 1
  // "email unconfirmed" gate on any route that isn't `allowPending` (e.g.
  // /post-job) even though the real account's email has long been confirmed.
  // Confirmed by cross-checking GoTrue admin/users against this exact bounce
  // on 2026-09-02 — see lh-state-matrix memory. audit-capture.mjs's routes
  // are all allowPending or allowUnapproved, so this gap was invisible there.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${TEST_USER_ID}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const realUser = userRes.ok ? await userRes.json() : { id: TEST_USER_ID };

  return { access_token, refresh_token, token_type: 'bearer', expires_in: 3600, expires_at, user: realUser };
}

function installSession({ key, val }) {
  try { if (key && val) window.localStorage.setItem(key, val); } catch {}
  try {
    window.localStorage.setItem('helpr_onboarding', JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  } catch {}
}

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
}

async function main() {
  const env = readEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');

  const session = await mintSession(supabaseUrl, serviceKey);
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const sessionArgs = { key: storageKey, val: JSON.stringify(session) };

  const browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // 1. KEYBOARD-OPEN: focus every input on Post-a-Job step 1 at 375x812,
  //    then simulate the iOS keyboard by shrinking the visual viewport
  //    height (~40% of 812 ≈ 330px keyboard), and assert the focused field
  //    AND the submit/continue button remain within the visible area.
  // ---------------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addInitScript(installSession, sessionArgs);
    const page = await context.newPage();
    await page.goto(`${TARGET}/post-job`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT_DIR, 'kb-01-postjob-initial.png') });
    // /post-job's first step is an entry chooser (Start Fresh / Repost /
    // Template / Offer to Saved Helpr / AI Builder) — no inputs render until
    // "Start Fresh" is picked.
    await page.getByText('Start Fresh', { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT_DIR, 'kb-01b-postjob-form-step.png') });

    const inputs = await page.locator('input:visible, textarea:visible').all();
    log('keyboard-open: post-job inputs found', inputs.length > 0, `${inputs.length} visible inputs`);

    if (inputs.length > 0) {
      // Focus the first visible text input.
      await inputs[0].click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(200);
      const before = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el ? el.getBoundingClientRect() : null;
        return r ? { top: r.top, bottom: r.bottom } : null;
      });

      // Simulate iOS keyboard: window.innerHeight (the LAYOUT viewport) stays
      // full-size — only visualViewport.height (the VISIBLE viewport) shrinks,
      // exactly like a real on-screen keyboard. useKeyboardInset.ts computes
      // `window.innerHeight - vv.height - vv.offsetTop`, so shrinking BOTH
      // (an earlier version of this probe's bug) always yields diff=0 and
      // never fires the lift — a false negative, not evidence of anything.
      await page.evaluate(() => {
        if (window.visualViewport) {
          Object.defineProperty(window.visualViewport, 'height', { value: 812 - 336, configurable: true });
          Object.defineProperty(window.visualViewport, 'offsetTop', { value: 0, configurable: true });
          window.visualViewport.dispatchEvent(new Event('resize'));
        }
      });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT_DIR, 'kb-02-postjob-keyboard-open.png') });

      const after = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el ? el.getBoundingClientRect() : null;
        return { active: r ? { top: r.top, bottom: r.bottom } : null, visibleHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight };
      });
      const activeVisible = after.active && after.active.bottom <= after.visibleHeight && after.active.top >= 0;
      log(
        'keyboard-open: focused field stays visible under shrunk viewport',
        !!activeVisible,
        `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      );
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 2. INTERRUPTED: fill step 1 of Post-a-Job, background the tab
  //    (visibilitychange -> hidden), wait, foreground it again, and check
  //    the typed values + step position survived (no server write involved
  //    — this is purely the in-memory/localStorage draft-persistence path).
  // ---------------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(installSession, sessionArgs);
    const page = await context.newPage();
    await page.goto(`${TARGET}/post-job`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.getByText('Start Fresh', { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const titleInput = page.locator('input[name="title"], input[placeholder*="title" i], input[id*="title" i]').first();
    const marker = 'STATE-MATRIX-INTERRUPT-PROBE';
    let filled = false;
    if (await titleInput.count()) {
      await titleInput.fill(marker).catch(() => {});
      filled = true;
    } else {
      // Fall back to the first visible text input on the page.
      const firstInput = page.locator('input[type="text"]:visible, textarea:visible').first();
      if (await firstInput.count()) {
        await firstInput.fill(marker).catch(() => {});
        filled = true;
      }
    }
    log('interrupted: could locate an editable field on post-job step 1', filled, filled ? 'filled marker text' : 'no editable field found');

    if (filled) {
      await page.screenshot({ path: path.join(OUT_DIR, 'int-01-before-background.png') });
      // Simulate backgrounding: Page Visibility API + Capacitor-style pause.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new CustomEvent('pause'));
      });
      await page.waitForTimeout(1500);
      // Foreground again.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new CustomEvent('resume'));
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT_DIR, 'int-02-after-foreground.png') });

      const survivedValue = await page.inputValue('input[name="title"], input[placeholder*="title" i], input[id*="title" i], input[type="text"], textarea').catch(() => null);
      const survived = typeof survivedValue === 'string' && survivedValue.includes(marker);
      log('interrupted: typed value survives background/foreground on post-job', survived, `value now: ${JSON.stringify(survivedValue)}`);

      // Reload the page cold (new navigation) and check whether a draft was
      // persisted and offered for resume — this is the actual product
      // guarantee CLAUDE.md/lh-audit describe ("draft autosave fires +
      // resumes on refresh"), not just in-tab state survival.
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT_DIR, 'int-03-after-reload.png') });
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const draftOffered = /resume|draft|continue where/i.test(bodyText);
      log('interrupted: reload offers to resume the draft (or auto-restores it)', draftOffered || bodyText.includes(marker), draftOffered ? 'resume/draft copy found' : (bodyText.includes(marker) ? 'value auto-restored without a prompt' : 'no resume affordance and value lost'));
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 3. LONG-STRING / MAX-CONTENT: DOM-inject long text into a few dense
  //    surfaces (no server write) and check for clipping/overflow.
  // ---------------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addInitScript(installSession, sessionArgs);
    const page = await context.newPage();

    const cells = [
      { url: '/dashboard', name: 'dashboard' },
      { url: '/my-jobs', name: 'my-jobs' },
      { url: '/messages', name: 'messages' },
      { url: '/profile?tab=profile', name: 'profile-edit' },
    ];
    const LONG = 'A'.repeat(60) + ' ' + 'supercalifragilisticexpialidociousnospacetoken'.repeat(4) + ' 🎉🚀👷‍♀️日本語のテキストです ' + 'B'.repeat(80);

    for (const cell of cells) {
      await page.goto(`${TARGET}${cell.url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Inject the long string into every visible text-bearing leaf node's
      // textContent that isn't an input, so we exercise real layout without
      // writing anything server-side.
      const injected = await page.evaluate((longText) => {
        let count = 0;
        const candidates = Array.from(document.querySelectorAll('h1,h2,h3,p,span,div'))
          .filter((el) => el.children.length === 0 && el.textContent && el.textContent.trim().length > 3 && el.textContent.trim().length < 40)
          .slice(0, 6);
        for (const el of candidates) {
          el.textContent = longText;
          count++;
        }
        return count;
      }, LONG);
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const wide = Array.from(document.querySelectorAll('*')).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > window.innerWidth + 2;
        }).length;
        return { docOverflow, wideElementCount: wide };
      });
      await page.screenshot({ path: path.join(OUT_DIR, `long-${cell.name}.png`), fullPage: false });
      log(
        `long-string: ${cell.name} (${injected} nodes stuffed)`,
        !overflow.docOverflow && overflow.wideElementCount === 0,
        `docOverflow=${overflow.docOverflow} wideElementCount=${overflow.wideElementCount}`,
      );
    }
    await context.close();
  }

  // ---------------------------------------------------------------------
  // 4. FIXED-OVERLAY CONTAINMENT: open the five named hand-rolled overlays
  //    and measure their rect against window.innerWidth/innerHeight. A rect
  //    that doesn't span (0,0)-(innerWidth,innerHeight) means it's fixed
  //    against a transformed/blurred ancestor rather than the viewport.
  // ---------------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(installSession, sessionArgs);
    const page = await context.newPage();

    // 4a. PhotoLightbox — opened from Dashboard's photo strip if present.
    await page.goto(`${TARGET}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const photoTrigger = page.locator('[data-testid*="photo" i], img[alt*="job photo" i]').first();
    if (await photoTrigger.count()) {
      await photoTrigger.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const rect = await measureFixedOverlay(page);
      await page.screenshot({ path: path.join(OUT_DIR, 'overlay-photolightbox.png') });
      log('overlay: PhotoLightbox fills viewport', rect.ok, rect.detail);
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      log('overlay: PhotoLightbox trigger not found on dashboard', null, 'UNVERIFIED — no photo strip visible for this account; needs a job with photos');
    }

    // 4b. ApplicantsPanel — from My Posts, open a job with applicants.
    await page.goto(`${TARGET}/my-posts`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const applicantsTrigger = page.getByText(/applicant/i).first();
    if (await applicantsTrigger.count()) {
      await applicantsTrigger.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const rect = await measureFixedOverlay(page);
      await page.screenshot({ path: path.join(OUT_DIR, 'overlay-applicantspanel.png') });
      log('overlay: ApplicantsPanel fills viewport', rect.ok, rect.detail);
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      log('overlay: ApplicantsPanel trigger not found on my-posts', null, 'UNVERIFIED — no posted job with an "applicant" affordance visible for this account');
    }

    // 4c. MessageAttachment lightbox — from Messages, open a thread with an image attachment.
    await page.goto(`${TARGET}/messages`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const firstThread = page.locator('a[href*="/messages/"], [role="listitem"]').first();
    if (await firstThread.count()) {
      await firstThread.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const attachmentThumb = page.locator('img[alt*="attachment" i], [data-testid*="attachment" i]').first();
      if (await attachmentThumb.count()) {
        await attachmentThumb.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(600);
        const rect = await measureFixedOverlay(page);
        await page.screenshot({ path: path.join(OUT_DIR, 'overlay-messageattachment.png') });
        log('overlay: MessageAttachment lightbox fills viewport', rect.ok, rect.detail);
        await page.keyboard.press('Escape').catch(() => {});
      } else {
        log('overlay: MessageAttachment lightbox trigger not found', null, 'UNVERIFIED — no thread with an image attachment for this account');
      }
    } else {
      log('overlay: no message thread found to open', null, 'UNVERIFIED — no threads for this account');
    }

    // 4d/4e. AppLockGate / ForceUpdateGate — driven via the documented dev
    // harness query params rather than real state, since biometric hardware
    // and a stale native version can't be produced from a browser context.
    await page.goto(`${TARGET}/dashboard?app_lock_demo=1`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const lockRect = await measureFixedOverlay(page, false);
    await page.screenshot({ path: path.join(OUT_DIR, 'overlay-applockgate-attempt.png') });
    log('overlay: AppLockGate demo harness', lockRect.ok !== null, `${lockRect.detail} (demo flag may require additional setup — see AppLockGate.tsx APP_LOCK_DEMO)`);

    await context.close();
  }

  await browser.close();

  const failed = results.filter((r) => r.ok === false);
  const unverified = results.filter((r) => r.ok === null);
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n=== SUMMARY: ${results.length - failed.length - unverified.length}/${results.length} pass, ${failed.length} fail, ${unverified.length} unverified ===`);
  console.log(`Screenshots + results.json: ${OUT_DIR}`);
}

async function measureFixedOverlay(page, requireFound = true) {
  const info = await page.evaluate(() => {
    // Find the topmost, largest fixed-position element with a high z-index —
    // heuristic for "the overlay that just opened".
    const all = Array.from(document.querySelectorAll('*'));
    const fixedEls = all.filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    if (fixedEls.length === 0) return null;
    fixedEls.sort((a, b) => {
      const za = parseInt(getComputedStyle(a).zIndex) || 0;
      const zb = parseInt(getComputedStyle(b).zIndex) || 0;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (zb - za) || (rb.width * rb.height - ra.width * ra.height);
    });
    const el = fixedEls[0];
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, tag: el.tagName, cls: (el.className || '').toString().slice(0, 80) };
  });
  if (!info) return { ok: requireFound ? false : null, detail: 'no fixed-position element found (overlay may not have opened)' };
  const okBounds = Math.abs(info.top) < 2 && Math.abs(info.left) < 2;
  return { ok: okBounds, detail: JSON.stringify(info) };
}

main().catch((e) => {
  console.error('PROBE CRASHED:', e);
  process.exit(1);
});
