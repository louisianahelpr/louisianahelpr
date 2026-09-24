/**
 * A-002: ai-job-builder returned the model's tool-call JSON verbatim, and the
 * client applies it with a bare cast (AiJobBuilder onGenerated → useJobEntry),
 * so the schema's enum and additionalProperties were never enforced: any
 * category string, any extra key, negative or non-finite numbers all reached
 * the form. The handler now returns sanitizeJob(parsed) or a 502.
 *
 * @mutate supabase/functions/ai-job-builder/index.ts | const jobData = sanitizeJob(JSON.parse(toolCall.function.arguments)); | const jobData = JSON.parse(toolCall.function.arguments);
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | ? r.category : "other", | ? r.category : r.category,
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | Math.min(hi, Math.max(lo, v)) | v
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | "storm_prep", "events", "other", | "storm_prep", "other",
 * @mutate supabase/functions/ai-job-builder/index.ts | " ").trim().slice(0, 80) | " ").trim()
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryHues } from "@/lib/categoryHues";
import { sanitizeJob } from "../../../supabase/functions/ai-job-builder/sanitize";

const base = { title: "Mow my lawn", description: "Front and back.", category: "yard_work" };

describe("ai-job-builder output is whitelisted and bounded (A-002)", () => {
  it("the handler returns the sanitised object, never the raw parse", () => {
    const src = readFileSync("supabase/functions/ai-job-builder/index.ts", "utf8");
    expect(src).toMatch(/const jobData = sanitizeJob\(JSON\.parse\(toolCall\.function\.arguments\)\);/);
  });

  it("client location reaches the system prompt as one bounded line", () => {
    const src = readFileSync("supabase/functions/ai-job-builder/index.ts", "utf8");
    expect(src).toContain('rawLocation.replace(/[\\r\\n]+/g, " ").trim().slice(0, 80)');
    expect(src).not.toMatch(/\$\{jobContext\.location/);
  });

  it("every canonical category survives; anything else becomes 'other'", () => {
    const keys = Object.keys(categoryHues);
    expect(keys.length).toBeGreaterThan(9);
    for (const c of keys) expect(sanitizeJob({ ...base, category: c })?.category).toBe(c);
    expect(sanitizeJob({ ...base, category: "<img src=x>" })?.category).toBe("other");
  });

  it("drops undeclared keys and bounds every number and string", () => {
    const out = sanitizeJob({
      ...base,
      title: "x".repeat(80),
      budget_min: -50,
      budget_max: 1e12,
      estimated_hours: Number.NaN,
      helpers_needed: 999,
      __proto_pollution: true,
      price: 1,
    })!;
    expect(out.title).toHaveLength(32);
    expect(out.budget_min).toBe(0);
    expect(out.budget_max).toBe(100_000);
    expect(out).not.toHaveProperty("estimated_hours");
    expect(out.helpers_needed).toBe(20);
    expect(out).not.toHaveProperty("price");
    expect(out).not.toHaveProperty("__proto_pollution");
  });

  it("refuses a non-object or one missing title/description", () => {
    expect(sanitizeJob(null)).toBeNull();
    expect(sanitizeJob([base])).toBeNull();
    expect(sanitizeJob({ ...base, title: 5 })).toBeNull();
  });
});
