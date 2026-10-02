/**
 * NB-017 / Q82 class guard: a once-per-process setup run from a React effect
 * must not be cancellable by that effect's cleanup.
 *
 * The defect: `useNativePushSetup` set a module-level `listenersAttached = true`
 * and then awaited plugin imports, with deps `[navigate]` and a cleanup that set
 * `cancelled = true`. react-router 7 changes `navigate` on every pathname
 * change, and a native cold launch at "/" is redirected at once by
 * NativeLaunchRouter. So the cleanup cancelled the in-flight setup, the re-run
 * hit `listenersAttached` and returned, and the process had no appUrlOpen
 * listener (helpr:/// Stripe returns, Universal Links) and never called push
 * register(). Silent: no error, no log. Fixed in b282c421b (NAVIGATE_REF, deps
 * []) and 069198e98 (deep links on their own chain).
 *
 * The class, from source: every useEffect / useLayoutEffect in src/ whose body
 * sets a module-level `let X = false` flag to true is a once-flagged setup. For
 * each one:
 *   1. its cleanup may not set a cancel flag (`<name> = true`) unless it also
 *      resets the once flag to false (which re-opens the re-run);
 *   2. its deps must be `[]` — the flag already blocks every re-run, so a dep
 *      only means a stale capture or a cancelling cleanup.
 *
 * RED proofs (each run against this file):
 */
// @mutate src/lib/nativePush.ts | // No cleanup: the listeners are process-lifetime (listenersAttached), and | return () => { cancelled = true; }; // No cleanup
// @mutate src/lib/nativePush.ts | }, []); // setup-once: see NAVIGATE_REF note | }, [navigate]); // setup-once
import { describe, it, expect } from "vitest";
import { relative, resolve } from "node:path";
import { blankNonCode } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes(`${"/"}src/test/`);

/** Index of the bracket that closes the one at `open`, on blanked text. */
function matchClose(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c in pairs) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

type Effect = { file: string; line: number; flags: string[]; cleanup: string | null; deps: string | null };

function scan() {
  let effectsScanned = 0;
  const onceEffects: Effect[] = [];
  for (const file of walkSource([SRC])) {
    if (isTest(file)) continue;
    const raw = readSource(file);
    if (raw === null) continue;
    const code = blankNonCode(raw);
    const flags = [...code.matchAll(/^let\s+([A-Za-z_$][\w$]*)\s*=\s*false\s*;/gm)].map((m) => m[1]);
    for (const m of code.matchAll(/\buse(?:Layout)?Effect\s*\(/g)) {
      const open = m.index! + m[0].length - 1;
      const close = matchClose(code, open);
      if (close < 0) continue;
      effectsScanned++;
      const call = code.slice(open + 1, close);
      const set = flags.filter((f) => new RegExp(`\\b${f}\\s*=\\s*true\\b`).test(call));
      if (set.length === 0) continue;
      // deps: the trailing top-level array argument, if any.
      const depsMatch = /,\s*(\[[^\]]*\])\s*,?\s*$/.exec(call);
      // cleanup: a returned function inside the callback.
      const ret = /\breturn\s*(?:\(\s*\)\s*=>|function\s*\()/.exec(call);
      let cleanup: string | null = null;
      if (ret) {
        const braceAt = call.indexOf("{", ret.index + ret[0].length);
        const end = braceAt >= 0 ? matchClose(call, braceAt) : -1;
        cleanup = end > 0 ? call.slice(ret.index, end + 1) : call.slice(ret.index);
      }
      onceEffects.push({
        file: relative(ROOT, file),
        line: code.slice(0, m.index).split("\n").length,
        flags: set,
        cleanup,
        deps: depsMatch ? depsMatch[1].replace(/\s+/g, "") : null,
      });
    }
  }
  return { effectsScanned, onceEffects };
}

describe("once-per-process effect setups cannot be cancelled (NB-017 / Q82)", () => {
  const { effectsScanned, onceEffects } = scan();

  it("scans the app's effects and finds the native push/deep-link setup", () => {
    expect(effectsScanned).toBeGreaterThan(50);
    expect(onceEffects.length).toBeGreaterThan(0);
    expect(onceEffects.some((e) => e.file === "src/lib/nativePush.ts" && e.flags.includes("listenersAttached"))).toBe(
      true,
    );
  });

  it("no once-flagged effect has a cleanup that cancels it without re-opening the flag", () => {
    const offenders = onceEffects
      .filter((e) => {
        if (!e.cleanup) return false;
        const cancels = /\b[A-Za-z_$][\w$]*\s*=\s*true\b/.test(e.cleanup);
        const reopens = e.flags.some((f) => new RegExp(`\\b${f}\\s*=\\s*false\\b`).test(e.cleanup!));
        return cancels && !reopens;
      })
      .map((e) => `${e.file}:${e.line} sets ${e.flags.join(",")} and its cleanup cancels the in-flight setup`);
    expect(offenders).toEqual([]);
  });

  it("every once-flagged effect has [] deps", () => {
    const offenders = onceEffects
      .filter((e) => e.deps !== "[]")
      .map((e) => `${e.file}:${e.line} sets ${e.flags.join(",")} with deps ${e.deps ?? "(none)"}`);
    expect(offenders).toEqual([]);
  });
});
