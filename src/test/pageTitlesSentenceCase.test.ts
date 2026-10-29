/**
 * Lead 2026-10-21 (after Q2198): every browser-tab / share title is sentence
 * case, like every other heading ("Log In — Helpr" was the sighting). Covers:
 *  - every title/ogTitle in src/lib/publicPageMeta.mjs (what crawlers and
 *    usePageMeta read);
 *  - every "… — Helpr" string or template literal in src/ (usePageTitle and
 *    usePageMeta callers, paymentReturnCopy);
 *  - the label tables those templates fill in: Profile's TAB_TITLES and
 *    Admin's VIEW_LABELS.
 * Each " — " part is checked on its own; "Terms of Service" and the
 * "Licensed & Insured" seal are names, not sentences.
 *
 * @mutate src/lib/publicPageMeta.mjs | title: "Log in — Helpr", | title: "Log In — Helpr",
 * @mutate src/pages/post-job/paymentReturnCopy.ts | "Confirming payment — Helpr" | "Confirming Payment — Helpr"
 * @mutate src/pages/admin/Admin.tsx | payouts: "Payout batches", | payouts: "Payout Batches",
 * @mutate src/pages/profile/types.ts | legal: "Legal & policies", | legal: "Legal & Policies",
 *
 * One suffix (audit 2026-10-28 P5-8): /terms/full and /privacy/full said
 * "— Louisiana Helpr" while every other tab title says "— Helpr" (AppPage's
 * usePageTitle and the rest of publicPageMeta). Every page `title` there ends
 * " — Helpr"; only the landing page leads with "Helpr — ".
 * @mutate src/lib/publicPageMeta.mjs | title: "Privacy Policy, full text — Helpr", | title: "Privacy Policy, full text — Louisiana Helpr",
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve, relative } from "node:path";
import * as meta from "@/lib/publicPageMeta.mjs";
import { TAB_TITLES } from "@/pages/profile/types";
import { sentenceCaseProblems } from "./helpers/sentenceCase";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
// Names, not sentences: the legal document and the credential seal (controlsSentenceCase NAMES).
const NAMES = [/Terms of Service/g, /Licensed & Insured/g];

function problems(title: string): string[] {
  let t = title;
  for (const n of NAMES) t = t.replace(n, "Terms");
  return t.split(" — ").flatMap((part) => sentenceCaseProblems(part.replace(/\$\{[^}]*\}/g, "\u0001")));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "test" && name !== "__tests__") walk(p, out); }
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

const metaTitles: string[] = [];
const pageTitles: string[] = [];
const collect = (v: unknown) => {
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === "title" && typeof x === "string") pageTitles.push(x);
    if ((k === "title" || k === "ogTitle") && typeof x === "string") metaTitles.push(x);
    else collect(x);
  }
};
collect(meta);

const literalTitles: { file: string; title: string }[] = [];
for (const f of walk(join(ROOT, "src"))) {
  const src = blankComments(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/(["`])([^"`\n]{1,100}? — (?:[^"`\n]* — )?Helpr)\1/g)) {
    literalTitles.push({ file: relative(ROOT, f), title: m[2] });
  }
}

const adminSrc = readFileSync(join(ROOT, "src/pages/admin/Admin.tsx"), "utf8");
const viewLabels = [...(adminSrc.match(/const VIEW_LABELS[^{]*\{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("page titles are sentence case", () => {
  it("found the titles it checks (not vacuous)", () => {
    expect(metaTitles.length).toBeGreaterThan(20);
    expect(literalTitles.length).toBeGreaterThan(10);
    expect(viewLabels.length).toBeGreaterThan(20);
  });
  it("publicPageMeta titles", () => {
    expect(metaTitles.filter((t) => problems(t).length)).toEqual([]);
  });
  it("every '… — Helpr' literal in src/", () => {
    expect(literalTitles.filter((t) => problems(t.title).length)).toEqual([]);
  });
  it("Profile tab titles and Admin view labels", () => {
    expect(Object.values(TAB_TITLES).filter((t) => problems(t).length)).toEqual([]);
    expect(viewLabels.filter((t) => problems(t).length)).toEqual([]);
  });
  it("every page title ends ' — Helpr', never ' — Louisiana Helpr' (P5-8)", () => {
    expect(pageTitles.length).toBeGreaterThan(15);
    const odd = pageTitles.filter((t) => t !== meta.LANDING_PAGE_META.title && !/ — Helpr$/.test(t));
    expect(odd).toEqual([]);
  });
});
