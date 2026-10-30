/*
 * CLASS GUARD (owner request via the lead, 2026-10-30): members never see the word "Claude". The listing helper,
 * the bunch sorter and the suggested replies said "Claude wrote your listing", "Claude is sorting your photos…",
 * "Fix anything Claude got wrong"; they now say "we" ("We wrote your listing", "We're sorting your photos…").
 *
 * Inventory from source: every .ts/.tsx/.json file under src/ and supabase/functions/ (tests and src/test/ left
 * out), comments blanked with the shared blankComments. An offender is the word "Claude" (case-sensitive, whole
 * word, so identifiers like ClaudeImage and claudeFetch do not count) anywhere in what is left: JSX text, string
 * and template literals, toasts, notices, emails, i18n JSON. Developer log lines (console.*) are the one exception.
 */
// @mutate src/components/declutter/SellAiDraft.tsx | We're writing your listing… | Claude is writing your listing…
// @mutate src/components/declutter/DeclutterBunchView.tsx | Fix anything we got wrong. | Fix anything Claude got wrong.
// @mutate src/lib/declutter/errors.ts | We couldn't read those photos. | Claude couldn't read those photos.
// @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Anthropic</strong> | <strong className="text-foreground">Anthropic (Claude)</strong>
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { readSource, walkSource } from "@/test/helpers/walkSource";

const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes("/src/test/") || f.startsWith("src/test/");

function offenders(): { files: number; hits: string[] } {
  const files = walkSource(["src", "supabase/functions"], [".ts", ".tsx", ".json"]).filter((f) => !isTest(f));
  const hits: string[] = [];
  for (const file of files) {
    const raw = readSource(file);
    if (raw === null) continue;
    const code = file.endsWith(".json") ? raw : blankComments(raw);
    code.split("\n").forEach((line, i) => {
      if (!/\bClaude\b/.test(line)) return;
      if (/\bconsole\.(log|info|warn|error|debug)\(/.test(line)) return;
      hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return { files: files.length, hits };
}

describe('members never see "Claude"', () => {
  it("no member-facing string in src/ or supabase/functions/ says Claude", () => {
    const { files, hits } = offenders();
    expect(files).toBeGreaterThan(1000);
    expect(hits).toEqual([]);
  });
});
