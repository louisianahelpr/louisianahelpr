/**
 * META-GUARD: every baseline is TWO-WAY (OPEN.md Q36 part 3).
 *
 * A baseline / allowlist / KNOWN_ / LEGACY_ / grandfather list exempts known
 * offenders from a guard. One-way, it only stops NEW offenders; an entry whose
 * offender was fixed sits there forever, and then silently excuses the next
 * regression at the same key. That is the defect class: a fixed item parked
 * in a baseline. Two-way, an entry that no longer reproduces FAILS its own
 * guard ("stale baseline entry <x> — remove it (lower the baseline)").
 *
 * This file does not re-implement those checks. It proves each list HAS one:
 *
 *   1. DISCOVERY, from the tree, never from a list typed here:
 *      - JSON files named *baseline* / *allowlist* / *known* / *legacy* /
 *        *grandfather* under src/, scripts/, e2e/, docs/, supabase/functions/;
 *      - code constants matching the class regex (the same one the Q36 sweep
 *        used): `const|let <NAME with KNOWN|LEGACY|ALLOWLIST|ALLOWED|BASELINE|
 *        GRANDFATHER|EXEMPT|TOLERATED|ACCEPTED|IGNORED|WAIVED|SKIP> = [|{|new Set|…`.
 *   2. DECLARATION. A code constant carries, within the 15 lines above it,
 *        // @two-way <path of the check>:<text that only the check contains>
 *      A JSON file cannot carry a comment, so it is declared in JSON_TWO_WAY
 *      below — per SECTION, because a file like vacuity.baseline.json holds
 *      four independent lists and each needs its own check.
 *   3. VERIFICATION. The named file must exist and contain the text on a line
 *      that is not itself a @two-way marker.
 *   4. OUT OF SCOPE. A hit that is not an exemption list at all (app config,
 *      a directory-walk skip set, a design vocabulary) is named in OUT_OF_SCOPE
 *      with a one-line reason. An exclusion whose hit no longer exists fails
 *      too, so this file is two-way about itself.
 *
 * What it cannot prove: that the named check is CORRECT. That is each guard's
 * own vacuity registration. It proves the check exists where the list says,
 * so a new list with no stale check, or a check deleted from under its list,
 * turns this red.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

// ── discovery ──────────────────────────────────────────────────────────────
const CODE_ROOTS = ["src", "scripts", "e2e", "supabase/functions"];
const JSON_ROOTS = [...CODE_ROOTS, "docs"];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const LIST_JSON_NAME = /(baseline|allowlist|allow-list|known|legacy|grandfather)[^/]*\.json$/i;
export const LIST_DECL =
  /\b(?:const|let)\s+([A-Z_]*(?:KNOWN|LEGACY|ALLOWLIST|ALLOW_LIST|ALLOWED|BASELINE|GRANDFATHER|EXEMPT|TOLERATED|ACCEPTED|IGNORED|WAIVED|SKIP)[A-Z_]*)\s*(?::[^=]+)?=\s*(?:new (?:Set|Map)|\[|\{|Object|readJson|JSON)/;
const MARKER = /@two-way\s+([^\s:]+):(.+?)\s*$/;
const MARKER_WINDOW = 15;

/** Tracked + untracked-but-not-ignored, so a list added and not yet staged is still seen. */
function treeFiles(roots: string[]): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...roots], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => existsSync(join(REPO, f)));
}

export interface ConstHit {
  key: string; // `${file}::${NAME}`
  file: string;
  name: string;
  line: number; // 1-based
  marker: string | null; // "path:needle"
}

export function scanConstHits(files: Record<string, string>): ConstHit[] {
  const out: ConstHit[] = [];
  for (const [file, src] of Object.entries(files)) {
    const lines = src.split("\n");
    lines.forEach((l, i) => {
      const m = LIST_DECL.exec(l);
      if (!m) return;
      let marker: string | null = null;
      for (let j = i; j >= Math.max(0, i - MARKER_WINDOW); j--) {
        const mk = MARKER.exec(lines[j]);
        if (mk) {
          marker = `${mk[1]}:${mk[2]}`;
          break;
        }
      }
      out.push({ key: `${file}::${m[1]}`, file, name: m[1], line: i + 1, marker });
    });
  }
  return out;
}

/** Problems with one `path:needle` declaration, or [] when it points at a real check. */
export function markerProblems(where: string, marker: string, readFile: (p: string) => string | null): string[] {
  const colon = marker.indexOf(":");
  const path = marker.slice(0, colon);
  const needle = marker.slice(colon + 1).trim();
  if (colon < 1 || !needle) return [`${where}: malformed @two-way declaration "${marker}"`];
  const src = readFile(path);
  if (src === null) return [`${where}: its stale-entry check file ${path} does not exist`];
  const body = src
    .split("\n")
    .filter((l) => !l.includes("@two-way"))
    .join("\n");
  if (!body.includes(needle))
    return [`${where}: ${path} no longer contains its stale-entry check ${JSON.stringify(needle)}`];
  return [];
}

/** Top-level sections of a baseline JSON that hold entries (strings are notes). */
export function jsonSections(value: unknown): string[] {
  if (Array.isArray(value)) return ["[]"];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => !k.startsWith("/") && !k.startsWith("_") && typeof v !== "string")
    .map(([k]) => k);
}

// ── declarations ───────────────────────────────────────────────────────────
type SectionDecl = string | { out: string };

/**
 * JSON baselines, per section: "path:needle" of the stale-entry check, or
 * { out: reason } for a section that is deliberately NOT shrink-checked.
 */
const JSON_TWO_WAY: Record<string, Record<string, SectionDecl>> = {
  "e2e/happy-path/axe-known-violations.json": {
    "[]": "e2e/happy-path/knownAxeViolations.ts:out.stale.push(",
  },
  "docs/audit/loading-states/baseline.json": {
    allow: "scripts/check-loading-state-shape.mjs:const stale = [...allow].filter((id) => !seen.has(id))",
    byDesign: {
      out:
        "owner ruling 2026-09-19 (skeleton fills the screen, grows below): a tab that happens to fit one " +
        "screen does not jump, which is no evidence the ruling was abandoned; each entry must cite `ruling` instead.",
    },
  },
  // PARTIAL, measured: five full runs on 2026-09-21 showed the prober reaches a
  // different overlay set run to run, so "not seen this run" is not "fixed"
  // (runs 4 and 5 each failed on a DIFFERENT key with no code change). The
  // deterministic half — an entry naming a route the sweep no longer probes —
  // is what is checked. See the header of overlay-sweep.spec.ts.
  "e2e/happy-path/overlay-sweep.baseline.json": {
    keys: "e2e/happy-path/overlay-sweep.spec.ts:const orphaned = Object.keys(baseline.keys)",
  },
  "scripts/audit/a11y-webkit-known.json": {
    "[]": "scripts/audit/a11y-engine-diff.mjs:const stale = known.filter((k) => !seen.has(k.key))",
  },
  "scripts/audit/function-body-drift.baseline.json": {
    accepted: "scripts/audit/function-body-drift.mjs:const staleEntries =",
  },
  "scripts/audit/write-contract.baseline.json": {
    accepted: "src/test/writeContract.test.ts:baseline has no stale entries",
  },
  "scripts/any-baseline.json": {
    files: "src/test/anyRatchet.test.ts:FELL from",
  },
  "scripts/component-size-baseline.json": {
    files: "scripts/component-size-baseline.mjs:SHRANK from",
  },
  "scripts/deadcode-baseline.json": {
    exports: "src/test/deadcodeRatchet.test.ts:FELL from",
    types: "src/test/deadcodeRatchet.test.ts:FELL from",
    duplicates: "src/test/deadcodeRatchet.test.ts:FELL from",
  },
  "scripts/eslint-rules/button-height-legacy.json": {
    "[]": "src/test/buttonHeightLedger.test.ts:legacy ledger only lists files that still violate",
  },
  "scripts/eslint-rules/deleting-comment-stripper-legacy.json": {
    "[]": "src/test/deletingStripperLegacyOnlyShrinks.test.ts:const stale = legacy.filter",
  },
  "scripts/migration-raise-codes-allowlist.json": {
    allowed: "scripts/check-migration-raise-codes.mjs:export function staleAllowlistEntries",
  },
  "scripts/stated-counts-baseline.json": {
    undated: "scripts/check-stated-counts.mjs:const stale = [...base].filter((k) => !undated.has(k));",
  },
  "scripts/race-class-baseline.json": {
    allow: "scripts/check-race-class.mjs:stale: allowed.filter((k) => !hitKeys.has(k))",
    safe: "scripts/check-race-class.mjs:stale: allowed.filter((k) => !hitKeys.has(k))",
  },
  "src/test/vacuity.baseline.json": {
    unregistered: "scripts/vacuity/index.mjs:const staleBaseline =",
    noInventoryFloor: "scripts/vacuity/index.mjs:const staleA =",
    selfReferential: "scripts/vacuity/index.mjs:const staleD =",
    survivingMutations: "scripts/vacuity/index.mjs:const orphanSurvivors =",
  },
};

/** Constant-regex hits that are not exemption lists for a guard, with why. */
const OUT_OF_SCOPE: Record<string, string> = {
  "e2e/happy-path/error-state-sweep.spec.ts::EXEMPT_TABLES": "sweep scope config: tables never failed so the authed surface still renders; excuses no offender",
  "scripts/audit/press-every-control.mjs::DOCUMENTED_SKIPS": "vocabulary of skip dispositions the press script itself emits, not a list of offending controls",
  "scripts/audit/press-every-control.mjs::GATE_SKIPS": "derived at runtime from the SKIP_* exports of pressProdSafety.mjs (the gate's own reasons), not a list of offending controls",
  "scripts/audit/pressProdSafety.mjs::PROFILE_SKIP": "profile columns a prod-safety snapshot ignores (timestamps, counters); config, not offenders",
  "scripts/check-agent-refs.mjs::KNOWN_DEAD": "not an exemption: dead agent names mapped to a specific ERROR message",
  "scripts/check-discarded-query-filters.mjs::SKIP_DIRS": "directory-walk skip set (node_modules, dist, …)",
  "scripts/check-edge-syntax.cjs::SKIP": "directory-walk skip set",
  "scripts/check-vercel-config.mjs::ALLOWED": "vercel.json schema (allowed keys), not offenders",
  "scripts/test-signin-link.mjs::ALLOWED_EMAILS": "safety allowlist of test accounts a sign-in link may be minted for (app config)",
  "scripts/typecheck-edge.mjs::SKIP_DIRS": "directory-walk skip set",
  "src/components/ProtectedRoute.tsx::PROFILE_GATE_ALLOWED": "app routing config",
  "src/components/admin/AdminAuditLog.tsx::SKIP": "app display config (diff fields hidden in the audit log)",
  "src/test/secretScanGate.test.ts::ALLOWED_SAMPLES": "test inputs the secret scanner must NOT flag, each asserted per sample; exempts nothing in the repo",
  "src/components/glassCardScale.test.ts::ALLOWED": "design vocabulary (permitted padding classes), not offenders",
  "src/components/policy/CollapsedPolicy.tsx::SKIP_TAGS": "app rendering config",
  "src/components/profile/CredentialsTab.tsx::ALLOWED_TYPES": "app upload MIME types",
  "src/lib/appLock.ts::ALLOWED_GRACE_MS": "app setting domain",
  "src/lib/deepLinkRoute.ts::ALLOWED_DEEP_LINK_HOSTS": "app security allowlist (deep-link hosts)",
  "src/lib/imageUrl.ts::VERCEL_ALLOWED_WIDTHS": "app image-optimizer config",
  "src/pages/auth/completeProfile/constants.ts::ALLOWED_IMAGE_TYPES": "app upload MIME types",
  "src/pages/profile/giftCards/StatusPill.tsx::UNKNOWN": "app display fallback (name contains KNOWN)",
  "src/pages/auth/signup/signupHelpers.ts::ALLOWED_IMAGE_TYPES": "app upload MIME types",
  "src/test/giftCardNaming.test.ts::SKIP_DIRS": "directory-walk skip set",
  "src/test/helpers/walkSource.ts::SKIP_DIRS": "directory-walk skip set",
  "src/test/openJobsLocationMasking.test.ts::KNOWN_ANON_JOB_FEEDS": "a REQUIRED-positive inventory (each must still mask), not an exemption",
  "src/test/popupShellInventory.test.ts::ALLOWED": "design vocabulary (width classes that fill the shell), not offenders",
  "src/test/shellConsistency.test.ts::ALLOWED_SHELLS": "design vocabulary (the permitted page shells), not offenders",
  "supabase/functions/_shared/storageKeys.ts::LEGACY_EXT_MIME": "app MIME map for legacy file extensions",
  "supabase/functions/_shared/storageKeys.ts::DOCUMENT_EXT_ALLOWED": "app upload extension allowlist",
  "supabase/functions/admin-user-actions/banReviewCopy.ts::UNKNOWN_BAN_REVIEW_COPY": "app copy fallback (name contains KNOWN)",
  "supabase/functions/ai-job-builder/index.ts::ALLOWED_ROLES": "app input validation (chat roles)",
  "supabase/functions/create-notification/index.ts::ALLOWED_TYPES": "app input validation (notification types)",
  "supabase/functions/create-pro-checkout/index.ts::ALLOWED_CYCLES": "app input validation (billing cycles)",
  "supabase/functions/create-pro-checkout/index.ts::ALLOWED_TIERS": "app input validation (tiers)",
  "supabase/functions/str-ical-sync/safeFetch.ts::ALLOWED_PROTOCOLS": "app SSRF allowlist",
  "supabase/functions/str-ical-sync/safeFetch.ts::ALLOWED_PORTS": "app SSRF allowlist",
  "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts::KNOWN_CHECKOUT_KINDS": "app dispatch table of checkout kinds",
};

// ── the guard ──────────────────────────────────────────────────────────────
const readOrNull = (p: string): string | null => (existsSync(join(REPO, p)) ? read(p) : null);

describe("every baseline / allowlist / KNOWN_ list fails on a stale entry", () => {
  const codeFiles = treeFiles(CODE_ROOTS).filter((f) => CODE_FILE.test(f));
  const hits = scanConstHits(Object.fromEntries(codeFiles.map((f) => [f, read(f)])));
  const jsonFiles = treeFiles(JSON_ROOTS).filter((f) => LIST_JSON_NAME.test(f));

  it("discovers the inventory (a scan that finds nothing passes vacuously)", () => {
    // Measured 2026-09-22: 68 constant hits (identical to the Q36 `git grep -P` sweep), 11 JSON baselines.
    expect(codeFiles.length).toBeGreaterThan(1000);
    expect(hits.length).toBeGreaterThanOrEqual(68);
    expect(jsonFiles.length).toBeGreaterThanOrEqual(11);
  });

  it("every in-scope code list declares a stale-entry check that exists", () => {
    const problems: string[] = [];
    for (const h of hits) {
      const where = `${h.file}:${h.line} ${h.name}`;
      const excluded = h.key in OUT_OF_SCOPE;
      if (excluded && h.marker) problems.push(`${where}: has a @two-way marker AND an OUT_OF_SCOPE entry — pick one`);
      if (excluded) continue;
      if (!h.marker) {
        problems.push(
          `${where}: a baseline/allowlist with no declared stale-entry check. Add, in its own guard, a ` +
            `failure for an entry that no longer reproduces ("stale baseline entry <x> — remove it (lower ` +
            `the baseline)"), then declare it above the list:\n      // @two-way <path of the check>:<text only the check contains>\n` +
            `    or, if this is not an exemption list at all, add "${h.key}" to OUT_OF_SCOPE in this file with the reason.`,
        );
        continue;
      }
      problems.push(...markerProblems(where, h.marker, readOrNull));
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every JSON baseline declares a stale-entry check for every section", () => {
    const problems: string[] = [];
    for (const f of jsonFiles) {
      const decl = JSON_TWO_WAY[f];
      if (!decl) {
        problems.push(`${f}: a baseline JSON with no entry in JSON_TWO_WAY (src/test/baselinesAreTwoWay.test.ts)`);
        continue;
      }
      const sections = jsonSections(JSON.parse(read(f)));
      for (const s of sections) {
        const d = decl[s];
        if (d === undefined) problems.push(`${f} section "${s}": no stale-entry check declared`);
        else if (typeof d === "string") problems.push(...markerProblems(`${f} section "${s}"`, d, readOrNull));
        else if (d.out.length < 40) problems.push(`${f} section "${s}": an out-of-scope section needs a real reason`);
      }
      for (const s of Object.keys(decl))
        if (!sections.includes(s)) problems.push(`${f}: JSON_TWO_WAY declares section "${s}" the file no longer has — remove it`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the declarations are two-way themselves — no exclusion or registry entry for something that is gone", () => {
    const hitKeys = new Set(hits.map((h) => h.key));
    const staleOut = Object.keys(OUT_OF_SCOPE).filter((k) => !hitKeys.has(k));
    const staleJson = Object.keys(JSON_TWO_WAY).filter((f) => !jsonFiles.includes(f));
    expect(
      [...staleOut, ...staleJson].map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`),
    ).toEqual([]);
  });

  it("can fail: an unmarked KNOWN_ list, a marker naming a missing check, a stale exclusion", () => {
    // Built by concatenation so this file's own scan does not see a declaration here.
    const decl = "con" + "st KNOWN_PLANTED = [";
    const unmarked = scanConstHits({ "x.ts": `${decl}"a"];` });
    expect(unmarked).toHaveLength(1);
    expect(unmarked[0].marker).toBeNull();
    const marked = scanConstHits({ "x.ts": `// @two-way src/nope.test.ts:const stale =\n${decl}"a"];` });
    expect(marked[0].marker).toBe("src/nope.test.ts:const stale =");
    expect(markerProblems("x", marked[0].marker!, () => null)[0]).toMatch(/does not exist/);
    expect(markerProblems("x", "a.ts:const stale =", () => "// @two-way a.ts:const stale =\n")[0]).toMatch(
      /no longer contains/,
    );
    expect(markerProblems("x", "a.ts:const stale =", () => "const stale = 1;")).toEqual([]);
    expect(jsonSections({ "//": "note", allow: [], generated: "x", _doc: "y", n: 3 })).toEqual(["allow", "n"]);
  });
});

// Removing a list's declaration must turn this guard red.
// @mutate src/test/realtimePublication.test.ts | // @two-way src/test/realtimePublication.test.ts:const staleKnown = | // (declaration removed)
