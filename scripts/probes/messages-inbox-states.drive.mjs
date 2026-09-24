#!/usr/bin/env node
/**
 * Drive the states `messages-inbox-states.prod.mjs seed` created, against the
 * PRODUCTION BUILD served by `vite preview` and the REAL prod backend.
 *
 *   npx vite preview --port 4173 --strictPort &
 *   node scripts/probes/messages-inbox-states.prod.mjs seed
 *   node scripts/probes/messages-inbox-states.drive.mjs <stage>
 *
 * Stages: fit | unread | banner | cancelled | tiles | postjob
 *
 * Never the dev server (CLAUDE.md: CSS claims are only true of
 * `dist/assets/*.css`) and never the deployed site (test page loads paused the
 * Vercel project on 2026-09-14).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const OUT = process.env.SWEEP_OUTPUT_DIR || resolve(process.cwd(), "test-results/messages-lane");
const LEDGER = resolve(process.cwd(), "test-results/messages-inbox-states.ledger.json");
const stage = process.argv[2];
mkdirSync(OUT, { recursive: true });

const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const notes = [];
const say = (...a) => { const s = a.join(" "); notes.push(s); console.log(s); };

function sessionFor(account) {
  const raw = JSON.parse(
    execFileSync("node", ["scripts/test-signin-link.mjs", account, "--session", "--json"], { encoding: "utf8", maxBuffer: 1 << 24 }),
  );
  return { key: raw.key, value: raw.value };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const s = sessionFor("poster-e2e");
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(([k, v]) => {
  try {
    localStorage.setItem(k, v);
    localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  } catch { /* storage blocked */ }
}, [s.key, s.value]);
const page = await ctx.newPage();

async function goto(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1200);
}
async function shot(name) {
  const p = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: p });
  say(`  shot → ${p}`);
  return p;
}

/** Everything the fit question needs, measured in the live layout. */
async function measureHeader() {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const group = document.querySelector('[role="group"][aria-label="Filter conversations"]');
    const row = h1?.closest("div.flex.items-center") ?? null;
    const card = row?.parentElement?.closest("div") ?? null;
    const box = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    const actions = row ? row.lastElementChild : null;
    const tabButtons = group ? [...group.querySelectorAll("button")].map((b) => ({
      label: (b.textContent || "").trim(),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    })) : [];
    return {
      viewport: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      overflowing: [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().width > window.innerWidth + 1)
        .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`)
        .slice(0, 5),
      h1: { ...box(h1), text: h1?.textContent, srOnly: !!h1?.className?.includes?.("sr-only"), scrollW: h1?.scrollWidth, clientW: h1?.clientWidth, truncated: !!h1 && h1.scrollWidth > h1.clientWidth + 1 },
      headerRow: box(row),
      titleCardH: card ? Math.round(card.getBoundingClientRect().height) : null,
      tabGroup: box(group),
      tabsInRow: !!(row && group && row.contains(group)),
      actions: box(actions),
      tabButtons,
      disclosure: !!document.querySelector('button[aria-label="Filter conversations"], button[aria-label="Hide conversation filters"]'),
    };
  });
}

if (stage === "fit") {
  for (const w of [1440, 375, 320]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 });
    await goto("/messages");
    const m = await measureHeader();
    say(`\n[fit ${w}]`, JSON.stringify(m, null, 1));
    await shot(`fit-messages-${w}`);
  }
}

if (stage === "unread") {
  for (const w of [1440, 375]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 });
    await goto("/messages");
    const rows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="status"]')) {
        const r = el.getAttribute("aria-label") || "";
        if (/unread message/.test(r)) {
          const cs = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          out.push({ label: r, w: Math.round(b.width), h: Math.round(b.height), bg: cs.backgroundColor });
        }
      }
      return out;
    });
    say(`\n[unread ${w}] dots:`, JSON.stringify(rows));
    await shot(`unread-inbox-${w}`);
    if (w === 375) {
      // Zoomed crop of the list, so the dot can be judged at its real size
      // AND against the rows around it.
      const list = await page.$("main");
      if (list) await list.screenshot({ path: resolve(OUT, "unread-inbox-375-list.png") });
    }
  }
}

if (stage === "banner") {
  await page.setViewportSize({ width: 375, height: 812 });
  await goto("/messages");
  const b1 = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((b) => /isn't in Active — show all/.test(b.textContent || ""));
    return el ? { text: el.textContent.trim(), visible: !!el.offsetParent } : null;
  });
  say("\n[banner] on Active:", JSON.stringify(b1));
  await shot("banner-active-375");

  if (b1) {
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /isn't in Active — show all/.test(b.textContent || ""))?.click();
    });
    await sleep(900);
    const after = await page.evaluate(() => ({
      activeTab: [...document.querySelectorAll('[role="group"][aria-label="Filter conversations"] button')]
        .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent?.trim(),
      threadVisible: [...document.querySelectorAll("*")].some((el) => el.children.length === 0 && /question on an open posting/i.test(el.textContent || "")),
      bannerStillThere: [...document.querySelectorAll("button")].some((b) => /isn't in Active — show all/.test(b.textContent || "")),
    }));
    say("[banner] after tap:", JSON.stringify(after));
    await shot("banner-after-tap-all-375");
  }
}

if (stage === "banner-negative") {
  await page.setViewportSize({ width: 375, height: 812 });
  await goto("/messages");
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((x) => /isn't in Active — show all/.test(x.textContent || ""));
    const unreadDots = document.querySelectorAll('[role="status"][aria-label*="unread message"]').length;
    return { banner: el ? el.textContent.trim() : null, unreadDots };
  });
  say("\n[banner-negative] (open-job message marked read; live unreads still present):", JSON.stringify(b));
  await shot("banner-negative-375");
}

if (stage === "cancelled") {
  await page.setViewportSize({ width: 375, height: 812 });
  // 1. The thread that is ALREADY cancelled — the notice copy, read-only.
  await goto(`/messages?jobId=5eed0a20-0000-4000-8000-000000000001&userId=76b07824-9b41-4741-a4c4-4f8de362f682`);
  await sleep(1500);
  let st = await page.evaluate(() => ({
    notice: document.querySelector('[data-testid="thread-closed-notice"]')?.innerText ?? null,
    composer: !!document.querySelector('input[placeholder="Type a message…"]'),
    draftBox: document.querySelector('[data-testid="thread-closed-unsent-draft"]')?.innerText ?? null,
  }));
  say("\n[cancelled] existing cancelled thread:", JSON.stringify(st));
  await shot("cancelled-existing-thread-375");

  // 2. THE RACE: a live thread, text in the box, job cancelled underneath.
  await goto(`/messages?jobId=${ledger.cancelJobId}&userId=437de07d-1bd7-46c8-a451-6b46aa3bcad5`);
  await sleep(1500);
  const ta = await page.$('input[placeholder="Type a message…"]');
  if (!ta) { say("[cancelled] NO COMPOSER on the live thread — cannot run the race"); }
  else {
    await ta.click();
    await ta.type("Sorry, one more thing before you head out — is the side gate", { delay: 8 });
    await shot("cancelled-race-before-375");
    execFileSync("node", ["scripts/probes/messages-inbox-states.prod.mjs", "cancel"], { encoding: "utf8" });
    say("[cancelled] job flipped to cancelled on prod while the box held text");
    await sleep(6000);
    st = await page.evaluate(() => ({
      notice: document.querySelector('[data-testid="thread-closed-notice"]')?.innerText ?? null,
      composer: !!document.querySelector('input[placeholder="Type a message…"]'),
      draftBox: document.querySelector('[data-testid="thread-closed-unsent-draft"]')?.innerText ?? null,
    }));
    say("[cancelled] after cancel, WITHOUT reload:", JSON.stringify(st));
    await shot("cancelled-race-after-375");

    // THE RECOVERY PATH. `sendHandlers.ts` patches messagingClosesAt/jobStatus
    // onto the conversation only when a send is REFUSED, so pressing Send is
    // the only way an already-open thread learns it has closed. Pressing it is
    // therefore part of the evidence, not a stray interaction.
    await page.keyboard.press("Enter");
    await sleep(5000);
    st = await page.evaluate(() => ({
      notice: document.querySelector('[data-testid="thread-closed-notice"]')?.innerText ?? null,
      composer: !!document.querySelector('input[placeholder="Type a message…"]'),
      draftBox: document.querySelector('[data-testid="thread-closed-unsent-draft"]')?.innerText ?? null,
      failedBubble: /Not Sent — Conversation Closed/.test(document.body.innerText),
    }));
    say("[cancelled] after pressing Send:", JSON.stringify(st));
    await shot("cancelled-race-after-send-375");
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2500);
    st = await page.evaluate(() => ({
      notice: document.querySelector('[data-testid="thread-closed-notice"]')?.innerText ?? null,
      composer: !!document.querySelector('input[placeholder="Type a message…"]'),
      draftBox: document.querySelector('[data-testid="thread-closed-unsent-draft"]')?.innerText ?? null,
    }));
    say("[cancelled] after RELOAD (draft is per-visit by design):", JSON.stringify(st));
    await shot("cancelled-race-after-reload-375");
  }
}

if (stage === "tiles") {
  const jobs = [
    ["time", "ff278393-8def-454f-891f-487de2252263"],
    ["flexible", "3c2028d5-7479-4c96-80b7-35e4f34254e9"],
    ["neither", ledger.timeTileControl],
  ];
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 812 });
    for (const [label, id] of jobs) {
      await goto(`/home?quickApply=${id}`);
      await sleep(2500);
      const m = await page.evaluate(() => {
        // The compact meta row: the first grid inside the dialog whose every
        // child is a tile with its own icon. Labels are not printed, so it
        // cannot be found by the word "Where".
        const g = [...document.querySelectorAll('[role="dialog"] div.grid, div.grid')]
          .find((x) => x.children.length >= 2 && [...x.children].every((c) => c.querySelector("svg")));
        if (!g) return { found: false };
        const cells = [...g.children].map((c) => ({
          text: (c.textContent || "").trim(),
          w: Math.round(c.getBoundingClientRect().width),
          empty: !(c.textContent || "").trim(),
        }));
        return {
          found: true,
          gridClass: g.className,
          cols: getComputedStyle(g).gridTemplateColumns,
          cells,
          emptyCells: cells.filter((c) => c.empty).length,
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      say(`\n[tiles ${w} ${label}]`, JSON.stringify(m));
      await shot(`tiles-${label}-${w}`);
    }
  }
}

if (stage === "postjob") {
  await page.setViewportSize({ width: 375, height: 812 });
  await goto("/post-job");
  await sleep(1500);
  await shot("postjob-entry-375");
  say("\n[postjob] driven interactively below — see the transcript for the step walk");
}

writeFileSync(resolve(OUT, `notes-${stage}.txt`), notes.join("\n") + "\n");
await browser.close();
