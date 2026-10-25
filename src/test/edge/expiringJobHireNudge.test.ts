/**
 * Hire nudge (owner 2026-10-25: remind posters to hire before their job
 * expires). Measured: three of the owner's paid jobs sat with 43, 27 and 76
 * applicants and nobody hired; the $150 one expired and was refunded.
 * expiring-jobs-push names the applicants waiting a day out, and sends one
 * final reminder in the last 6 hours when someone has applied.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/expiring-jobs-push/index.ts", "utf8");
const copyFn = src.slice(src.indexOf("export function expiringJobCopy"), src.indexOf("/** Pending applications per job"));
// The pure copy helper, evaluated as written (no Deno imports inside it).
const expiringJobCopy = new Function(
  `${copyFn.replace("export function", "function").replace(/: \{ title: string; message: string \}/, "").replace(/\(title: string \| null, waiting: number, when: "day" \| "final"\)/, "(title, waiting, when)")}; return expiringJobCopy;`,
)() as (t: string | null, n: number, w: "day" | "final") => { title: string; message: string };

describe("hire nudge", () => {
  it("a job with applicants names how many, a day out and in the last hours", () => {
    expect(expiringJobCopy("Clean a house", 43, "day").message).toBe('43 people have applied to "Clean a house". Pick someone before it expires tomorrow.');
    expect(expiringJobCopy("Clean a house", 1, "final")).toEqual({ title: "Pick someone today", message: '1 person has applied to "Clean a house", and it expires in a few hours. Pick someone before it closes.' });
  });

  it("a job nobody applied to keeps the boost reminder", () => {
    expect(expiringJobCopy("Mow", 0, "day").message).toMatch(/no helpr yet\. Boost it/);
  });

  it("the final reminder only goes when someone applied, is marked before it is sent, and is emailed", () => {
    // @mutate supabase/functions/expiring-jobs-push/index.ts |       if (waiting === 0) continue; |
    expect(src).toMatch(/if \(waiting === 0\) continue;/);
    expect(src.indexOf('.update({ expiring_final_notif_sent: true }')).toBeLessThan(src.indexOf('title: copy.title, message: copy.message, type: "job_updates"'));
    expect(src).toMatch(/await emailPoster\(job\.customer_id, job\.id, copy, emailNotes\);\s+finalSent\+\+;/);
  });
});
