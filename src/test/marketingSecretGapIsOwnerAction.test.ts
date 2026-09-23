// @mutate supabase/functions/_shared/marketing/secretGap.ts |     severity: "warning", |     severity: "critical",
// @mutate supabase/functions/_shared/marketing/secretGap.ts |     oncePerDayKey: META_SECRET_GAP_KEY, |     oncePerDayKey: `${META_SECRET_GAP_KEY}:${Date.now()}`,
// @mutate supabase/functions/marketing-publish/index.ts |       await postSlackOpsAlert(metaSecretGapAlert(secretGaps)); |       defects.record("secrets"); await postSlackOpsAlert(metaSecretGapAlert(secretGaps));
/*
 * CLASS GUARD (docs/OPEN.md Q42): "a marketing channel is enabled but its Meta
 * secret is missing" is ONE owner-action ledger item, not a page per tick.
 *
 * Measured 2026-09-23: between 11:03Z and 13:33Z marketing-publish posted 11
 * CRITICAL "Marketing auto-publish is on but not configured" pages, and the
 * same ticks returned HTTP 500 (a defect), which opened a second item,
 * "cron http failure: marketing-publish returned 500" (21x). Both were one
 * config gap only the owner can close. Nothing was broken: the function
 * claims nothing when a secret is missing, so the queue stays intact.
 *
 * The four properties that make it one item: not critical; a stable title
 * (the ledger fingerprint); a stable once-per-day key (Slack once a day); and
 * the branch records NO defect (so the cron returns 200).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  META_SECRET_GAP_KEY,
  META_SECRET_GAP_TITLE,
  metaSecretGapAlert,
} from "../../supabase/functions/_shared/marketing/secretGap";

const ROOT = resolve(__dirname, "../..");

/** The body of `if (secretGaps.length > 0) { ... }`, brace-matched, comments blanked. */
function secretGapBranch(): string {
  const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/marketing-publish/index.ts"), "utf8"));
  const start = src.indexOf("if (secretGaps.length > 0) {");
  expect(start, "marketing-publish no longer has the secret-gap branch; re-point this guard").toBeGreaterThan(0);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces");
}

describe("a missing Meta secret is an owner action, not a page", () => {
  it("the alert is a warning with a stable title and a stable once-per-day key", () => {
    const a = metaSecretGapAlert(["instagram: META_IG_USER_ID"]);
    const b = metaSecretGapAlert(["facebook: META_PAGE_ACCESS_TOKEN, META_PAGE_ID"]);
    expect(a.severity).toBe("warning");
    expect(a.kind).not.toBe("stripe_webhook_error");
    expect(a.title).toBe(META_SECRET_GAP_TITLE);
    expect(b.title).toBe(a.title);
    expect(a.oncePerDayKey).toBe(META_SECRET_GAP_KEY);
    expect(b.oncePerDayKey).toBe(a.oncePerDayKey);
    expect(a.oncePerDayKey).not.toMatch(/\d{6,}/);
    expect(a.fields.missing).toContain("META_IG_USER_ID");
  });

  it("marketing-publish's secret-gap branch posts that alert and records no defect", () => {
    const branch = secretGapBranch();
    expect(branch).toContain("postSlackOpsAlert(metaSecretGapAlert(secretGaps))");
    expect(branch).not.toMatch(/defects\.record\s*\(/);
    expect(branch).toMatch(/\{\s*count:\s*0\s*\}/);
    expect(branch).not.toMatch(/severity:\s*["']critical["']/);
  });
});
