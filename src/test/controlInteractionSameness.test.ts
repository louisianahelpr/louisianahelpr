/**
 * ONE HOVER, ONE PRESS, ONE RING — the interaction-state sameness guard.
 *
 * Owner, 2026-09-19: "also some back buttons or any button moves on hover,
 * some has a square grey background on hover, etc. all of these need to be
 * consistent." That is the third time consistency has been raised, and the
 * second layer of the same complaint: owner item 9 fixed the SHAPE of the
 * controls, and underneath it the INTERACTION was still 42 different opinions.
 *
 * Measured at the time this guard was written (`hover:bg-*` on controls only):
 *   33 distinct hover tints, 4 token families (olivewood / bark / secondary /
 *   sidebar-accent) x 5 alphas (0.04 / 0.06 / 0.08 / 0.10 / 0.12) spelling the
 *   SAME intent — "this neutral control is hovered". Plus 8 distinct press
 *   scales, 5 distinct focus-ring colours, and 13 controls that physically
 *   MOVE out from under the cursor.
 *
 * THE RULE this guard enforces — see src/index.css "The one interaction
 * treatment" for the definitions:
 *
 *   HOVER  A control TINTS. Nothing else. It does not move, it does not lift,
 *          it does not grow a shadow or a border, it does not fade.
 *          Two mechanisms, chosen by the SURFACE and never by taste:
 *            - unfilled (ghost / outline / icon / nav row / back button):
 *              `background-color` steps to one of three sanctioned tones
 *              (.ctl-tint, .ctl-tint-brand, .ctl-tint-danger).
 *            - filled (anything carrying its own paint, above all
 *              `btn-grad-primary`, which a `bg-*` utility would destroy):
 *              `filter: brightness(1.1)`, the only way to tint a gradient
 *              without overwriting it.
 *          Both are "the surface darkens one step". The KIND is identical;
 *          only the TONE varies, from a closed set.
 *
 *   PRESS  scale(0.97). One value. `.btn-press` and the button primitive's
 *          `active:scale-[0.97]` are now the same number.
 *
 *   RING   `--ring` at offset 2. One colour, one offset.
 *
 * WHY NO MOVEMENT (the decision this guard is mostly here to hold): a control
 * that lifts on hover moves the target out from under a cursor that is still
 * arriving at it. That is a Fitts's-law regression, it is worse on a trackpad
 * where the pointer is already imprecise, and at the bottom of a list it can
 * bump the row you were aiming at into the one below. Movement is the one
 * hover affordance that makes the control HARDER to hit. A glyph INSIDE a
 * control may still slide (`group-hover:translate-x-*` on an arrow) — the
 * target itself does not move, so the cost is zero and the affordance reads.
 * That distinction is why this guard matches `hover:` and never `group-hover:`.
 *
 * ── WHAT THIS GUARD CANNOT SEE ──────────────────────────────────────────────
 * This is a SOURCE check, not a rendered one, and it is deliberately so:
 * jsdom does not apply stylesheets, so a rendered assertion in vitest would
 * read empty strings for every one of these properties and pass vacuously.
 * Therefore it cannot catch:
 *   - a hover rule written in a .css file against an element selector
 *     (`.foo:hover { transform: ... }`) rather than as a utility class. The
 *     css-side inventory below covers src/index.css specifically for the
 *     movement rule, but not arbitrary stylesheets.
 *   - a class composed at runtime from fragments (`` `hover:bg-${tone}` ``).
 *     Tailwind cannot compile those either, so they are already dead.
 *   - whether the sanctioned classes RESOLVE to what they claim. Nothing in
 *     vitest can: jsdom has no cascade. That was verified by hand against
 *     dist/assets/*.css after `npm run build` (never the dev server — the
 *     minifier collapses declarations), and the three facts that matter are
 *     the CASCADE ORDER, which is what makes the design work:
 *       14,575  .ctl-tint,.ctl-tint-brand,.ctl-tint-danger{transition:
 *                 background-color .12s}          <- @layer components
 *       92,041  .transition-[transform,box-shadow,filter,background-color]
 *                                                 <- utility, so it WINS,
 *                 which is why the button keeps its press animation
 *       53,075  .bg-background\/70{...}            <- utility
 *      113,673  @media (hover:hover){.ctl-tint:hover{background-color:
 *                 hsl(var(--olivewood) / .08)}}   <- unlayered, so it WINS
 *                 over the outline variant's resting fill
 *     Re-run that check if index.css is reordered; the whole treatment
 *     depends on one rule being layered and the other not.
 *
 * Both registrations below break the RULE itself, not a comment about it, and
 * neither target is imported by this file — it reads both from disk, so it can
 * never end up comparing a constant to itself.
 *
 * @mutate src/components/ui/button.tsx | const GREEN_CTA_HOVER = "hover:brightness-110"; | const GREEN_CTA_HOVER = "hover:brightness-110 hover:-translate-y-px";
 * @mutate src/index.css | filter: brightness(1.1); | transform: translateY(-1px);
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import LEDGER from "./controlInteractionLedger.json";

// ── 1. INVENTORY, derived from the world ────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const SRC = walk("src");
const TSX = SRC.filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
const TS_AND_TSX = SRC.filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));

/** Elements that ARE a control — the thing a pointer aims at and presses. */
const CONTROL_TAG =
  /<(button|a|Button|Link|NavLink|DropdownMenuItem|SelectItem|TabsTrigger|ToggleGroupItem)(?=[\s/>])/g;

// The `(?<![\w-])` lookbehind is load-bearing: without it this matches the
// `hover:translate-x-0.5` INSIDE `group-hover:translate-x-0.5` and reports a
// glyph animating inside a still control as the control itself moving. That
// distinction is the entire movement rule, so getting it wrong here would
// have inverted the guard. `motion-safe:hover:...` is still matched (`:` is
// not in the class), and it should be — that is a real control hover.
const VARIANT =
  /(?<![\w-])(?:hover|active|focus-visible):[^\s"'`{}]+|(?<![\w-])ctl-tint(?:-brand|-danger)?(?![\w-])/g;

/**
 * The opening tag only — from `<` to the `>` that closes it, skipping over
 * string literals and balanced `{}` so an expression prop cannot end the scan
 * early. Children are deliberately NOT included: a glyph inside a control is
 * allowed to animate, the control is not.
 */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth <= 0) return src.slice(start, i + 1);
  }
  return src.slice(start, start + 4000);
}

const lineOf = (src: string, i: number) => src.slice(0, i).split("\n").length;

/**
 * Blank out comments, preserving every byte's offset so reported line numbers
 * stay true.
 *
 * This is not hygiene, it is correctness, and it caught a live bug in this
 * guard: the comment above `GREEN_CTA_HOVER` in button.tsx QUOTES the owner
 * ("...some has a square grey background on hover...") and then lists the
 * classes that were removed. The bare `"` of that quotation opened what the
 * string-literal scanner took for a string, and it read the REMOVED
 * `hover:shadow-[...]` back out of the prose explaining the removal — filing
 * the fix as a violation of itself.
 *
 * The general form of that mistake is the one CLAUDE.md warns about from the
 * other direction: a check that can be satisfied, or broken, by the comment
 * explaining the rule is not checking the rule.
 */
function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && !(src[i] === quote && src[i - 1] !== "\\")) {
        if (src[i] === "\n" && quote !== "`") break; // unterminated: bail, do not run away
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      out[i] = " ";
      if (i + 1 < src.length) out[i + 1] = " ";
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

export type Control = {
  file: string;
  line: number;
  what: string;
  /** the hover / active / focus-visible classes, plus any sanctioned tone */
  classes: string[];
  /** the control's UNPREFIXED background classes, so R3 can tell a hover
   *  LOCK (`bg-X` + `hover:bg-X`) from a hover TREATMENT. */
  resting: Set<string>;
};

const restingBg = (text: string) =>
  new Set(
    [...text.matchAll(/(?<![\w-:])!?bg-[^\s"'`{}]+/g)].map((m) => m[0].replace("!", "").replace(/^bg-/, "")),
  );

const controls: Control[] = [];

// (a) every control element written as JSX
for (const file of TSX) {
  const src = stripComments(readFileSync(file, "utf8"));
  for (const m of src.matchAll(CONTROL_TAG)) {
    const tag = openingTag(src, m.index!);
    const classes = [...tag.matchAll(VARIANT)].map((x) => x[0]);
    if (classes.length)
      controls.push({ file, line: lineOf(src, m.index!), what: `<${m[1]}>`, classes, resting: restingBg(tag) });
  }
}

// (b) the shared control PRIMITIVES. A cva() variant map never appears inside
//     a JSX tag, so (a) is structurally blind to exactly the file that matters
//     most — src/components/ui/button.tsx, whose `hover:-translate-y-px` is
//     the single most-rendered hover in the app. Any file that calls cva() is
//     defining control classes; scan its string literals.
const STRING_LITERAL = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
for (const file of TS_AND_TSX) {
  const src = stripComments(readFileSync(file, "utf8"));
  if (!src.includes("cva(")) continue;
  for (const m of src.matchAll(STRING_LITERAL)) {
    const text = m[1] ?? m[2] ?? "";
    const classes = [...text.matchAll(VARIANT)].map((x) => x[0]);
    if (classes.length)
      controls.push({ file, line: lineOf(src, m.index!), what: "cva variant", classes, resting: restingBg(text) });
  }
}

// ── 2. THE SANCTIONED SETS ──────────────────────────────────────────────────

/** The three tones. Defined once in src/index.css; see the block named
 *  "THE ONE INTERACTION TREATMENT". */
const SANCTIONED_TINT = new Set(["ctl-tint", "ctl-tint-brand", "ctl-tint-danger"]);
/**
 * The same three tones written as a raw utility, for the handful of controls
 * that cannot use the class because they live inside a third-party stylesheet
 * and need `!important` to beat it (Sonner's toast chrome). The VALUE is the
 * closed set; the class is just the convenient way to spell it.
 */
const SANCTIONED_TINT_VALUE = new Set([
  "hover:bg-[hsl(var(--olivewood)/0.08)]",
  "hover:bg-[hsl(var(--bark)/0.08)]",
  "hover:bg-[hsl(var(--destructive)/0.10)]",
]);
/**
 * The filled-surface mechanism: a fill can only be tinted by filtering it,
 * because a `bg-*` on hover would REPLACE the fill (and on `btn-grad-primary`
 * would blank the button out entirely). Two steps, and which one a control
 * gets is decided by its own lightness, not by taste: a dark fill darkens
 * toward the page by lightening is wrong — a dark fill LIGHTENS (110) and a
 * light fill DARKENS (95), so both move the same direction the `.ctl-tint`
 * wash moves an unfilled control. Same kind, two tones.
 */
const SANCTIONED_BRIGHTNESS = new Set(["hover:brightness-110", "hover:brightness-95"]);
/** One press KIND: a control presses by SCALING. `active:opacity-*` is a
 *  different treatment entirely — the control fades rather than depresses —
 *  and the two read as different kinds of button sitting next to each other.
 *  The scale MAGNITUDE is a tone, not a kind, so it is ratcheted (below)
 *  rather than ledgered: 8 distinct values today, and that number may only
 *  go down. `active:scale-100` is the disabled-state opt-out, not a press. */
const SANCTIONED_PRESS_KIND = /^active:scale-/;
/** One ring. `--ring` is `--bark`, so these three spellings are ONE value —
 *  the drift that matters is `ring-primary` / `ring-olivewood` / offset != 2. */
const SANCTIONED_RING = new Set([
  "focus-visible:ring-ring",
  "focus-visible:ring-[hsl(var(--ring))]",
  "focus-visible:ring-[hsl(var(--bark))]",
  "focus-visible:outline-ring",
]);

const RULES = {
  /** R1 — a control never moves under the cursor. */
  move: (c: Control) => c.classes.filter((x) => /^hover:-?(translate-[xy]|scale)-/.test(x)),
  /** R2 — hover changes the tint and nothing else. */
  notTint: (c: Control) =>
    c.classes.filter((x) => /^hover:(shadow|border|opacity|ring)-/.test(x)),
  /**
   * R3 — an unfilled control tints from the closed set of three tones.
   *
   * ONE exemption, and it is not a loophole: a control may pin its hover
   * background to its own RESTING background, which is how a selected item
   * opts out of a tint it inherited from a shared variant (the selected day
   * in the calendar inherits `ghost`, and must stay bark while hovered). That
   * is a lock, not a treatment — the surface does not change — so it is
   * recognised by the VALUES being identical, never by a class name.
   */
  adhocTint: (c: Control) =>
    c.classes.filter((x) => {
      if (!/^hover:!?bg-/.test(x)) return false;
      if (SANCTIONED_TINT_VALUE.has(x.replace("!", ""))) return false;
      const resting = x.replace(/^hover:!?/, "").replace(/^bg-/, "");
      return !c.resting.has(resting);
    }),
  /** R4 — a filled control brightens by the one sanctioned step. */
  adhocBrightness: (c: Control) =>
    c.classes.filter(
      (x) =>
        /^hover:!?(brightness|saturate|contrast)-/.test(x) &&
        !SANCTIONED_BRIGHTNESS.has(x.replace("!", "")),
    ),
  /** R5 — a control presses by scaling, never by fading or sliding. */
  press: (c: Control) =>
    c.classes.filter((x) => /^active:(scale|opacity|translate)-/.test(x) && !SANCTIONED_PRESS_KIND.test(x)),
  /** R6 — one focus ring colour. */
  ring: (c: Control) =>
    c.classes.filter(
      (x) => /^focus-visible:!?(ring|outline)-(?!none$|offset-2$|2$|inset$)/.test(x) && !SANCTIONED_RING.has(x),
    ),
} as const;

type RuleName = keyof typeof RULES;

const key = (c: Control, rule: RuleName, hits: string[]) =>
  `${rule}  ${c.file}:${c.line} ${c.what}  ${hits.join(" ")}`;

function violations(rule: RuleName): string[] {
  return controls
    .map((c) => {
      const hits = RULES[rule](c);
      return hits.length ? key(c, rule, hits) : null;
    })
    .filter((x): x is string => x !== null)
    .sort();
}

// ── 3. THE HAND-BACK LEDGER ─────────────────────────────────────────────────
//
// Five other lanes own files this lane may not edit (src/components/dashboard,
// src/components/profile, src/components/messages, src/components/postjob,
// src/components/activity, src/pages/userProfile). Their overrides are REAL
// violations of the rule above; they are listed so the rule can land now and
// they can be handed to the owning lane, not so they can be forgotten.
//
// The ledger may only SHRINK. An entry that is no longer a violation is itself
// a failure (below), so it cannot rot into a permanent excuse — exactly the
// contract src/test/vacuity.baseline.json runs on.
/**
 * The hand-back ledger, keyed WITHOUT the line number.
 *
 * Every entry reads `rule  file:line  <tag>  class`. Keying on the whole
 * string made the ledger rot on any edit ANYWHERE ABOVE a listed control:
 * on 2026-09-19 two unrelated commits (a profile card, a back-control sweep)
 * shifted lines in six files and fourteen entries went "stale" while every
 * one of them was still a live violation of exactly the same kind, in exactly
 * the same file. A guard that goes red because somebody added an import is a
 * guard people learn to delete.
 *
 * `rule + file + tag + class` is the thing actually being handed back — the
 * line is only there so a human can find it. Dropping it from the key costs
 * nothing real: two identical violations in one file were already one entry,
 * because the ledger is a Set.
 */
const ledgerKey = (entry: string) => entry.replace(/:\d+(?=\s)/, "");
const ledger = new Set<string>(LEDGER.handBack.map(ledgerKey));

describe("one hover, one press, one ring", () => {
  it("has a real inventory to check", () => {
    // Floors, not decoration: every assertion below is per-member, so an empty
    // or collapsed inventory would make all of them pass. Measured 2026-09-19:
    // 308 JSX controls across 169 files, plus the cva primitives.
    expect(controls.length).toBeGreaterThan(280);
    expect(new Set(controls.map((c) => c.file)).size).toBeGreaterThan(150);
    // The cva arm specifically — this is the arm that sees button.tsx, and a
    // regex that stops matching it would silently gut the most important file.
    const cva = controls.filter((c) => c.what === "cva variant");
    expect(cva.length).toBeGreaterThan(10);
    expect(cva.map((c) => c.file)).toContain("src/components/ui/button.tsx");
    // and the primitive really is reachable through it
    expect(
      controls.filter((c) => c.file === "src/components/ui/button.tsx").flatMap((c) => c.classes).length,
    ).toBeGreaterThan(5);
  });

  it("no control moves out from under the cursor on hover", () => {
    const bad = violations("move").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "a control that lifts or grows on hover moves the target the user is aiming at").toEqual([]);
  });

  it("hover changes the tint and nothing else", () => {
    const bad = violations("notTint").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "shadow / border / opacity / ring on hover is a second, competing treatment").toEqual([]);
  });

  it("an unfilled control tints from the three sanctioned tones", () => {
    const bad = violations("adhocTint").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "use .ctl-tint / .ctl-tint-brand / .ctl-tint-danger (src/index.css)").toEqual([]);
  });

  it("a filled control brightens by the one sanctioned step", () => {
    const bad = violations("adhocBrightness").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "a gradient fill cannot take bg-*; hover:brightness-110 is the filled mechanism").toEqual([]);
  });

  it("a control presses by scaling, not by fading", () => {
    const bad = violations("press").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "the press is a scale; active:opacity-* is a second, competing kind").toEqual([]);
  });

  it("the number of distinct press magnitudes may only shrink", () => {
    // A RATCHET, not a ledger. 84 controls press at NINE different scales
    // (0.90 / 0.94 / 0.95 / 0.96 / 0.97 / 0.98 / 0.985 / 0.99, plus the bare
    // `scale-95`, which is a tenth spelling of the fifth of those). Converging
    // them onto scale(0.97) is a visible change to 84 controls and belongs to
    // the lanes that own them, so this guard does not demand it today — it
    // only refuses to let a NINTH opinion appear. Lower this number as the
    // set converges; raising it is the thing that must never happen quietly.
    const scales = new Set(
      controls.flatMap((c) =>
        // `active:scale-100` is the disabled-state OPT OUT ("this control does
        // not press"), not a press magnitude, so it is not one of the
        // opinions being counted.
        c.classes.filter((x) => /^active:scale-/.test(x) && x !== "active:scale-100"),
      ),
    );
    expect(scales.size, [...scales].sort().join(" ")).toBeLessThanOrEqual(9);
  });

  it("a keyboard user gets exactly one ring", () => {
    const bad = violations("ring").filter((v) => !ledger.has(ledgerKey(v)));
    expect(bad, "the focus ring is --ring at offset 2").toEqual([]);
  });

  it("src/index.css never moves a control on hover either", () => {
    // The utility-class arms above cannot see a hover rule written as CSS.
    // index.css is this lane's own file and the one place such a rule would
    // plausibly live, so it is checked directly. `:hover .child` (a glyph
    // inside a hovered control) is allowed, exactly as `group-hover:` is.
    // Comments out first: this stylesheet's prose contains CSS samples, and a
    // brace inside a comment would mis-pair every rule after it.
    const css = readFileSync("src/index.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      // `transform: none` is how reduced-motion CANCELS movement — the
      // opposite of a violation.
      if (!/(?:^|[;{\s])transform\s*:\s*(?!none\b)\S/.test(body)) continue;
      for (const part of m[1].split(",")) {
        const selector = part.trim();
        // ENDS with :hover => the rule targets the hovered element itself.
        // `a:hover .lucide-arrow-right` does not, and is the allowed case:
        // a glyph inside a control that holds still.
        if (!/:hover$/.test(selector)) continue;
        offenders.push(`${selector} { ${body.trim().replace(/\s+/g, " ")} }`);
      }
    }
    // FLOOR: the rule-splitter must actually be seeing rules. If this regex
    // ever stops matching (a nested @media form it cannot parse, say) the
    // loop above would find nothing and the assertion would pass vacuously.
    const hoverRules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.trim()).filter((x) => /:hover\b/.test(x)),
    );
    expect(hoverRules.length, "the stylesheet parser stopped seeing :hover rules").toBeGreaterThan(2);
    expect(offenders).toEqual([]);
  });

  it("the hand-back ledger may only shrink", () => {
    const live = new Set(
      (Object.keys(RULES) as RuleName[]).flatMap((r) => violations(r)),
    );
    const liveKeys = new Set([...live].map(ledgerKey));
    const stale = [...ledger].filter((entry) => !liveKeys.has(entry));
    expect(
      stale,
      "these are no longer violations — delete them from controlInteractionLedger.json. " +
        "(A moved line no longer lands here: the key drops the line number.)",
    ).toEqual([]);
    // The ledger is a hand-back list, not a licence — two floors keep it one.
    // (i) it may never cover most of the inventory.
    expect(ledger.size).toBeLessThan(controls.length * 0.6);
    // (ii) and more importantly, the RULE must actually be applied somewhere:
    // a ledger that simply absorbed every violation would pass (i) and still
    // mean nothing. Count the controls that carry a sanctioned tone.
    const adopted = controls.filter((c) =>
      [...SANCTIONED_TINT].some((t) => c.classes.some((x) => x.includes(t))),
    );
    expect(adopted.length, "no control uses a sanctioned tone — the rule never landed").toBeGreaterThan(8);
  });
});
