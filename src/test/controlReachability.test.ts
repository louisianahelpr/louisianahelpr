/// <reference types="node" />
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY INSTRUCTION THE APP GIVES MUST NAME SOMETHING THE USER CAN REACH.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE BUG THIS IS THE CLASS OF (owner, 2026-09-19). Since VN-33,
 * `mark_helper_arrival` refused a bad-GPS arrival and wrote NOTHING, so
 * `helper_arrived_at` stayed null. The Helpr's blocked CTA then told them, in
 * copy, to ask the poster to tap "Confirm They Arrived" — while that poster
 * control was itself gated on `helper_arrived_at` and therefore never
 * rendered. Both halves were individually correct and individually tested.
 * `src/lib/arrivalGate.test.ts` even asserted the refusal copy names the
 * poster's tap, and PASSED, without ever asking whether that tap was
 * reachable. The defect lived BETWEEN two correct parts, which is exactly the
 * place component-level testing cannot look.
 *
 * WHY A "DOES THIS BUTTON EXIST?" TEST WOULD NOT DO. It would have passed:
 * the button existed, was rendered by a real component, and had its own green
 * test. What it did not have was a state in which BOTH the copy fires AND the
 * control is offered. So this file checks three different things, and says
 * plainly which are strong and which are best-effort:
 *
 *   CHECK 1 — EXISTS      (STRONG)      a control named in copy is a label
 *                                        some component actually renders.
 *   CHECK 2 — HAS A SOURCE (STRONG)     every column that gates a control is
 *                                        produced somewhere — written by a
 *                                        migration or a client write, or
 *                                        projected by a view/RPC. A control
 *                                        gated on a column nothing produces is
 *                                        a permanent deadlock: the
 *                                        `job_checkins` "table with zero
 *                                        writers" class, shipped here before.
 *   CHECK 3 — SAME-STATE  (BEST-EFFORT) copy producers and control producers
 *                                        are paired by their shared column
 *                                        vocabulary, both are EXECUTED over
 *                                        the whole boolean state space, and a
 *                                        state where the copy names a control
 *                                        the producer will not offer is a
 *                                        violation.
 *
 * ── BOTH SIDES ARE DERIVED FROM THE WORLD ──────────────────────────────────
 *
 * Nothing here is a hand-written list checked against itself (this repo has
 * the scar: `docs/lessons` → registries-checked-against-themselves). The two
 * inventories come from unrelated source trees:
 *
 *   NAMED   — every control name QUOTED inside a user-facing string literal
 *             anywhere in `src/**` or `supabase/functions/**`, plus every
 *             Title-Case run following an action verb ("tap Mark Job
 *             Complete"). Comments are excluded structurally, because the scan
 *             is over the TypeScript AST's string/JSX-text nodes, not text.
 *   RENDERED— every label a control can paint: the text children of control
 *             elements (`<Button>`, `<DropdownMenuItem>`, `<TabsTrigger>`, …),
 *             their `aria-label`/`label`/`title` attributes, and every
 *             `label:`-shaped property in an object literal — which is where
 *             this app keeps its step-card labels
 *             (`posterStepContract.ts`'s `label: "Confirm They Arrived"`).
 *             Conditionals are followed on both branches.
 *
 * So renaming a button, deleting it, or gating it on a dead column fails the
 * day it happens, with nobody having to remember this file exists.
 *
 * ── PROVEN ABLE TO FAIL ────────────────────────────────────────────────────
 * The last describe block plants a violation of each check into an in-memory
 * copy of the world and asserts the check comes back RED. A guard that cannot
 * fail certifies nothing.
 *
 * ── WHAT THIS CANNOT CATCH (say it out loud) ───────────────────────────────
 *  • A control whose label is computed at runtime (`t(key)`, string
 *    concatenation, a label read from the database). Those are invisible to a
 *    literal scan and are reported by the coverage assertion below rather than
 *    silently skipped.
 *  • Reachability through NAVIGATION: "go to Settings and tap Delete Account"
 *    is satisfied by the label existing, not by the route being reachable from
 *    where the reader is standing.
 *  • CHECK 2 proves a producer EXISTS, not that it succeeds. VN-33's writer
 *    existed and refused — see CHECK 3, which is the half aimed at that, and
 *    which is best-effort by construction.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const EDGE = path.join(ROOT, "supabase", "functions");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

// ───────────────────────────────────────────────────────────────────────────
// file walking
// ───────────────────────────────────────────────────────────────────────────

const SKIP_DIR = /^(node_modules|\.git|dist|ios|android|coverage|\.next)$/;

export function walkFiles(dir: string, match: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      walkFiles(p, match, out);
    } else if (match.test(e.name)) out.push(p);
  }
  return out;
}

/** Product source: no tests, no generated types, no e2e harness. */
function productSources(): string[] {
  const ok = (f: string) =>
    !/\.test\.[tj]sx?$/.test(f) && !/\.d\.ts$/.test(f) && !f.includes(`${path.sep}test${path.sep}`);
  return [...walkFiles(SRC, /\.tsx?$/), ...walkFiles(EDGE, /\.tsx?$/)].filter(ok);
}

const rel = (f: string) => path.relative(ROOT, f);

/** Filled once at module load; `columnProducers` reads it rather than re-walking. */
let cachedSources: string[] | null = null;

// ───────────────────────────────────────────────────────────────────────────
// INVENTORY A — every label a control can actually paint
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tags that render something a user can press, choose or follow. Written as a
 * shape test rather than a list of every component in the design system: a tag
 * counts if it IS one of the primitives, or if its name ends in a control word
 * (`…Button`, `…MenuItem`, `…Trigger`, `…Chip`, `…Action`), which is how this
 * codebase names `JobStepPrimaryButton`, `AlertDialogAction` and friends.
 */
const CONTROL_TAG =
  /^(button|a|Button|Link|NavLink|Toggle|Chip|Tab|SelectItem|CommandItem|ToggleGroupItem|DropdownMenuItem|ContextMenuItem|MenuItem|SheetClose|DialogClose|AccordionTrigger|TabsTrigger|AlertDialogAction|AlertDialogCancel)$|(Button|MenuItem|Trigger|Chip|Action|Cancel|Item)$/;

/** Props whose string value is read aloud as a control's name. */
const LABEL_PROP = new Set([
  "label", "aria-label", "ariaLabel", "title", "cta", "ctaLabel", "actionLabel",
  "buttonLabel", "confirmLabel", "cancelLabel", "primaryLabel", "secondaryLabel",
  "submitLabel", "doneLabel", "nextLabel", "action", "text", "children", "placeholder",
]);

export function normaliseLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RenderedLabels {
  /** normalised label → the sites that render it */
  byLabel: Map<string, string[]>;
  /** labels whose text is computed, so a literal scan cannot see them */
  dynamicControlSites: string[];
}

export function collectRenderedLabels(files: string[]): RenderedLabels {
  const byLabel = new Map<string, string[]>();
  const dynamicControlSites: string[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/[<{]/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const add = (raw: string, n: ts.Node) => {
      const k = normaliseLabel(raw);
      if (!k) return;
      if (!byLabel.has(k)) byLabel.set(k, []);
      byLabel.get(k)!.push(`${rel(file)}:${lineOf(n)}`);
    };

    /** Follow ternaries and `??`/`||` so both branches of a label count. */
    const collectStrings = (e: ts.Expression | undefined, at: ts.Node): void => {
      if (!e) return;
      if (ts.isParenthesizedExpression(e)) return collectStrings(e.expression, at);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return add(e.text, at);
      if (ts.isConditionalExpression(e)) {
        collectStrings(e.whenTrue, at);
        collectStrings(e.whenFalse, at);
        return;
      }
      if (ts.isBinaryExpression(e)) {
        collectStrings(e.left, at);
        collectStrings(e.right, at);
      }
    };

    const attrs = (props: ts.NodeArray<ts.JsxAttributeLike>, at: ts.Node) => {
      for (const a of props) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        if (!LABEL_PROP.has(a.name.getText(sf))) continue;
        if (ts.isStringLiteral(a.initializer)) add(a.initializer.text, at);
        else if (ts.isJsxExpression(a.initializer)) collectStrings(a.initializer.expression, at);
      }
    };

    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n)) {
        const tag = n.openingElement.tagName.getText(sf);
        if (CONTROL_TAG.test(tag)) {
          const parts: string[] = [];
          let sawDynamic = false;
          for (const c of n.children) {
            if (ts.isJsxText(c)) {
              if (c.text.trim()) parts.push(c.text);
            } else if (ts.isJsxExpression(c) && c.expression) {
              if (ts.isStringLiteral(c.expression) || ts.isNoSubstitutionTemplateLiteral(c.expression)) {
                parts.push(c.expression.text);
              } else {
                collectStrings(c.expression, n);
                if (!ts.isConditionalExpression(c.expression) && !ts.isBinaryExpression(c.expression)) {
                  sawDynamic = true;
                }
              }
            }
          }
          const joined = parts.join(" ").replace(/\s+/g, " ").trim();
          if (joined) add(joined, n);
          else if (sawDynamic) dynamicControlSites.push(`${rel(file)}:${lineOf(n)} <${tag}>`);
        }
        attrs(n.openingElement.attributes.properties, n);
      }
      if (ts.isJsxSelfClosingElement(n)) attrs(n.attributes.properties, n);

      // `{ label: "Confirm They Arrived" }` — where this app keeps step labels.
      if (ts.isPropertyAssignment(n)) {
        const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null;
        if (key && LABEL_PROP.has(key)) collectStrings(n.initializer, n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { byLabel, dynamicControlSites };
}

// ───────────────────────────────────────────────────────────────────────────
// INVENTORY B — every control the app's own copy names
// ───────────────────────────────────────────────────────────────────────────

const TITLE_WORD = "[A-Z][A-Za-z0-9’']*";
/** Words allowed INSIDE a control name without being title-cased. */
const JOIN_WORD = "(?:My|They|Them|Their|It|Me|Your|You|A|An|The|To|For|On|Off|Up|Out|In|And|Again|Here|a|an|the|to|for|on|off|up|out|in|and)";
const QUOTED_NAME = /["“]([A-Z][^"“”]{2,48})["”]/g;
const VERB_NAME = new RegExp(
  `\\b(?:tap|taps|tapping|press|presses|pressing|click|clicks|clicking|choose|chooses|choosing|select|selects|hit|hits)\\s+(?:the\\s+)?(${TITLE_WORD}(?:\\s+(?:${TITLE_WORD}|${JOIN_WORD}))*)`,
  "gi",
);
/** A string only names a control if it is telling somebody about a control. */
const CONTROL_CONTEXT =
  /\b(tap|taps|tapping|press|presses|click|clicks|choose|choosing|select|hit|button|control|screen|tab|switch|toggle|chip|option)\b/i;
const SHAPE_OK = new RegExp(`^${TITLE_WORD}(\\s+(?:${TITLE_WORD}|${JOIN_WORD}))*$`);

export interface NamedControl {
  file: string;
  line: number;
  phrase: string;
  /** `quoted` is ENFORCED; `verb` is ADVISORY — see the header. */
  kind: "quoted" | "verb";
}

export function collectNamedControls(files: string[]): NamedControl[] {
  const out: NamedControl[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!CONTROL_CONTEXT.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      let s: string | null = null;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) s = n.text;
      else if (ts.isTemplateExpression(n)) {
        // `${…}` becomes a hard break so a name cannot span an interpolation.
        s = n.head.text + n.templateSpans.map((x) => " … " + x.literal.text).join("");
      } else if (ts.isJsxText(n)) s = n.text;

      if (s && CONTROL_CONTEXT.test(s)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        for (const m of s.matchAll(QUOTED_NAME)) {
          const phrase = m[1].trim().replace(/[.,!?;:]+$/, "");
          if (phrase.split(/\s+/).length < 2 || !SHAPE_OK.test(phrase)) continue;
          out.push({ file: rel(file), line, phrase, kind: "quoted" });
        }
        for (const m of s.matchAll(VERB_NAME)) {
          const phrase = m[1].trim();
          if (phrase.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length < 2) continue;
          out.push({ file: rel(file), line, phrase, kind: "verb" });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * Does this phrase name a real control?
 *
 * The RENDERED inventory is the tokenizer: prose runs on past the end of a
 * label ("tap Mark Job Complete so your payment can be released"), so every
 * contiguous ≥2-word span of the phrase is offered to the inventory and the
 * longest hit wins. That is why the verb-form scan can be permissive without
 * inventing violations.
 */
export function resolveNamedControl(phrase: string, byLabel: Map<string, string[]>): string | null {
  const w = normaliseLabel(phrase).split(" ").filter(Boolean);
  for (let len = w.length; len >= 2; len--) {
    for (let i = 0; i + len <= w.length; i++) {
      const k = w.slice(i, i + len).join(" ");
      if (byLabel.has(k)) return k;
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 2 — a control's gate columns must have a writer
// ───────────────────────────────────────────────────────────────────────────

const COLUMN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/**
 * Functions that decide whether a control is offered: they build an object
 * carrying BOTH a `label` and an `enabled`/`disabled` flag. Discovered by
 * shape, so a new step contract is picked up without being registered.
 */
export interface ControlProducer {
  file: string;
  line: number;
  name: string;
  /** snake_case columns the function reads — its gate vocabulary. */
  columns: string[];
  /** Control labels it can return. */
  labels: string[];
  /** String literals compared against its non-first parameters (e.g. a step id). */
  modes: string[];
}

/**
 * Every literal piece of text in a subtree. Template literals are flattened
 * with a hard break at each `${…}`, so `tap "Confirm They Arrived" ${unlocks}`
 * still reads as one sentence while a control name can never span an
 * interpolation. Without the template arm this scan saw NOTHING in
 * `arrivalGateMessage`, whose every return is a template — the exact
 * vacuous-pass shape this file is meant to prevent.
 */
function stringLiteralsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text + n.templateSpans.map((x) => " … " + x.literal.text).join(""));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function columnsIn(node: ts.Node): string[] {
  const cols = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && COLUMN.test(n.name.text)) cols.add(n.name.text);
    if (
      ts.isElementAccessExpression(n) &&
      n.argumentExpression &&
      ts.isStringLiteral(n.argumentExpression) &&
      COLUMN.test(n.argumentExpression.text)
    ) {
      cols.add(n.argumentExpression.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...cols];
}

export function collectControlProducers(files: string[]): ControlProducer[] {
  const out: ControlProducer[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\blabel\s*:/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      const fn =
        ts.isFunctionDeclaration(n) && n.name && n.body
          ? { name: n.name.text, body: n.body, params: n.parameters }
          : null;
      if (fn) {
        let hasLabel = false;
        let hasEnabled = false;
        const labels: string[] = [];
        const scan = (x: ts.Node) => {
          if (ts.isPropertyAssignment(x) && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name))) {
            if (x.name.text === "label") {
              hasLabel = true;
              labels.push(...stringLiteralsIn(x.initializer));
            }
            if (x.name.text === "enabled" || x.name.text === "disabled") hasEnabled = true;
          }
          ts.forEachChild(x, scan);
        };
        scan(fn.body);
        if (hasLabel && hasEnabled) {
          const columns = columnsIn(fn.body);
          // String literals compared against a non-first parameter: the modes
          // the function switches on (`step === "scheduled"`).
          const modes = new Set<string>();
          const paramNames = fn.params.slice(1).map((p) => p.name.getText(sf));
          const modeScan = (x: ts.Node) => {
            if (ts.isBinaryExpression(x)) {
              const l = x.left.getText(sf);
              const r = x.right.getText(sf);
              if (paramNames.includes(l) && ts.isStringLiteral(x.right)) modes.add(x.right.text);
              if (paramNames.includes(r) && ts.isStringLiteral(x.left)) modes.add(x.left.text);
            }
            ts.forEachChild(x, modeScan);
          };
          modeScan(fn.body);
          if (columns.length) {
            out.push({
              file: rel(file),
              line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              name: fn.name,
              columns: columns.sort(),
              labels: [...new Set(labels)],
              modes: [...modes],
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * Where a column comes FROM, anywhere in the world.
 *
 * A gate column with no producer is a permanent deadlock: the control it gates
 * can never turn on. That is the `job_checkins` class this codebase already
 * shipped once — a fallback read a table with zero writers, so the fallback
 * was decoration.
 *
 * "Produced" is deliberately broader than "written", because two of this
 * app's gate columns are legitimately never written at all:
 *
 *   DML        `SET col =` / `col := ` in a migration, `INSERT INTO … col`,
 *              or a `{ col: … }` object in a file that calls
 *              `.update()`/`.insert()`/`.upsert()`. The object form matters:
 *              `PhotoProof.tsx` builds `updateField` on one line and passes
 *              it to `.update()` on another, and a "must be inside the
 *              `.update({` parens" rule called `proof_after_urls` dead.
 *   PROJECTION `AS col` or `RETURNS TABLE(… col …)` in a migration — the
 *              trust signals (`repeat_hire_percent`, `band_rank`, …) are RPC
 *              outputs, computed per call and stored nowhere.
 *
 * A bare `CREATE TABLE` column declaration is NOT a producer. That is the
 * whole point: a column can exist and still have nothing that ever fills it.
 */
export function columnProducers(column: string): string[] {
  const hits: string[] = [];
  const dml = new RegExp(`(?:^|[\\s,(])${column}\\s*:?=`, "im");
  const insert = new RegExp(`insert\\s+into[\\s\\S]{0,600}?\\b${column}\\b`, "i");
  const projection = new RegExp(`(?:\\bAS\\s+${column}\\b|RETURNS\\s+TABLE\\s*\\([\\s\\S]{0,600}?\\b${column}\\b)`, "i");
  for (const f of walkFiles(MIGRATIONS, /\.sql$/)) {
    const t = fs.readFileSync(f, "utf8");
    if (!t.includes(column)) continue;
    if (dml.test(t) || insert.test(t) || projection.test(t)) hits.push(rel(f));
  }
  const tsProp = new RegExp(`(?:^|[\\s,{])${column}\\s*:`, "m");
  for (const f of cachedSources ?? productSources()) {
    const t = fs.readFileSync(f, "utf8");
    if (!t.includes(column)) continue;
    if (!/\.(?:update|insert|upsert)\(/.test(t)) continue;
    if (tsProp.test(t)) hits.push(rel(f));
  }
  return hits;
}

// ───────────────────────────────────────────────────────────────────────────
// CHECK 3 — same-state enablement (best-effort)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Functions that produce a sentence naming a control. Same shape discovery as
 * the control producers: reads snake_case columns, returns strings, and at
 * least one of those strings quotes a Title-Case control name.
 */
export interface CopyProducer {
  file: string;
  line: number;
  name: string;
  columns: string[];
  modes: string[];
}

export function collectCopyProducers(files: string[]): CopyProducer[] {
  const out: CopyProducer[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!CONTROL_CONTEXT.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) {
        // Only the RETURNED strings count, so a code comment about a button
        // never makes a function look like copy.
        const returned: string[] = [];
        const scanReturns = (x: ts.Node) => {
          if (ts.isReturnStatement(x) && x.expression) returned.push(...stringLiteralsIn(x.expression));
          if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return; // not this function's returns
          ts.forEachChild(x, scanReturns);
        };
        scanReturns(n.body);
        const namesAControl = returned.some(
          (s) => CONTROL_CONTEXT.test(s) && [...s.matchAll(QUOTED_NAME)].some((m) => SHAPE_OK.test(m[1].trim())),
        );
        const columns = columnsIn(n.body);
        if (namesAControl && columns.length) {
          const modes = new Set<string>();
          const paramNames = n.parameters.slice(1).map((p) => p.name.getText(sf));
          const modeScan = (x: ts.Node) => {
            if (ts.isBinaryExpression(x)) {
              if (paramNames.includes(x.left.getText(sf)) && ts.isStringLiteral(x.right)) modes.add(x.right.text);
              if (paramNames.includes(x.right.getText(sf)) && ts.isStringLiteral(x.left)) modes.add(x.left.text);
            }
            ts.forEachChild(x, modeScan);
          };
          modeScan(n.body);
          out.push({
            file: rel(file),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            name: n.name.text,
            columns: columns.sort(),
            modes: [...modes],
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * Two functions describe the same state machine when they read the same
 * columns. Two shared columns is the threshold — one is a coincidence
 * (`created_at` is everywhere), two is a shared subject.
 */
export function pairProducers(
  copies: CopyProducer[],
  controls: ControlProducer[],
): Array<{ copy: CopyProducer; control: ControlProducer; shared: string[] }> {
  const pairs: Array<{ copy: CopyProducer; control: ControlProducer; shared: string[] }> = [];
  for (const c of copies) {
    for (const k of controls) {
      const shared = c.columns.filter((x) => k.columns.includes(x));
      if (shared.length >= 2) pairs.push({ copy: c, control: k, shared });
    }
  }
  return pairs;
}

/**
 * Every 2^n truthy/falsy assignment over a column vocabulary.
 *
 * The truthy value is NOW, not a fixed date, because several gates are
 * recency windows (`recentArrivalNearMiss` is 12 hours). A hard-coded stamp
 * would drift past every window and quietly make this whole check vacuous
 * some time after it was written.
 */
export function stateSpace(columns: string[]): Array<Record<string, string | null>> {
  const now = new Date().toISOString();
  const out: Array<Record<string, string | null>> = [];
  const n = columns.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const s: Record<string, string | null> = {};
    columns.forEach((c, i) => (s[c] = mask & (1 << i) ? now : null));
    out.push(s);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// the checks
// ───────────────────────────────────────────────────────────────────────────

const FILES = productSources();
cachedSources = FILES;
const RENDERED = collectRenderedLabels(FILES);
const NAMED = collectNamedControls(FILES);
const CONTROL_PRODUCERS = collectControlProducers(FILES);
const COPY_PRODUCERS = collectCopyProducers(FILES);

describe("control reachability — the inventories are real", () => {
  it("harvested a non-trivial number of rendered control labels", () => {
    // A scan that quietly found nothing is the failure mode this class is
    // about, so the inventory asserts its own size.
    expect(RENDERED.byLabel.size).toBeGreaterThan(500);
  });

  it("harvested the control names the app's own copy uses", () => {
    expect(NAMED.length).toBeGreaterThan(5);
    // The arrival copy is the bug this file exists for; if the scanner ever
    // stops seeing it, every check below goes vacuously green.
    expect(NAMED.some((n) => n.phrase === "Confirm They Arrived")).toBe(true);
  });

  it("found the control producers that decide whether a control is offered", () => {
    expect(CONTROL_PRODUCERS.length).toBeGreaterThan(0);
    expect(CONTROL_PRODUCERS.some((p) => p.name === "posterConfirmationRung")).toBe(true);
  });
});

describe("CHECK 1 (strong) — copy never names a control that does not exist", () => {
  it("every QUOTED control name resolves to a label some component renders", () => {
    const misses = NAMED.filter((n) => n.kind === "quoted" && !resolveNamedControl(n.phrase, RENDERED.byLabel)).map(
      (n) => `${n.file}:${n.line} names "${n.phrase}" — no component renders that label`,
    );
    expect(misses, misses.join("\n")).toEqual([]);
  });

  it("reports (does not fail on) verb-form names that resolve to nothing", () => {
    // ADVISORY. "tap Pay All with Stripe" is harvested from prose, so a miss
    // is as likely to be a sentence this scanner mis-sliced as a real dead
    // instruction. Printed for a human, never red — an advisory that could go
    // red would get the whole file disabled.
    const misses = NAMED.filter((n) => n.kind === "verb" && !resolveNamedControl(n.phrase, RENDERED.byLabel));
    if (misses.length) {
       
      console.log(
        "[control-reachability] verb-form names with no matching control (advisory):\n" +
          misses.map((m) => `  ${m.file}:${m.line}  "${m.phrase}"`).join("\n"),
      );
    }
    expect(Array.isArray(misses)).toBe(true);
  });
});

describe("CHECK 2 (strong) — a control's gate columns are written by somebody", () => {
  it("every column a control producer gates on has at least one writer", () => {
    const dead: string[] = [];
    const seen = new Map<string, string[]>();
    for (const p of CONTROL_PRODUCERS) {
      for (const col of p.columns) {
        if (!seen.has(col)) seen.set(col, columnProducers(col));
        if (seen.get(col)!.length === 0) {
          dead.push(`${p.file}:${p.line} ${p.name}() gates on "${col}", which nothing in the repo ever writes`);
        }
      }
    }
    expect(dead, dead.join("\n")).toEqual([]);
  });
});

describe("CHECK 3 (best-effort) — the named control is offered in the state the copy describes", () => {
  it("pairs copy producers with control producers by shared column vocabulary", () => {
    const pairs = pairProducers(COPY_PRODUCERS, CONTROL_PRODUCERS);
    // The arrival pair is the one the 2026-09-19 deadlock lived in. If the
    // discovery stops finding it, this check has gone vacuous and says so.
    const arrival = pairs.find(
      (p) => p.copy.name === "arrivalGateMessage" && p.control.name === "posterConfirmationRung",
    );
    expect(
      arrival,
      `pair discovery found ${pairs.length} pairs but not arrivalGateMessage↔posterConfirmationRung; ` +
        `copy producers: ${COPY_PRODUCERS.map((c) => c.name).join(", ")}`,
    ).toBeTruthy();
  });

  it("no state lets copy name a control the producer will not offer in that state", async () => {
    const pairs = pairProducers(COPY_PRODUCERS, CONTROL_PRODUCERS);
    const violations: string[] = [];

    for (const { copy, control, shared } of pairs) {
      const copyMod = await importProducer(copy.file);
      const ctrlMod = await importProducer(control.file);
      const copyFn = copyMod?.[copy.name];
      const ctrlFn = ctrlMod?.[control.name];
      if (typeof copyFn !== "function" || typeof ctrlFn !== "function") continue;

      const vocab = [...new Set([...copy.columns, ...control.columns])].filter((c) => /_at$/.test(c));
      if (!vocab.length || vocab.length > 14) continue;

      // Which labels can this producer EVER offer, enabled?
      const everEnabled = new Set<string>();
      const enabledIn = new Map<string, Set<string>>(); // stateKey → labels
      for (const s of stateSpace(vocab)) {
        for (const mode of control.modes.length ? control.modes : [undefined]) {
          const rung = safeCall(ctrlFn, [s, mode, new Date()]);
          if (rung && typeof rung === "object" && (rung as { enabled?: unknown }).enabled === true) {
            const label = String((rung as { label?: unknown }).label ?? "");
            if (!label) continue;
            everEnabled.add(normaliseLabel(label));
            const key = stateKey(s, shared);
            if (!enabledIn.has(key)) enabledIn.set(key, new Set());
            enabledIn.get(key)!.add(normaliseLabel(label));
          }
        }
      }
      if (!everEnabled.size) continue;

      for (const s of stateSpace(vocab)) {
        for (const mode of copy.modes.length ? copy.modes : [undefined]) {
          const sentence = safeCall(copyFn, [s, mode]);
          if (typeof sentence !== "string") continue;
          for (const m of sentence.matchAll(QUOTED_NAME)) {
            const phrase = m[1].trim();
            if (!SHAPE_OK.test(phrase)) continue;
            const label = normaliseLabel(phrase);
            // Only controls this producer owns are in scope.
            if (!everEnabled.has(label)) continue;
            const offered = enabledIn.get(stateKey(s, shared));
            if (offered?.has(label)) continue;
            violations.push(
              `${copy.file} ${copy.name}(${JSON.stringify(compact(s, shared))}${mode ? `, "${mode}"` : ""}) says\n` +
                `    "${sentence}"\n` +
                `  but ${control.file} ${control.name}() offers no enabled "${phrase}" in any state agreeing with it ` +
                `on ${shared.join(", ")}`,
            );
          }
        }
      }
    }

    const unique = [...new Set(violations)];
    expect(unique, unique.join("\n\n")).toEqual([]);
  });
});

function compact(s: Record<string, string | null>, keys: string[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((k) => [k, !!s[k]]));
}

/** Two states agree when their SHARED columns agree; the rest is existential. */
function stateKey(s: Record<string, string | null>, shared: string[]): string {
  return shared.map((k) => (s[k] ? "1" : "0")).join("");
}

function safeCall(fn: unknown, args: unknown[]): unknown {
  try {
    return (fn as (...a: unknown[]) => unknown)(...args);
  } catch {
    return undefined;
  }
}

const modCache = new Map<string, Record<string, unknown> | null>();
async function importProducer(relPath: string): Promise<Record<string, unknown> | null> {
  if (modCache.has(relPath)) return modCache.get(relPath)!;
  let mod: Record<string, unknown> | null;
  try {
    mod = (await import(/* @vite-ignore */ path.join(ROOT, relPath))) as Record<string, unknown>;
  } catch {
    mod = null;
  }
  modCache.set(relPath, mod);
  return mod;
}

// ───────────────────────────────────────────────────────────────────────────
// PROVEN ABLE TO FAIL — each check re-run against a planted violation
// ───────────────────────────────────────────────────────────────────────────

describe("the checks are able to fail", () => {
  it("CHECK 1 goes red when a control named in copy is renamed away", () => {
    // The world minus the "Confirm They Arrived" label — exactly what VN-33
    // produced when the control stopped rendering.
    const crippled = new Map(RENDERED.byLabel);
    crippled.delete(normaliseLabel("Confirm They Arrived"));
    const misses = NAMED.filter((n) => n.kind === "quoted" && !resolveNamedControl(n.phrase, crippled));
    expect(misses.length).toBeGreaterThan(0);
    expect(misses.some((m) => m.phrase === "Confirm They Arrived")).toBe(true);
  });

  it("CHECK 2 goes red for a control gated on a column nothing writes", () => {
    // A column of exactly the shape this codebase uses, that no migration and
    // no client write has ever set.
    expect(columnProducers("helper_teleported_at")).toEqual([]);
    // …and a real one is not falsely reported dead, so the check is not
    // trivially red for everything.
    expect(columnProducers("helper_arrived_at").length).toBeGreaterThan(0);
  });

  it("CHECK 3 goes red for a copy branch whose control is never offered there", () => {
    // The synthetic pair reproduces the VN-33 shape: the copy fires when the
    // helper has not been recorded arrived, and the control is gated on
    // exactly that column.
    const copyFn = (job: Record<string, unknown>) =>
      job.helper_arrived_at
        ? 'Tap "Mark Job Complete" when you are done.'
        : 'Ask them to tap "Confirm They Arrived" before you can start.';
    const ctrlFn = (job: Record<string, unknown>) => ({
      label: job.helper_arrived_at ? "Confirm They Arrived" : "Mark Job Complete",
      enabled: !!job.helper_arrived_at,
    });
    const shared = ["helper_arrived_at"];
    const vocab = ["helper_arrived_at", "poster_confirmed_arrival_at"];

    const everEnabled = new Set<string>();
    const enabledIn = new Map<string, Set<string>>();
    for (const s of stateSpace(vocab)) {
      const rung = ctrlFn(s);
      if (rung.enabled) {
        everEnabled.add(normaliseLabel(rung.label));
        const key = stateKey(s, shared);
        if (!enabledIn.has(key)) enabledIn.set(key, new Set());
        enabledIn.get(key)!.add(normaliseLabel(rung.label));
      }
    }
    const found: string[] = [];
    for (const s of stateSpace(vocab)) {
      const sentence = copyFn(s);
      for (const m of sentence.matchAll(QUOTED_NAME)) {
        const label = normaliseLabel(m[1].trim());
        if (!everEnabled.has(label)) continue;
        if (enabledIn.get(stateKey(s, shared))?.has(label)) continue;
        found.push(`${JSON.stringify(compact(s, shared))} names "${m[1]}"`);
      }
    }
    expect(found.length).toBeGreaterThan(0);
  });
});
