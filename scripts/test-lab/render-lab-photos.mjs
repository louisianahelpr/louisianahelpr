#!/usr/bin/env node
/**
 * Placeholder product photos for the TEST LAB listings (scripts/test-lab/seed-test-lab.mjs).
 * One 900x900 JPEG per listing key: a large emoji of the item on a soft background, with
 * "TEST" in the corner, so nobody mistakes a lab listing for a real one.
 *
 *   node scripts/test-lab/render-lab-photos.mjs <out-dir>
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

export const LAB_PHOTO_EMOJI = {
  "test-listing": "🪜", "test-free": "🫙", "offer-open": "💡", "offer-countered": "🛋️", "offer-accepted": "🖼️",
  "offer-declined": "🗂️", "offer-expired": "🧺", "trade-want": "🍳", "trade-accepted-want": "🏮", "trade-lapsed-want": "🎲",
  "trade-give-1": "🔊", "trade-give-2": "🧘", "trade-give-3": "🧩", "o-paid-to-book": "🪴", "o-booked": "🪞",
  "o-porch-photo": "🪑", "o-picked-up": "🚲", "o-delivery": "💺", "o-completed": "☕", "o-buyer-cancelled": "🥾",
  "o-refund-requested": "🍟", "o-refund-partial": "🧶", "o-refund-declined": "🥤", "o-problem": "🪑", "set-out": "🏠",
};
const TONES = ["#efe6d8", "#e3ebe0", "#e6e4ef", "#f1e2dc", "#e0e9ee", "#efe9d6"];

if (process.argv[1]?.endsWith("render-lab-photos.mjs")) {
  const out = process.argv[2];
  if (!out) { console.error("Usage: node scripts/test-lab/render-lab-photos.mjs <out-dir>"); process.exit(2); }
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  let i = 0;
  for (const [key, emoji] of Object.entries(LAB_PHOTO_EMOJI)) {
    const tone = TONES[i++ % TONES.length];
    await page.setContent(`<!doctype html><html><body style="margin:0;width:900px;height:900px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 40% 35%, #fff 0%, ${tone} 70%);font-family:-apple-system,Helvetica,sans-serif">
      <div style="font-size:440px;line-height:1;filter:drop-shadow(0 24px 30px rgba(0,0,0,.18))">${emoji}</div>
      <div style="position:absolute;top:28px;left:28px;padding:8px 16px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:30px;font-weight:700;letter-spacing:.06em">TEST</div>
    </body></html>`);
    await page.screenshot({ path: join(out, `${key}.jpg`), type: "jpeg", quality: 82 });
  }
  await browser.close();
  console.log(`rendered ${i} photo(s) into ${out}`);
}
