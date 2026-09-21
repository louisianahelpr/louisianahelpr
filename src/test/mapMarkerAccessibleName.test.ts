/**
 * EVERY MAP MARKER WITH A COMMAND ROLE HAS AN ACCESSIBLE NAME.
 *
 * The a11y-prod sweep flagged `.tracking-helper-pin` (TrackingMap.tsx) for
 * `aria-command-name`: Leaflet gives every marker `role="button"` +
 * `tabIndex=0` by default (`Marker.js`'s `_initIcon`: `if (options.keyboard)
 * { icon.tabIndex = '0'; icon.setAttribute('role', 'button'); }`), and a
 * `divIcon` marker's DOM node is a `<div>`, not an `<img>` — so Leaflet's own
 * `if (icon.tagName === 'IMG') icon.alt = options.alt` never fires and
 * `<Marker alt="...">` silently does nothing. The marker stayed an unlabelled
 * command in the tab order even though a comment right next to it already
 * explained the problem — a fix that read correctly but changed nothing.
 *
 * This test derives its OWN inventory of "this element gets a command role"
 * constructs from source (it doesn't trust a hand-maintained list), and
 * proves every one of them also carries a real accessible name:
 *
 *   1. `divIcon(...)` — Leaflet always turns this into a focusable
 *      `role="button"` node, so the call must be wrapped by a
 *      `*AccessibleName(...)` helper in the same function (see
 *      `withAccessibleName` in TrackingMap.tsx).
 *   2. `el.setAttribute("role", "button" | "link")` — the manual pattern
 *      BrowseMap's `mapMarkers.ts` uses for its MapKit annotation elements
 *      (`wireButtonBehaviour`) — the same function must also set
 *      `aria-label`.
 *   3. A raw JSX `role="button" | "link"` on a map-marker element — the same
 *      tag must also carry `aria-label=`.
 *
 * The two "canary" tests below reproduce the exact shape of the original bug
 * and its fix as inline fixtures (not a git-history read, which would stop
 * proving anything the moment this fix is committed) — proving the checker
 * itself can fail before trusting it to certify the real tree.
 *
 * Shown able to fail against the REAL tree 2026-09-20 (the canaries above only
 * ever proved the checker, never that it is pointed at anything): deleting
 * `el.setAttribute("aria-label", label)` from `wireButtonBehaviour` turns
 * "src/ map components have none" red naming mapMarkers.ts.
 *
 * @mutate src/components/browseMap/mapMarkers.ts |   el.setAttribute("aria-label", label);\n |
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function mapFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    // Scope to the map surface, not every file that happens to say "role" or
    // "button" — matches TrackingMap.tsx, browseMap/mapMarkers.ts, and any
    // future sibling (BrowseMap.tsx, a new *Map.tsx, etc).
    .filter((f) => /map/i.test(f));
}

/** The innermost `{ ... }` block that textually encloses `idx` — used to find
 *  "the function this call lives in" without pulling in a real parser. */
function enclosingBlock(src: string, idx: number): string {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return src;
  let d = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") {
      d--;
      if (d === 0) return src.slice(start, j + 1);
    }
  }
  return src.slice(start);
}

interface Offender {
  kind: string;
  snippet: string;
}

// Comments routinely quote the exact patterns this test looks for (this file
// and TrackingMap.tsx both explain the bug in prose right next to the fix) —
// strip them first so an explanation isn't mistaken for an offense.
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every site that hands a map marker a command role, labelled or not — the
 *  CONSTRUCT inventory, as opposed to the file list. Floored below: a file list
 *  stays non-empty even after every construct in it has gone. */
function commandRoleSites(rawSrc: string): number {
  const src = stripComments(rawSrc);
  return (
    [...src.matchAll(/\bdivIcon\s*\(/g)].length +
    [...src.matchAll(/\.setAttribute\(\s*["'`]role["'`]\s*,\s*["'`](button|link)["'`]/g)].length +
    [...src.matchAll(/\brole=(["'])(button|link)\1/g)].length
  );
}

/**
 * Scans `src` for every construct that hands a map marker a command role,
 * and returns the ones with no accessible name attached.
 */
function findUnlabeledCommandMarkers(rawSrc: string): Offender[] {
  const src = stripComments(rawSrc);
  const out: Offender[] = [];

  // 1. Leaflet `divIcon(...)` — always becomes a focusable role="button" node.
  for (const m of src.matchAll(/\bdivIcon\s*\(/g)) {
    const body = enclosingBlock(src, m.index!);
    if (!/\b\w*AccessibleName\s*\(/.test(body)) {
      out.push({ kind: "divIcon", snippet: src.slice(Math.max(0, m.index! - 10), m.index! + 40).replace(/\s+/g, " ") });
    }
  }

  // 2. Manual `el.setAttribute("role", "button" | "link")`.
  for (const m of src.matchAll(/\.setAttribute\(\s*["'`]role["'`]\s*,\s*["'`](button|link)["'`]/g)) {
    const body = enclosingBlock(src, m.index!);
    if (!/\.setAttribute\(\s*["'`]aria-label["'`]/.test(body)) {
      out.push({ kind: "setAttribute(role)", snippet: src.slice(Math.max(0, m.index! - 10), m.index! + 60).replace(/\s+/g, " ") });
    }
  }

  // 3. Raw JSX `role="button" | "link"`.
  for (const m of src.matchAll(/\brole=(["'])(button|link)\1/g)) {
    const tagStart = src.lastIndexOf("<", m.index!);
    const tagEnd = src.indexOf(">", m.index!);
    const tag = tagStart >= 0 && tagEnd > tagStart ? src.slice(tagStart, tagEnd + 1) : "";
    if (!/\baria-label=/.test(tag)) {
      out.push({ kind: "jsx role", snippet: tag.replace(/\s+/g, " ").slice(0, 80) });
    }
  }

  return out;
}

describe("map markers with a command role have an accessible name", () => {
  // --- Canary: prove the checker can fail, using the exact shape of the
  // original bug (a `divIcon` marker with only a no-op `<Marker alt="...">`,
  // which Leaflet never applies to a <div> icon) ---
  it("flags the original TrackingMap bug shape (divIcon, no wrapper)", () => {
    const buggy = `
      function helperIcon() {
        return divIcon({ className: "tracking-helper-pin", html });
      }
      // <Marker icon={helperIcon()} alt="Your Helpr's current location" />
      // — alt is silently dropped: Leaflet only sets it on <img> icons.
    `;
    const offenders = findUnlabeledCommandMarkers(buggy);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("divIcon");
  });

  it("flags a MapKit-style element with role=button but no aria-label", () => {
    const buggy = `
      function pinElement() {
        const el = document.createElement("div");
        el.setAttribute("role", "button");
        el.tabIndex = 0;
        return el;
      }
    `;
    expect(findUnlabeledCommandMarkers(buggy)).toHaveLength(1);
  });

  it("flags a bare JSX role=button with no aria-label", () => {
    const buggy = `const x = <div role="button" onClick={go}>Go</div>;`;
    expect(findUnlabeledCommandMarkers(buggy)).toHaveLength(1);
  });

  // --- Canary: the same shapes, fixed, must NOT be flagged ---
  it("does not flag a divIcon wrapped in an *AccessibleName helper", () => {
    const fixed = `
      function helperIcon() {
        return withAccessibleName(
          divIcon({ className: "tracking-helper-pin", html }),
          "Your Helpr's current location",
        );
      }
    `;
    expect(findUnlabeledCommandMarkers(fixed)).toEqual([]);
  });

  it("does not flag setAttribute(role) paired with setAttribute(aria-label)", () => {
    const fixed = `
      function wireButtonBehaviour(el, label) {
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", label);
      }
    `;
    expect(findUnlabeledCommandMarkers(fixed)).toEqual([]);
  });

  it("does not flag JSX role=button with aria-label on the same tag", () => {
    const fixed = `const x = <div role="button" aria-label="Go" onClick={go}>Go</div>;`;
    expect(findUnlabeledCommandMarkers(fixed)).toEqual([]);
  });

  // --- The real gate: every map component file in the repo, right now ---
  it("covers at least the known map-marker files (inventory isn't empty)", () => {
    const files = mapFiles();
    expect(files).toEqual(
      expect.arrayContaining(["src/components/TrackingMap.tsx", "src/components/browseMap/mapMarkers.ts"]),
    );
    // …and the CONSTRUCT inventory is floored, not just the file list. Since
    // the Leaflet→MapKit port there is no live `divIcon(` call and no raw JSX
    // role="button" left on the map surface (both survive only in prose, which
    // stripComments removes), so `wireButtonBehaviour`'s
    // setAttribute("role","button") in mapMarkers.ts is the ONLY site this
    // guard actually grades. A file list alone would stay green after that one
    // went too — exactly the empty-inventory shape.
    const sites = files.reduce((n, f) => n + commandRoleSites(readFileSync(resolve(ROOT, f), "utf8")), 0);
    expect(sites, "no command-role map-marker construct found at all — this guard would be grading nothing").toBeGreaterThan(0);
  });

  it("src/ map components have none", () => {
    const hits: string[] = [];
    for (const f of mapFiles()) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      for (const o of findUnlabeledCommandMarkers(src)) {
        hits.push(`${f} [${o.kind}]: ${o.snippet}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
