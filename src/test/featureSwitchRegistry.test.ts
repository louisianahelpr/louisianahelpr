// @mutate supabase/migrations/20261012031120_hidden_feature_switches.sql | VALUES ('switch_canary', 'testers', | VALUES ('switch_canary', 'everyone',
// @mutate supabase/migrations/20261012031120_hidden_feature_switches.sql | ON CONFLICT (key) DO NOTHING; | ON CONFLICT (key) DO UPDATE SET audience = EXCLUDED.audience;
// @mutate src/config/featureSwitches.ts |   "declutter_shipping",\n] as const; |   "declutter_shipping",\n  "orphan_switch",\n] as const;
// @mutate src/components/admin/settings/FeatureSwitchesCard.tsx | useFeature("switch_canary") | useFeature("switch_canarx")
// @mutate src/config/featureSwitches.ts | SERVER_ONLY_FEATURE_SWITCH_KEYS: readonly FeatureKey[] = ["come_back_emails", "paypal_payments", "checkout_nudge", "confirm_reminders", "scanner_safe_confirm_links"]; | SERVER_ONLY_FEATURE_SWITCH_KEYS: readonly FeatureKey[] = [];
// @mutate supabase/migrations/20261021135832_promotions_not_chosen_until_set.sql |        AND public.feature_enabled_for_user('come_back_emails', p.user_id) |        AND true
// @mutate supabase/migrations/20261021135921_come_back_emails_on_for_everyone.sql |         AND a.target_id = 'come_back_emails'); |         AND a.target_id = 'other');
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
 * (c) A switch with no screen (SERVER_ONLY_FEATURE_SWITCH_KEYS, e.g. the
 *     come-back emails cron) is the one exception to "read by useFeature": it
 *     is never read by useFeature and IS read by a migration's
 *     feature_enabled_for_user('<key>', ...). Exact both ways too.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { FEATURE_SWITCH_KEYS, SERVER_ONLY_FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

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

/**
 * The owner-approved exceptions to "no migration turns a switch on for
 * everyone", by migration file -> the one switch it may turn on. EXACT both
 * ways: each entry must be used by exactly one UPDATE in that file, naming
 * that key, and guarded so a replay never overrides an admin's later choice
 * (NOT EXISTS an admin_audit_log row for the switch).
 *   - come_back_emails: owner 2026-10-21 (Q2299, issue #3498), "turn it ON as
 *     written", asked for as a migration through the lead.
 *   - confirm_reminders, scanner_safe_confirm_links: owner 2026-10-25 (pop-up,
 *     through the lead): the checkout reminder, confirm-email reminders,
 *     payout setup at hire and card hold at post "are not features. they
 *     should be done always for everyone."
 *   - card_hold_at_post: the same owner words (2026-10-25); its code landed
 *     dark first (lead 2026-10-27) and this flip follows once the card-hold
 *     edge functions' deploy is verified and a real walkthrough has run.
 */
export const OWNER_APPROVED_GO_LIVE: Readonly<Record<string, string>> = {
  "20261021135921_come_back_emails_on_for_everyone.sql": "come_back_emails",
  "20261025235208_confirm_reminders_on_for_everyone.sql": "confirm_reminders",
  "20261025235210_scanner_safe_confirm_links_on_for_everyone.sql": "scanner_safe_confirm_links",
  // card_hold_at_post: owner 2026-10-25 (pop-up, through the lead): "are not features. they should be done always for everyone."
  // Split from the dark landing by the lead 2026-10-27: lands after the card-hold functions' deploy is verified and a real walkthrough.
  "20261027185147_card_hold_at_post_on_for_everyone.sql": "card_hold_at_post",
};

export function readRegistryFromMigrations(
  dir = MIG_DIR,
  approved: Readonly<Record<string, string>> = OWNER_APPROVED_GO_LIVE,
): { keys: Set<string>; problems: InsertFinding[]; inserts: number; goLiveUsed: string[] } {
  const keys = new Set<string>();
  const problems: InsertFinding[] = [];
  const goLiveUsed: string[] = [];
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
      if (!/'everyone'/i.test(m[1])) continue;
      const key = approved[file];
      const namesKey = key !== undefined && new RegExp(`\\bWHERE\\s+key\\s*=\\s*'${key}'`, "i").test(m[1]);
      const guarded = key !== undefined
        && new RegExp(`NOT\\s+EXISTS\\s*\\([\\s\\S]*admin_audit_log[\\s\\S]*target_id\\s*=\\s*'${key}'`, "i").test(m[1]);
      if (namesKey && guarded && !goLiveUsed.includes(file)) goLiveUsed.push(file);
      else problems.push({ file, problem: "a migration UPDATEs a switch to 'everyone'; going live is an admin's audited flip" });
    }
    for (const m of sql.matchAll(/DELETE\s+FROM\s+(?:public\.)?feature_switches\s+WHERE\s+key\s*(?:=\s*('(?:[^']|'')*')|IN\s*\(([^)]*)\))/gi)) {
      const list = m[1] ? [m[1]] : splitTop(m[2], ",");
      for (const v of list) { const k = literal(v); if (k) keys.delete(k); }
    }
  }
  return { keys, problems, inserts, goLiveUsed };
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

/** Keys a migration (comments blanked) reads with feature_enabled_for_user('<key>', ...). */
/**
 * Keys read by feature_enabled_for_user('<key>', ...) in the function bodies
 * the database RUNS: the newest definition of each function
 * (effectiveDefs), not every copy a later migration replaced (the come-back
 * claim is restated by 20261021135832).
 */
function readServerSwitchReads(dir = MIG_DIR): Set<string> {
  const keys = new Set<string>();
  for (const def of effectiveDefs(dir).values()) {
    const body = blankSqlComments(def.stmt);
    for (const m of body.matchAll(/feature_enabled_for_user\s*\(\s*'([a-z][a-z0-9_]*)'/gi)) keys.add(m[1]);
  }
  return keys;
}

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

  it("(a) the owner-approved go-live migrations are exactly the listed ones, each used once", () => {
    expect(Object.keys(OWNER_APPROVED_GO_LIVE).length).toBeGreaterThan(0);
    expect(sorted(reg.goLiveUsed)).toEqual(sorted(Object.keys(OWNER_APPROVED_GO_LIVE)));
  });

  it("(b) every useFeature argument is a string literal", () => {
    expect(used.nonLiteral).toEqual([]);
  });

  it("(b) migrations' registry == FEATURE_SWITCH_KEYS == keys read by useFeature + server-only keys (exact both ways)", () => {
    expect(sorted(FEATURE_SWITCH_KEYS)).toEqual(sorted(reg.keys));
    const serverOnly = new Set<string>(SERVER_ONLY_FEATURE_SWITCH_KEYS);
    expect(sorted(used.keys)).toEqual(sorted([...reg.keys].filter((k) => !serverOnly.has(k))));
  });

  it("(c) a server-only switch is read by no useFeature and by a migration's feature_enabled_for_user", () => {
    const sqlReads = readServerSwitchReads();
    expect(SERVER_ONLY_FEATURE_SWITCH_KEYS.length).toBeGreaterThan(0);
    for (const key of SERVER_ONLY_FEATURE_SWITCH_KEYS) {
      expect(reg.keys.has(key), `${key} is created by a migration`).toBe(true);
      expect(used.keys.has(key), `${key} is server-only but read by useFeature`).toBe(false);
      expect(sqlReads.has(key), `${key} is server-only but no migration reads feature_enabled_for_user('${key}', ...)`).toBe(true);
    }
  });

  it("an approved go-live must name its key and keep the replay guard (synthetic)", () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fs-live-"));
    fs.writeFileSync(path.join(tmp, "1_ok.sql"),
      "UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'k1' AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.target_id = 'k1');\n");
    fs.writeFileSync(path.join(tmp, "2_unguarded.sql"),
      "UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'k2';\n");
    fs.writeFileSync(path.join(tmp, "3_other_key.sql"),
      "UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'k9' AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.target_id = 'k9');\n");
    const r = readRegistryFromMigrations(tmp, { "1_ok.sql": "k1", "2_unguarded.sql": "k2", "3_other_key.sql": "k3" });
    fs.rmSync(tmp, { recursive: true });
    expect(r.goLiveUsed).toEqual(["1_ok.sql"]);
    expect(r.problems.map((p) => p.file)).toEqual(["2_unguarded.sql", "3_other_key.sql"]);
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
