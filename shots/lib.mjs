import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
export const BASE = 'http://localhost:4202';
export const VP = { m: { width: 375, height: 812 }, d: { width: 1440, height: 900 } };
const cache = {};
export const ACCOUNT = process.env.LH_ACCOUNT || 'poster';
export function session(acct = ACCOUNT) {
  if (cache[acct]) return cache[acct];
  const out = execSync(`node scripts/test-signin-link.mjs ${acct} --session --json`, { cwd: process.env.HOME + '/.lh-sweep/poster', encoding: 'utf8', stdio: ['ignore','pipe','ignore'] });
  cache[acct] = JSON.parse(out.slice(out.indexOf('{')));
  return cache[acct];
}
export async function launch(headless = false) {
  return chromium.launch({ headless });
}
export async function ctx(browser, vp = 'm', theme = 'light') {
  const s = session();
  const c = await browser.newContext({ viewport: VP[vp], colorScheme: theme, serviceWorkers: 'block', deviceScaleFactor: 1 });
  await c.addInitScript(({ key, value, theme }) => {
    try { localStorage.setItem(key, value); localStorage.setItem('helpr-theme', theme);
      localStorage.setItem('helpr_onboarding', JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] })); } catch {}
  }, { key: s.key, value: s.value, theme });
  const page = await c.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => page.errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('response', r => { if (r.status() >= 400) page.errors.push(`HTTP ${r.status()} ${r.url().slice(0,160)}`); });
  page.tag = `${vp}-${theme}`;
  return page;
}
export async function goto(page, path, wait = 1500) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(wait);
}
export async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const cw = de.clientWidth;
    const wide = [];
    const clipped = [];
    const bad = [];
    const txtRe = /\bNaN\b|\bundefined\b|\[object Object\]|\bnull\b/;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.classList.contains('sr-only')) continue;
      if (r.right > cw + 1 && cs.position !== 'fixed' && r.left < cw) wide.push(`${el.tagName}.${String(el.className).slice(0,40)} right=${Math.round(r.right)}`);
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && !el.querySelector('[style*="overflow"]') && el.children.length === 0)
        clipped.push(`${el.tagName}.${String(el.className).slice(0,40)} "${(el.textContent||'').trim().slice(0,50)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) { const t = n.textContent; if (txtRe.test(t)) bad.push(t.trim().slice(0, 80)); }
    return { hOverflow: de.scrollWidth > cw, scrollWidth: de.scrollWidth, cw, wide: wide.slice(0, 10), clipped: clipped.slice(0, 15), bad: bad.slice(0, 10), url: location.pathname + location.search };
  });
}
export async function shoot(page, name, full = false) {
  const p = `${process.env.HOME}/.lh-sweep/poster/shots/${name}-${page.tag}.png`;
  await page.screenshot({ path: p, fullPage: full });
  const m = await measure(page);
  const errs = page.errors.splice(0);
  const line = `${name} [${page.tag}] url=${m.url} hOverflow=${m.hOverflow}(${m.scrollWidth}/${m.cw}) wide=${m.wide.length} clipped=${m.clipped.length} bad=${m.bad.length} errs=${errs.length}`;
  console.log(line);
  if (m.wide.length) console.log('  WIDE:', m.wide.join(' | '));
  if (m.clipped.length) console.log('  CLIPPED:', m.clipped.join(' | '));
  if (m.bad.length) console.log('  BADTXT:', m.bad.join(' | '));
  if (errs.length) console.log('  ERRS:', errs.join(' | '));
  fs.appendFileSync(`${process.env.HOME}/.lh-sweep/poster/shots/log.txt`, line + '\n');
  return m;
}
export async function all4(browser, fn) {
  for (const vp of ['m', 'd']) for (const theme of ['light', 'dark']) {
    const page = await ctx(browser, vp, theme);
    try { await fn(page, vp, theme); } catch (e) { console.log(`ERR ${vp}-${theme}:`, e.message.slice(0, 200)); }
    await page.context().close();
  }
}
