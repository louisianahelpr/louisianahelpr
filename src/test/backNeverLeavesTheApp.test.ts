/**
 * L005 (landing audit 11-09): the back arrow on /helprs and /search ran a bare navigate(-1), so a page opened from a
 * link or a new tab went to about:blank (/hire and the item page fall back correctly). The class, from source: every
 * navigate(-1) in shipped code (comments blanked) asks hasInAppHistory() on the same line first, or is in
 * GUARDED_OTHERWISE with how it knows an in-app entry is behind it. Exact both ways.
 *
 * @mutate src/pages/search/SearchPage.tsx | onBack={() => (hasInAppHistory() ? navigate(-1) : navigate("/", { replace: true }))} | onBack={() => navigate(-1)}
 * @mutate src/pages/helprs/FindHelprs.tsx | onBack={() => (hasInAppHistory() ? navigate(-1) : navigate("/", { replace: true }))} | onBack={() => navigate(-1)}
 */
import { describe, expect, it } from "vitest";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");

/** navigate(-1) sites that know an in-app entry is behind them some other way. */
const GUARDED_OTHERWISE: Record<string, string> = {
  "src/pages/messages/Messages.tsx": "closeThread pops only an entry it pushed itself (isThreadOpenEntry(location.state))",
};

describe("L005: back never walks out of the app", () => {
  it("every navigate(-1) asks hasInAppHistory() first, or is listed with its own guard", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const bad: string[] = [];
    const hit = new Set<string>();
    let sites = 0;
    for (const f of files) {
      const rel = relative(REPO, f).split("\\").join("/");
      const lines = blankComments(readSource(f) ?? "").split("\n");
      lines.forEach((line, i) => {
        if (!/\bnavigate\(\s*-1\s*\)/.test(line)) return;
        sites++;
        if (/\bhasInAppHistory\(/.test(line)) return;
        if (rel in GUARDED_OTHERWISE) { hit.add(rel); return; }
        bad.push(`${rel}:${i + 1}: navigate(-1) without hasInAppHistory()`);
      });
    }
    expect(sites).toBeGreaterThan(1);
    expect(bad, bad.join("\n")).toEqual([]);
    expect([...hit].sort(), "GUARDED_OTHERWISE has an entry nobody hits").toEqual(Object.keys(GUARDED_OTHERWISE).sort());
  });
});
