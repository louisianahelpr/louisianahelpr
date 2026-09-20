#!/usr/bin/env node
/**
 * THE BACK-CONTROL INVENTORY — derived from the world, not from a list.
 *
 * Owner, 2026-09-19, twice: "you need to thoroughly check back buttons bc some
 * have a square background on hover, some circle on hover and some move on
 * hover, this needs to be consistent."
 *
 * A "back control" here is defined by what it IS, never by its name: a control
 * whose whole job is to take the user OUT of the surface they are on — back a
 * page, back a step, or out of a popup. That is one gesture with one look, so
 * it is one inventory.
 *
 * It is NOT every icon button, and above all it is not a chip's remove-×: that
 * deletes a VALUE and leaves you where you are. `src/test/
 * controlInteractionSameness.test.ts` already polices the hover TREATMENT of
 * every control in the app; this inventory exists for the one extra property
 * that guard cannot see — the SHAPE the treatment paints, which is the half of
 * the complaint that says "square … circle".
 *
 * Emits JSON on stdout: { controls: [...], byShape: {...}, byMotion: {...} }.
 * Consumed by src/test/backControlSameness.test.ts, so the number in any
 * report is reproducible rather than eyeballed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "src";

export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !p.includes(".test.")) out.push(p);
  }
  return out;
}

/**
 * Blank out comments, preserving byte offsets so line numbers stay true.
 *
 * Load-bearing, not hygiene: three guards in this repo have been fooled by a
 * comment QUOTING the defect it documents. A guard satisfiable — or breakable
 * — by prose is not checking the rule. Ported deliberately from
 * controlInteractionSameness.test.ts so both scanners are blind the same way.
 */
export function stripComments(src) {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && !(src[i] === quote && src[i - 1] !== "\\")) {
        if (src[i] === "\n" && quote !== "`") break; // unterminated: bail
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

/**
 * Anything a pointer aims at and presses.
 *
 * The wrappers are here for COMPLETENESS, not because the shape rule applies
 * to them: `BarkPillButton` is how UserProfile's "Go back" empty-state action
 * is written, and the two popup secondary actions are how ReportDialog's
 * "Back" step control is written. All three come out `kind: "labelled"` and
 * are excluded from the shape rule below — a word-bearing pill must NOT be
 * forced round. But a scanner that could not SEE them would leave a real back
 * affordance outside the inventory, and "inventory minus normalised is empty"
 * would be a claim about a smaller world than the one the owner clicks.
 */
const CONTROL_TAG =
  /<(button|Button|BackButton|BarkPillButton|DialogSecondaryAction|SheetSecondaryAction|[A-Za-z]*Primitive\.Close|DialogClose|SheetClose|AlertDialogCancel|PopoverClose)(?=[\s/>])/g;

/** The opening tag only — `<` to its `>`, skipping strings and balanced {}. */
export function openingTag(src, start) {
  let depth = 0;
  let quote = null;
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

/**
 * The element's BODY — everything between its opening tag and the matching
 * close, so we can see which glyph it draws and whether that glyph animates.
 * Self-closing elements have an empty body.
 */
export function elementBody(src, start, tag, name) {
  if (/\/>\s*$/.test(tag)) return "";
  const open = `<${name}`;
  const close = `</${name}`;
  let depth = 1;
  let i = start + tag.length;
  const bodyStart = i;
  while (i < src.length && depth > 0) {
    if (src.startsWith(close, i)) {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
      i += close.length;
      continue;
    }
    if (src.startsWith(open, i) && /[\s/>]/.test(src[i + open.length] ?? "")) {
      depth++;
      i += open.length;
      continue;
    }
    i++;
  }
  return src.slice(bodyStart, Math.min(i, bodyStart + 4000));
}

/** Icons that mean "leave this surface". */
const EXIT_GLYPH = /<(ArrowLeft|ChevronLeft|X)(?=[\s/>])/;
const LABEL = /(?:aria-label|title)\s*=\s*"([^"]*)"/;
/** Only whole-surface exits. "Remove", "Clear", "Delete" are value edits. */
const EXIT_LABEL = /^\s*(go\s+back|back|close|dismiss|cancel)\b/i;
const GO_BACK_CALL = /navigate\(\s*-1\s*\)|history\.back\(\)|router\.back\(\)|\bonBack\b|\bonDismiss\b/;

/**
 * Does this control draw a WORD, or only a glyph?
 *
 * The distinction decides which rule applies, and it is not cosmetic. An
 * icon-only exit is CHROME: a bare glyph with a painted hit area around it,
 * and that painted area is the thing the owner is looking at when they say
 * "square … circle". A LABELLED exit ("Go Back", "Cancel selection") is an
 * ordinary button wearing `buttonVariants`, whose radius belongs to the button
 * family and must NOT be forced round — a rounded-full text button is a pill,
 * which is a different component entirely.
 *
 * `sr-only` text is stripped first: every icon-only control in this app
 * carries one for the accessible name, so counting it as a word would collapse
 * the two kinds into one.
 */
export function visibleText(body) {
  let t = body.replace(/<span[^>]*sr-only[^>]*>[\s\S]*?<\/span>/g, " ");
  t = t.replace(/<[^>]*>/g, " ");
  // Balanced {} — an expression child is markup, not a word.
  let out = "";
  let depth = 0;
  for (const ch of t) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Chip/pill removers, list-row deletes and discards: an × that edits a VALUE
 * and leaves you exactly where you were. "Discard voice note" is the one that
 * looks most like an exit and is not — it throws away a recording and keeps
 * the composer open.
 */
const VALUE_EDIT_LABEL = /^\s*(remove|clear|delete|discard|unselect|deselect|undo)\b/i;

/**
 * Everything that decides the SHAPE of the painted hit area — the Tailwind
 * radius utilities plus `.ctl-exit`, the app's one exit-affordance shape
 * (src/index.css). They are collected together on purpose: the violation the
 * owner reported is two of these landing on one control, or the wrong one
 * landing alone, and both are invisible if they are counted separately.
 */
const RADIUS =
  /(?<![\w-:])!?(?:rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|ds-sm|ds-md|ds-lg|ds-xl))?|ctl-exit)(?![\w-])/g;
const HOVER_MOVE = /(?<![\w-])(?:group-)?hover:-?(?:translate-[xy]|scale)-[^\s"'`{}]+/g;
const TONE = /(?<![\w-])(ctl-tint(?:-brand|-danger|-on-tint|-invert)?)(?![\w-])/g;
/** A hover background written as a raw utility rather than a tone class. */
const HOVER_BG = /(?<![\w-])hover:!?bg-[^\s"'`{}]+/g;

/**
 * What `<Button variant="x">` actually paints, read out of button.tsx rather
 * than restated here.
 *
 * Without this, a `<Button variant="ghost">` looks classless to a tag scanner
 * and gets reported as having no hover treatment — when `ghost` IS
 * `.ctl-tint`, applied one file away. Two of the exit controls are written
 * that way, so a scanner blind to the variant map would have filed the
 * app's shared primitive as the offender and missed the real ones.
 */
export function buttonVariantClasses() {
  const out = new Map();
  let src;
  try {
    src = stripComments(readFileSync("src/components/ui/button.tsx", "utf8"));
  } catch {
    return out;
  }
  const block = /variant:\s*\{([\s\S]*?)\n\s{6}\}/.exec(src);
  const body = block?.[1] ?? src;
  for (const m of body.matchAll(/(\w+):\s*(?:cn\()?\s*"([^"]*)"/g)) out.set(m[1], m[2]);
  return out;
}
const BUTTON_VARIANTS = buttonVariantClasses();
const VARIANT_PROP = /\bvariant\s*=\s*"([^"]*)"/;

/** Radix parts that ARE a dismissal by construction. */
const CLOSE_PART = /Primitive\.Close$|^DialogClose$|^SheetClose$|^AlertDialogCancel$|^PopoverClose$/;

export function scan(files) {
  const controls = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const src = stripComments(raw);
    for (const m of src.matchAll(CONTROL_TAG)) {
      const name = m[1];
      const tag = openingTag(src, m.index);
      const body = elementBody(src, m.index, tag, name);
      const label = LABEL.exec(tag)?.[1] ?? "";

      // A value edit is never a back control, however it is drawn.
      if (VALUE_EDIT_LABEL.test(label)) continue;

      const isClosePart = CLOSE_PART.test(name);
      const isBackButton = name === "BackButton";
      const hasExitGlyph = EXIT_GLYPH.test(body);
      const hasExitLabel = EXIT_LABEL.test(label);
      const goesBack = GO_BACK_CALL.test(tag);
      const text = isBackButton ? "" : visibleText(body);
      if (VALUE_EDIT_LABEL.test(text)) continue;
      const saysExit = EXIT_LABEL.test(text);

      // A Close part with `asChild` paints nothing — it hands its behaviour to
      // whatever it wraps, which is inventoried in its own right.
      if (isClosePart && /\basChild\b/.test(tag)) continue;

      // THE GATE — four independent ways to be an exit, because the app spells
      // one gesture four ways and any single test misses some of them: it IS
      // the back primitive; it IS a Radix Close part; it SAYS it (accessible
      // name or visible word); or it NAVIGATES backwards.
      //
      // A GLYPH IS DELIBERATELY NOT ONE OF THEM. A left chevron means "back"
      // only about half the time here — the other half it pages WITHIN the
      // surface ("Previous photo" in the lightbox, "Previous month" on the
      // schedule), and those must keep their own treatment, because a paging
      // arrow is not a way out. Gating on the glyph pulled both in.
      const isBack = isBackButton || isClosePart || hasExitLabel || saysExit || goesBack;
      if (!isBack) continue;
      // A control that says nothing and draws nothing exit-shaped is noise the
      // gate let through on a `navigate(-1)` inside an unrelated handler.
      if (!isBackButton && !isClosePart && !hasExitGlyph && !text) continue;

      const line = src.slice(0, m.index).split("\n").length;
      // A `<Button>` inherits its variant's classes; fold them in so the tag
      // is scanned against what the browser will actually see.
      const variant = name === "Button" ? VARIANT_PROP.exec(tag)?.[1] : undefined;
      const inherited = variant ? (BUTTON_VARIANTS.get(variant) ?? "") : "";
      const declared = `${tag} ${inherited}`;
      // The WHOLE body, never a slice: dialog.tsx's X carries
      // `group-hover:-translate-y-0.5` ~600 bytes past its opening tag, behind
      // a wall of comments that stripComments blanks but does not shorten. A
      // truncated body reported the app's most-rendered dismiss as motionless.
      const classes = tag + " " + body;
      controls.push({
        file,
        line,
        what: `<${name}>`,
        label,
        /** "icon" = bare-glyph chrome (the shape rule). "labelled" = a word. */
        kind: text ? "labelled" : "icon",
        text,
        variant,
        radii: [...new Set([...tag.matchAll(RADIUS)].map((x) => x[0].replace("!", "")))],
        hoverMove: [...new Set([...classes.matchAll(HOVER_MOVE)].map((x) => x[0]))],
        tones: [...new Set([...declared.matchAll(TONE)].map((x) => x[1]))],
        hoverBg: [...new Set([...declared.matchAll(HOVER_BG)].map((x) => x[0]))],
      });
    }
  }
  return controls.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
}

export function inventory(root = ROOT) {
  const controls = scan(walk(root));
  const tally = (key) => {
    const out = {};
    for (const c of controls) {
      const k = c[key].length ? c[key].join(" ") : "(none)";
      (out[k] ??= []).push(`${c.file}:${c.line}`);
    }
    return out;
  };
  return { controls, byShape: tally("radii"), byMotion: tally("hoverMove"), byTone: tally("tones") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inv = inventory();
  if (process.argv.includes("--summary")) {
    console.log(`${inv.controls.length} back/dismiss controls\n`);
    for (const [k, v] of Object.entries(inv.byShape).sort((a, b) => b[1].length - a[1].length))
      console.log(`SHAPE  ${String(v.length).padStart(3)}  ${k}\n${v.map((x) => "        " + x).join("\n")}`);
    console.log("");
    for (const [k, v] of Object.entries(inv.byMotion).sort((a, b) => b[1].length - a[1].length))
      console.log(`MOTION ${String(v.length).padStart(3)}  ${k}\n${v.map((x) => "        " + x).join("\n")}`);
    console.log("");
    for (const [k, v] of Object.entries(inv.byTone).sort((a, b) => b[1].length - a[1].length))
      console.log(`TONE   ${String(v.length).padStart(3)}  ${k}`);
  } else {
    console.log(JSON.stringify(inv, null, 2));
  }
}
