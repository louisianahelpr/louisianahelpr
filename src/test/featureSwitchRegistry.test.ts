// @mutate supabase/migrations/20261012031120_hidden_feature_switches.sql | VALUES ('switch_canary', 'testers', | VALUES ('switch_canary', 'everyone',
// @mutate supabase/migrations/20261012031120_hidden_feature_switches.sql | ON CONFLICT (key) DO NOTHING; | ON CONFLICT (key) DO UPDATE SET audience = EXCLUDED.audience;
// @mutate src/config/featureSwitches.ts |   "declutter_add_helpr",\n] as const; |   "declutter_add_helpr",\n  "orphan_switch",\n] as const;
// @mutate src/components/admin/settings/FeatureSwitchesCard.tsx | useFeature("switch_canary") | useFeature("switch_canarx")
/**
 * Hidden feature switches (owner decision 2026-10-11; migration
 * 20261012031120): the registry is public.feature_switches, created by
 * migrations only, and read in the app with useFeature("<key>").
 *
 * (a) A switch is never BORN on for everyone. Every INSERT INTO
 *     feature_switches in any migration names its audience explicitly as
 *     'off' or 'testers', and ends ON CONFLICT (key) DO NOTHING (a replay must
 *     never reset the audience an admin chose, nor flip it on). No migration
 *     UPDATEs a switch to 'everyone': going live is an admin's audited flip.
 *     (The server refuses it too: the BEFORE INSERT trigger
 *     feature_switches_never_created_on, proven in
 *     src/test/pglite/hiddenFeatureSwitches.pglite.mjs.)
 * (b) EXACT both ways: the keys the migrations leave in the registry ==
 *     FEATURE_SWITCH_KEYS (src/config/featureSwitches.ts) == the keys passed to
 *     useFeature() across src. A useFeature call whose argument is not a string
 *     literal fails (it cannot be checked).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { readdirSync } from "./helpers/trackedFiles";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

const ROOT = path.resolve(__dirname, "../..");
const MIG_DIR = path.join(ROOT, "supabase/migrations");

/** Split `s` at top-level occurrences of `sep`, outside quotes and parens. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") quote = false;
      continue;
    }
    if (c === "'") quote = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === sep && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The single-quoted literal a value expression is (adjacent literals concatenated), or null. */
function literal(expr: string): string | null {
  const parts = [...expr.matchAll(/'((?:[^']|'')*)'/g)];
  const rest = expr.replace(/'((?:[^']|'')*)'/g, "").trim();
  if (parts.length === 0 || rest !== "") return null;
  return parts.map((m) => m[1].replace(/''/g, "'")).join("");
}

interface InsertFinding { file: string; problem: string }

export function readRegistryFromMigrations(dir = MIG_DIR): { keys: Set<string>; problems: InsertFinding[]; inserts: number } {
  const keys = new Set<string>();
  const problems: InsertFinding[] = [];
  let inserts = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const m of sql.matchAll(/INSERT\s+INTO\s+(?:public\.)?feature_switches\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);/gi)) {
      inserts++;
      const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
      const body = m[2];
      const conflictAt = body.search(/\bON\s+CONFLICT\b/i);
      const valuesPart = conflictAt >= 0 ? body.slice(0, conflictAt) : body;
      const conflict = conflictAt >= 0 ? body.slice(conflictAt).replace(/\s+/g, " ").trim() : "";
      if (!/^ON CONFLICT \(key\) DO NOTHING$/i.test(conflict)) {
        problems.push({ file, problem: `INSERT must end ON CONFLICT (key) DO NOTHING, has "${conflict || "nothing"}"` });
      }
      const kIdx = cols.indexOf("key");
      const aIdx = cols.indexOf("audience");
      if (kIdx < 0 || aIdx < 0) {
        problems.push({ file, problem: `INSERT must name key and audience explicitly (columns: ${cols.join(", ")})` });
        continue;
      }
      for (const tuple of splitTop(valuesPart, ",")) {
        const inner = tuple.replace(/^\(/, "").replace(/\)$/, "");
        const vals = splitTop(inner, ",");
        const key = literal(vals[kIdx] ?? "");
        const audience = literal(vals[aIdx] ?? "");
        if (!key) { problems.push({ file, problem: `INSERT key is not a literal: ${vals[kIdx]}` }); continue; }
        if (audience !== "off" && audience !== "testers") {
          problems.push({ file, problem: `switch ${key} is created as ${audience ?? vals[aIdx]}; a switch is created off or testers` });
        }
        keys.add(key);
      }
    }
    for (const m of sql.matchAll(/UPDATE\s+(?:public\.)?feature_switches\b([\s\S]*?);/gi)) {
      if (/'everyone'/i.test(m[1])) problems.push({ file, problem: "a migration UPDATEs a switch to 'everyone'; going live is an admin's audited flip" });
    }
    for (const m of sql.matchAll(/DELETE\s+FROM\s+(?:public\.)?feature_switches\s+WHERE\s+key\s*(?:=\s*('(?:[^']|'')*')|IN\s*\(([^)]*)\))/gi)) {
      const list = m[1] ? [m[1]] : splitTop(m[2], ",");
      for (const v of list) { const k = literal(v); if (k) keys.delete(k); }
    }
  }
  return { keys, problems, inserts };
}

export function readUseFeatureKeys(srcDir = path.join(ROOT, "src")): { keys: Set<string>; nonLiteral: string[]; calls: number } {
  const keys = new Set<string>();
  const nonLiteral: string[] = [];
  let calls = 0;
  const files = walkSource([srcDir]).filter(
    (p) => !/\.test\.(ts|tsx)$/.test(p) && !p.includes(`${path.sep}test${path.sep}`),
  );
  for (const file of files) {
    const raw = readSource(file);
    if (raw === null) continue;
    const code = blankComments(raw);
    for (const m of code.matchAll(/\buseFeature(?:Status)?\s*\(([^)]*)\)/g)) {
      // The hooks' own declarations `function useFeature(key: FeatureKey)`
      // and `function useFeatureStatus(key: FeatureKey)`.
      if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
      // useFeature's own body delegates `useFeatureStatus(key)`; the key is
      // checked at useFeature's call sites.
      if (path.relative(ROOT, file) === path.join("src", "hooks", "useFeature.ts") && m[1].trim() === "key") continue;
      calls++;
      const arg = m[1].trim();
      const lit = /^(["'])([a-z][a-z0-9_]*)\1$/.exec(arg);
      if (lit) keys.add(lit[2]);
      else nonLiteral.push(`${path.relative(ROOT, file)}: useFeature(${arg})`);
    }
  }
  return { keys, nonLiteral, calls };
}

const sorted = (s: Iterable<string>) => [...s].sort();

describe("hidden feature switches: registry", () => {
  const reg = readRegistryFromMigrations();
  const used = readUseFeatureKeys();

  it("reads a real inventory (floors)", () => {
    expect(reg.inserts).toBeGreaterThan(0);
    expect(reg.keys.size).toBeGreaterThan(0);
    expect(used.calls).toBeGreaterThan(0);
  });

  it("(a) no migration creates a switch on for everyone, or overwrites an audience", () => {
    expect(reg.problems).toEqual([]);
  });

  it("(b) every useFeature argument is a string literal", () => {
    expect(used.nonLiteral).toEqual([]);
  });

  it("(b) migrations' registry == FEATURE_SWITCH_KEYS == keys read by useFeature (exact both ways)", () => {
    expect(sorted(FEATURE_SWITCH_KEYS)).toEqual(sorted(reg.keys));
    expect(sorted(used.keys)).toEqual(sorted(reg.keys));
  });

  it("the parser catches a planted 'everyone' creation and a DO UPDATE (synthetic)", () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fs-reg-"));
    fs.writeFileSync(path.join(tmp, "1_a.sql"),
      "-- INSERT INTO public.feature_switches (key, audience, description) VALUES ('commented', 'everyone', 'x');\n" +
      "INSERT INTO public.feature_switches (key, audience, description) VALUES ('a_on', 'everyone', 'x, y'), ('b_ok', 'testers', 'z') ON CONFLICT (key) DO NOTHING;\n" +
      "INSERT INTO public.feature_switches (key, audience, description) VALUES ('c_up', 'off', 'x') ON CONFLICT (key) DO UPDATE SET audience = 'off';\n" +
      "UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'b_ok';\n" +
      "DELETE FROM public.feature_switches WHERE key = 'c_up';\n");
    const r = readRegistryFromMigrations(tmp);
    fs.rmSync(tmp, { recursive: true });
    expect(sorted(r.keys)).toEqual(["a_on", "b_ok"]);
    expect(r.problems.map((p) => p.problem)).toEqual([
      "switch a_on is created as everyone; a switch is created off or testers",
      "INSERT must end ON CONFLICT (key) DO NOTHING, has \"ON CONFLICT (key) DO UPDATE SET audience = 'off'\"",
      "a migration UPDATEs a switch to 'everyone'; going live is an admin's audited flip",
    ]);
  });
});
