/**
 * REACTION CHIPS NEVER COVER TEXT (owner, 2026-09-14).
 *
 * A tapback chip sat `absolute -top-3` on the bubble's corner. The global 44px
 * tap floor (index.css `:where(button…)`) made each chip a 44px disc, and that
 * disc covered the first line of the message it belonged to. No overflow,
 * clipping or axe check sees it: the chip is inside the bubble's box.
 *
 * Geometry on the real rendered thread, never jsdom (no layout there): every
 * chip's bounding box against the client rects of EVERY text node in the
 * thread (its own bubble, the neighbouring bubbles, the timestamps). Any
 * intersection is a failure. Inventory is the thread's own chips: the spec
 * fails if it finds none, so a checker that sees nothing proves nothing.
 *
 * One thread, read-only: the poster-e2e thread with the most reactions, found
 * by REST as that account. 375 and 1440; at 375 it also shoots light + dark
 * (a colour-scheme switch, not a second page load).
 *
 * Red on the original: run against the live site before the fix
 * (PLAYWRIGHT_BASE_URL=https://www.louisianahelpr.com).
 *
 * Shown able to fail 2026-09-21 by re-creating the original defect. `-mt-2`
 * tucks the chip 8px into the bubble's 10px bottom padding; `-mt-10` lifts it
 * back up over the glyphs, which is the shape the owner reported.
 * MessageBubble.tsx already names this spec as its guard in the comment beside
 * that very class.
 */
// @mutate src/components/messages/MessageBubble.tsx | -mt-2 flex items-center gap-0.5 | -mt-10 flex items-center gap-0.5
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getSession, rest, settle, SUPABASE_URL, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
let thread: { jobId: string; otherId: string; reactions: number } | null = null;

test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
  const r = await request.get(`${SUPABASE_URL}/rest/v1/message_reactions?select=message_id&limit=500`, { headers: rest(poster) });
  expect(r.ok(), `message_reactions read: ${r.status()}`).toBe(true);
  const ids = [...new Set(((await r.json()) as { message_id: string }[]).map((x) => x.message_id))];
  if (!ids.length) return;
  const m = await request.get(
    `${SUPABASE_URL}/rest/v1/messages?select=id,job_id,sender_id,receiver_id&id=in.(${ids.slice(0, 150).join(",")})`,
    { headers: rest(poster) },
  );
  expect(m.ok(), `messages read: ${m.status()}`).toBe(true);
  const tally = new Map<string, { jobId: string; otherId: string; reactions: number }>();
  for (const row of (await m.json()) as { job_id: string; sender_id: string; receiver_id: string }[]) {
    const otherId = row.sender_id === poster.user.id ? row.receiver_id : row.sender_id;
    const k = `${row.job_id}|${otherId}`;
    const t = tally.get(k) ?? { jobId: row.job_id, otherId, reactions: 0 };
    t.reactions++;
    tally.set(k, t);
  }
  thread = [...tally.values()].sort((a, b) => b.reactions - a.reactions)[0] ?? null;
});

type Overlap = { chip: string; mine: boolean; text: string; lines: number };

/** Runs in the page. Every chip against every text rect in the thread. */
function measure(): { chips: { mine: boolean; lines: number }[]; overlaps: Overlap[] } {
  const CHIP = /^(React with|Remove your) /;
  const rows = [...document.querySelectorAll<HTMLElement>("[data-msg-id]")];
  const chips = rows.flatMap((row) =>
    [...row.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
      .filter((b) => CHIP.test(b.getAttribute("aria-label") ?? ""))
      .map((b) => ({ b, row })),
  );
  const texts: { node: Text; rects: DOMRect[] }[] = [];
  for (const row of rows) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (!n.data.trim()) continue;
      if (n.parentElement?.closest("button[aria-label]") && CHIP.test(n.parentElement.closest("button")!.getAttribute("aria-label") ?? "")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      texts.push({ node: n, rects: [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0) });
    }
  }
  const linesOf = (row: HTMLElement) => {
    const p = row.querySelector("p");
    if (!p) return 0;
    const range = document.createRange();
    range.selectNodeContents(p);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  };
  const overlaps: Overlap[] = [];
  const out = chips.map(({ b, row }) => {
    const mine = row.classList.contains("items-end");
    const c = b.getBoundingClientRect();
    for (const t of texts) {
      for (const r of t.rects) {
        const x = Math.min(c.right, r.right) - Math.max(c.left, r.left);
        const y = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
        if (x > 0.5 && y > 0.5) {
          overlaps.push({
            chip: `${b.getAttribute("aria-label")} ${Math.round(c.width)}x${Math.round(c.height)}`,
            mine,
            text: t.node.data.trim().slice(0, 40),
            lines: linesOf(row),
          });
        }
      }
    }
    return { mine, lines: linesOf(row) };
  });
  return { chips: out, overlaps };
}

async function openThread(page: Page) {
  await page.goto(`/messages?jobId=${thread!.jobId}&userId=${thread!.otherId}`);
  await settle(page);
  await expect(page.getByRole("button", { name: /^(React with|Remove your) / }).first(), "no reaction chip rendered in the thread").toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

for (const vw of [375, 1440] as const) {
  test(`reaction chips clear every glyph in the thread at ${vw}`, async ({ browser }, info) => {
    test.skip(!thread, "GAP: poster-e2e has no message with a reaction");
    // Own context rather than newUserContext: that one is 390 wide, and 375 is
    // the width that matters.
    const ctx = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width: vw, height: vw === 1440 ? 900 : 812 },
      hasTouch: vw === 375,
      colorScheme: "light",
      serviceWorkers: "block",
    });
    await ctx.addInitScript(({ key, val }) => {
      try {
        if (!sessionStorage.getItem("__seeded")) {
          localStorage.setItem(key, val);
          sessionStorage.setItem("__seeded", "1");
        }
        localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      } catch { /* signed out: the chip assertion fails visibly */ }
    }, { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) });
    const page = await ctx.newPage();
    await openThread(page);

    const { chips, overlaps } = await page.evaluate(measure);
    info.annotations.push({
      type: "inventory",
      description: `job ${thread!.jobId.slice(0, 8)}: ${chips.length} chips; own ${chips.filter((c) => c.mine).length}, other ${chips.filter((c) => !c.mine).length}; line counts ${chips.map((c) => c.lines).join(",")}`,
    });

    if (process.env.LH_REACTION_SHOTS) {
      const dir = process.env.LH_REACTION_SHOTS;
      mkdirSync(dir, { recursive: true });
      const host = new URL(page.url()).host.replace(/[:.]/g, "_");
      // Every reacted row (own and other's), same page load.
      const reacted = page.locator("[data-msg-id]").filter({ has: page.getByRole("button", { name: /^(React with|Remove your) / }) });
      const n = await reacted.count();
      for (let i = 0; i < n; i++) {
        await reacted.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }));
        for (const scheme of vw === 375 ? (["light", "dark"] as const) : (["light"] as const)) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.waitForTimeout(400);
          await page.screenshot({ path: join(dir, `reactions-${host}-${vw}-${scheme}-${i}.png`) });
        }
      }
    }

    expect(chips.length, "no reaction chips measured").toBeGreaterThan(0);
    expect(overlaps, `reaction chip covers text at ${vw}:\n${overlaps.map((o) => JSON.stringify(o)).join("\n")}`).toEqual([]);
    await ctx.close();
  });
}
