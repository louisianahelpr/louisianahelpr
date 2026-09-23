/**
 * STORED ERROR TEXT IS RENDERED INSIDE `data-quoted-log` (Q101).
 *
 * /admin?view=health lists open ops_alert_ledger items, and on 2026-09-22 one
 * was titled "Error screen shown: We couldn't load your account." (4 rows,
 * 15:10Z). The one shared error-screen detector (e2e/errorScreens.ts) matched
 * that title in body text, so `explore: admin-health` failed "broken before
 * any input" and admin-views.spec.ts read the same way: the page was reporting
 * an error elsewhere, not failing itself.
 *
 * The fix has two halves and this file holds both:
 *   1. every screen that renders error_logs / ops_alert_ledger /
 *      ops_alert_pending rows wraps that text in an element carrying
 *      `data-quoted-log` (findErrorScreen drops those spans);
 *   2. every harness that runs findErrorScreen against a page reads it with
 *      `readScreenText`, which is what returns the spans to drop.
 *
 * The inventory is built from src/, not a hand list: every non-test file that
 * SELECTs from one of those tables, the hooks it exports, the components that
 * call those hooks, and every render of the hook's data in them. A new reader
 * whose data reaches JSX unmarked fails here.
 *
 * @mutate src/components/admin/AdminHealth.tsx | {openAlerts.map((c) => (\n              <CheckRow key={c.id} check={c} quoted /> | {openAlerts.map((c) => (\n              <CheckRow key={c.id} check={c} />
 * @mutate src/components/admin/AdminHealth.tsx | data-quoted-log={quoted ? "" : undefined} |
 * @mutate e2e/prod-audit/harness.ts | const screen = await page.evaluate(readScreenText).catch(() => ({ text: "", quoted: [] as string[] })); | const screen = await page.evaluate(() => document.body.innerText).catch(() => "");
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const LOG_TABLES = ["error_logs", "ops_alert_ledger", "ops_alert_pending"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC).filter((f) => !f.includes(`${join("integrations", "supabase")}`));
const code = new Map(files.map((f) => [f, blankComments(readFileSync(f, "utf8"))]));
const rel = (f: string) => relative(ROOT, f);

const READ_RE = new RegExp(`\\.from\\(\\s*["'](${LOG_TABLES.join("|")})["']\\s*\\)\\s*\\.select\\(`);
const readers = files.filter((f) => READ_RE.test(code.get(f)!));

const hooksOf = (f: string) =>
  [...code.get(f)!.matchAll(/export\s+(?:const|function)\s+(use[A-Z]\w*)/g)].map((m) => m[1]);

/** Every render of `v` in `src`, minus the uses that cannot put its text on screen. */
function unmarkedUses(src: string, v: string): string[] {
  const bad: string[] = [];
  const re = new RegExp(`\\b${v}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    const after = src.slice(m.index + v.length, m.index + v.length + 400);
    if (/data:\s*$/.test(before)) continue; // the binding itself
    if (/!\s*$/.test(before)) continue; // `!v`
    if (/^\.length\b/.test(after)) continue; // `v.length`
    if (/^\.map\(/.test(after)) {
      // The map body up to the element it returns must mark the element:
      // a `quoted` prop, or the attribute itself.
      const end = after.indexOf("/>");
      const body = after.slice(0, end < 0 ? 200 : end + 2);
      const comp = /<([A-Z]\w*)/.exec(body)?.[1];
      if (/data-quoted-log/.test(body)) continue;
      if (comp && /\squoted\b/.test(body)) {
        const def = new RegExp(`const\\s+${comp}\\s*=[\\s\\S]*?data-quoted-log=\\{\\s*quoted\\b`).exec(src);
        if (def) continue;
        bad.push(`${v}.map renders <${comp} quoted> but ${comp} does not put data-quoted-log={quoted…} on its element`);
        continue;
      }
      bad.push(`${v}.map renders ${comp ? `<${comp}>` : "an element"} without a quoted prop / data-quoted-log`);
      continue;
    }
    bad.push(`unrecognised use of ${v}: …${(before + v + after).slice(0, 80).replace(/\s+/g, " ")}…`);
  }
  return bad;
}

describe("stored error text is marked data-quoted-log where it renders (Q101)", () => {
  it("every renderer of error_logs / ops_alert_ledger rows marks the text", () => {
    // Floor: useOpenAlerts (ops_alert_ledger) and useCronHealth (error_logs)
    // on 2026-09-23. A scan that finds none has lost its inventory.
    expect(readers.length, readers.map(rel).join(", ")).toBeGreaterThan(1);

    const problems: string[] = [];
    let rendersChecked = 0;
    for (const reader of readers) {
      const hooks = hooksOf(reader);
      if (!hooks.length) {
        problems.push(`${rel(reader)} reads ${LOG_TABLES.join("/")} but exports no use* hook this guard can follow`);
        continue;
      }
      for (const hook of hooks) {
        const consumers = files.filter((f) => f !== reader && f.endsWith(".tsx") && new RegExp(`\\b${hook}\\(`).test(code.get(f)!));
        if (!consumers.length) problems.push(`${hook} (${rel(reader)}) has no .tsx consumer; nothing to check`);
        for (const c of consumers) {
          const src = code.get(c)!;
          const bind = new RegExp(`const\\s+\\{\\s*data\\s*:\\s*(\\w+)\\s*\\}\\s*=\\s*${hook}\\(`).exec(src);
          if (!bind) {
            problems.push(`${rel(c)} calls ${hook}() without \`const { data: x } = ${hook}()\`; extend this guard to follow it`);
            continue;
          }
          const uses = unmarkedUses(src, bind[1]);
          rendersChecked++;
          problems.push(...uses.map((u) => `${rel(c)} (${hook}): ${u}`));
        }
      }
    }
    expect(rendersChecked).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });

  it("every harness that runs findErrorScreen on a page reads it with readScreenText", () => {
    const harnessFiles = [...walkAll(join(ROOT, "e2e")), ...walkAll(join(ROOT, "scripts"))].filter(
      (f) => !f.endsWith(join("e2e", "errorScreens.ts")),
    );
    const callers = harnessFiles.filter((f) => /\bfindErrorScreen\(/.test(blankComments(readFileSync(f, "utf8"))));
    // Floor: sweepCore, admin-views.spec, prod-audit harness, journeys fixtures.
    expect(callers.length, callers.map(rel).join(", ")).toBeGreaterThan(3);
    // The call, not the import: `page.evaluate(readScreenText)`.
    const unmarked = callers.filter((f) => !/\.evaluate\(\s*readScreenText\s*\)/.test(blankComments(readFileSync(f, "utf8"))));
    expect(unmarked.map(rel)).toEqual([]);

    // press-every-control tests ERROR_BOUNDARY_RX against its own snapshot text.
    const pec = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(pec).toMatch(/screenErrorText\(await page\.evaluate\(SNAPSHOT/);
    expect(pec).toMatch(/\[data-quoted-log\]/);
  });
});

function walkAll(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
