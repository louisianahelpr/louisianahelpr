/*
 * CLASS CHECK — "the screen said one number, Stripe charged another."
 *
 * ORIGIN. On 2026-09-20 the gift-card flow let a buyer type 10.555, showed
 * "$10.555", and charged $10.56: the client sent raw dollars and the server
 * resolved the fractional cent with `Math.round(x * 100)`, silently. Fixed at
 * GiftCard.tsx. The burn-down then found the SAME shape in three more places
 * (all measured 2026-09-21, all fixed with this guard):
 *
 *   - TipDialog.tsx          sent a typed tip raw to create-payment
 *   - CompletionPrompts.tsx  sent a typed tip raw to create-payment
 *   - auto-tip-charge        charged Math.round(x*100) but RECORDED raw dollars
 *                            in `tips.amount`, so the receipt and the charge
 *                            disagreed with nothing to reconcile them
 *
 * WHY IT KEEPS HAPPENING — the two halves are far apart and both look right.
 * `CurrencyInput` deliberately formats with `toString`, not `toFixed`, so the
 * user can keep editing a trailing digit; that is correct for an input and
 * fatal for a payload. And `jobs.budget` is numeric(10,2) — the column rounds —
 * so the commonest money path is protected by accident, which is exactly why
 * nobody notices the unprotected ones. Verified live 2026-09-21: `tips.amount`,
 * `profiles.auto_tip_value`, `profiles.auto_tip_cap`, `jobs.urgent_fee`,
 * `jobs.customer_fee_amount` and `referral_credits.amount` are all bare
 * `numeric` with NO scale, so each stores a fractional cent intact.
 *
 * THE RULE, in two halves:
 *   A. CLIENT — a dollar figure the user typed must be rounded to whole cents
 *      before it is handed to a payment function.
 *   B. SERVER — when a function both charges cents and records dollars, the
 *      recorded dollars must be DERIVED from the charged cents (`c / 100`),
 *      never rounded a second time from the same input. One rounding, two
 *      readers: they cannot drift however the rule later changes.
 *
 * A CHECK constraint was considered and rejected: it would refuse the `tips`
 * insert AFTER the card was charged, turning a display bug into lost money.
 *
 * INVENTORY-DERIVED, not a list. Half A walks every caller of a payment edge
 * function found in src/; half B walks every edge function that computes
 * Stripe cents. A new screen or function enters the check by existing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "test" || e === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

const rel = (p: string) => p.slice(REPO.length + 1);

/** Blank comments and string literals, PRESERVING offsets and line count, so a
 * match is real code. A deleting regex would shift every later offset and, as
 * this repo learned the hard way, can eat a live value that follows a URL on
 * the same line. */
function blankNonCode(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blankTo = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i; while (j < n && src[j] !== "\n") j++;
      blankTo(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blankTo(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      blankTo(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

/** Comments only, strings PRESERVED. The write-scan below needs the table name
 * inside `.from("tips")`, which `blankNonCode` (correctly, for its own callers)
 * blanks away. */
function blankComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blankTo = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i; while (j < n && src[j] !== "\n") j++;
      blankTo(i, j); i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blankTo(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    // Skip over string bodies without touching them, so a "//" inside a URL
    // literal is not mistaken for a comment.
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------- half A ----

/** Payment functions that accept a dollar figure from the client. `release`,
 * `resolve_revision` and the admin refund actions take no client amount, so a
 * caller that passes none is simply not in the inventory. */
const PAYMENT_FNS = ["create-payment", "create-gift-card-checkout", "create-boost-payment"];

interface Caller { file: string; line: number; expr: string }

/** Every place src/ hands an `amount` to a payment edge function. */
function amountCallers(): Caller[] {
  const found: Caller[] = [];
  for (const file of walk(join(REPO, "src"))) {
    const raw = readFileSync(file, "utf8");
    if (!PAYMENT_FNS.some((f) => raw.includes(`functions.invoke("${f}"`))) continue;
    const code = blankNonCode(raw);
    // The invoke and its body may be several lines apart; scan the ~12 lines
    // after each invoke for an `amount` key in the request body.
    const lines = code.split("\n");
    lines.forEach((ln, idx) => {
      if (!PAYMENT_FNS.some((f) => ln.includes("functions.invoke(") && raw.split("\n")[idx].includes(f))) return;
      const window = lines.slice(idx, idx + 12).join("\n");
      const m = /\bamount\s*:\s*([^,}\n]+)|body\s*:\s*\{[^}]*?\b(amount)\b\s*[,}]/.exec(window);
      if (!m) return;
      found.push({ file: rel(file), line: idx + 1, expr: (m[1] ?? m[2] ?? "").trim() });
    });
  }
  return found;
}

/** A caller is safe if the file rounds to whole cents somewhere — the
 * `Math.round(x * 100) / 100` idiom — or passes a value already in cents. */
function roundsToWholeCents(file: string): boolean {
  const code = blankNonCode(readFileSync(join(REPO, file), "utf8"));
  return /Math\.round\(\s*[A-Za-z_$][\w$.?\s]*\*\s*100\s*\)\s*\/\s*100/.test(code);
}

describe("whole-cent parity: what the screen shows is what Stripe charges", () => {
  const callers = amountCallers();

  it("the inventory is non-empty (a check that finds nothing cannot fail)", () => {
    // If the walker or the invoke-matcher breaks, every assertion below passes
    // vacuously. Pin the three known tip/gift entry points by name.
    const files = new Set(callers.map((c) => c.file));
    expect(files.has("src/components/TipDialog.tsx")).toBe(true);
    expect(files.has("src/components/CompletionPrompts.tsx")).toBe(true);
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  /*
   * useJobSubmit / useFundExistingJob are NOT exempt by name — they pass no
   * `amount` at all (the server reads `jobs.budget`, a numeric(10,2) column),
   * so they never enter the inventory. If one ever starts sending a client
   * amount it appears here and must round, which is the whole point.
   */
  it.each(callers.map((c) => [c.file, c.line] as const))(
    "%s:%s rounds a user-entered dollar amount to whole cents before sending",
    (file) => {
      expect(
        roundsToWholeCents(file),
        `${file} hands a dollar figure to a payment function without rounding it to whole cents. ` +
          "The server does Math.round(amount * 100), so a typed 10.555 is billed as $10.56 while " +
          "the screen still reads $10.555. Round with Math.round(x * 100) / 100 before sending.",
      ).toBe(true);
    },
  );

  // -------------------------------------------------------------- half B ----

  /** Edge functions that both compute Stripe cents and write a dollar figure. */
  const edgeDir = join(REPO, "supabase", "functions");

  /**
   * Edge functions that BOTH compute Stripe cents AND write a dollar figure to
   * a money table.
   *
   * Scoped to `.from("t").insert({...})` / `.update({...})` on purpose. A first
   * cut matched every `amount:` key and flagged six functions that were correct:
   * `execute-dispute-split` passes `amount: helperCents` to the Stripe API, and
   * `create-payment` passes `amount: requestedCents` — those are Stripe's own
   * cents field, not a dollar column. The rule only says anything about a
   * number being PERSISTED in dollars beside a charge in cents.
   */
  const MONEY_WRITE_RE = /\.from\(\s*["'`](\w+)["'`]\s*\)[\s\S]{0,120}?\.(insert|update|upsert)\(\s*\{([\s\S]{0,600}?)\}/g;

  /** A cents variable: declared as `Math.round(<dollars> * 100)`, or named
   * `*Cents` (the repo's consistent convention, e.g. helperCents/refundCents). */
  function centsVarsOf(code: string): Set<string> {
    const v = new Set<string>();
    for (const m of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*Math\.round\(\s*[\w.?\s]+\*\s*100\s*\)/g)) v.add(m[1]);
    for (const m of code.matchAll(/(?:const|let)\s+(\w*[Cc]ents)\s*=/g)) v.add(m[1]);
    return v;
  }

  /** Is `expr` derived from whole cents — directly, or through ONE alias whose
   * own declaration divides a cents variable by 100? `tipDollars = tipCents /
   * 100` is the correct shape and must not be flagged. */
  function derivedFromCents(expr: string, code: string, cents: Set<string>): boolean {
    const direct = (e: string) => [...cents].some((v) => new RegExp(`\\b${v}\\b\\s*/\\s*100`).test(e));
    if (direct(expr)) return true;
    const ident = /^[A-Za-z_$][\w$]*$/.exec(expr.trim())?.[0];
    if (!ident) return false;
    if (cents.has(ident)) return true; // already cents — not a dollar write
    const decl = new RegExp(`(?:const|let)\\s+${ident}\\s*=\\s*([^;\\n]+)`).exec(code);
    return decl ? direct(decl[1]) : false;
  }

  const recordsDollarsBesideCents = (): { fn: string; ok: boolean; detail: string }[] => {
    const out: { fn: string; ok: boolean; detail: string }[] = [];
    for (const entry of readdirSync(edgeDir)) {
      const idx = join(edgeDir, entry, "index.ts");
      let raw: string;
      try { raw = readFileSync(idx, "utf8"); } catch { continue; }
      const code = blankNonCode(raw);   // identifiers + declarations
      const writes = blankComments(raw); // table names survive
      const cents = centsVarsOf(code);
      if (![...code.matchAll(/Math\.round\(\s*[\w.?\s]+\*\s*100\s*\)/g)].length) continue;
      const bad: string[] = [];
      let seenWrite = false;
      for (const m of writes.matchAll(MONEY_WRITE_RE)) {
        const body = m[3];
        const am = /(?<![\w_])amount\s*:\s*([^,}\n]+)/.exec(body);
        if (!am) continue;
        seenWrite = true;
        const expr = am[1].trim();
        if (/^\d+$/.test(expr)) continue; // literal
        if (!derivedFromCents(expr, code, cents)) bad.push(`${m[1]}.amount = ${expr}`);
      }
      if (!seenWrite) continue;
      out.push({ fn: entry, ok: bad.length === 0, detail: bad.join("; ") });
    }
    return out;
  };

  const edgeCases = recordsDollarsBesideCents();

  it("the edge inventory is non-empty", () => {
    const names = edgeCases.map((e) => e.fn);
    expect(names, "expected the two tip chargers to be found").toEqual(
      expect.arrayContaining(["auto-tip-charge", "create-payment"]),
    );
  });

  it.each(edgeCases.map((e) => [e.fn] as const))(
    "%s records dollars derived from the cents it charges",
    (fn) => {
      const c = edgeCases.find((e) => e.fn === fn)!;
      expect(
        c.ok,
        `supabase/functions/${fn}/index.ts charges Math.round(x * 100) cents but records the dollar ` +
          `figure independently (${c.detail}). Those two numbers can disagree — a 10.555 input bills ` +
          "$10.56 and records 10.555. Write `amount: <centsVar> / 100` so one rounding feeds both.",
      ).toBe(true);
    },
  );
});

// PROVEN RED 2026-09-21 (both halves, each mutation run alone):
//   A. TipDialog.tsx `Math.round(rawTip * 100) / 100` -> `rawTip`
//      => "src/components/TipDialog.tsx:59 rounds a user-entered dollar amount" FAILS.
//   B. auto-tip-charge `const tipDollars = tipCents / 100;` -> `= rawTipDollars;`
//      => "auto-tip-charge records dollars derived from the cents it charges" FAILS.
// SOURCE-TEXT PIN: this reads repo source, not the deployed function or the
// rendered screen. An edge function hand-deployed out of step with main, or a
// money column whose scale is changed in the dashboard, is invisible to it.
// @mutate src/components/TipDialog.tsx | const tipAmount = Math.round(rawTip * 100) / 100; | const tipAmount = rawTip;
// @mutate supabase/functions/auto-tip-charge/index.ts | const tipDollars = tipCents / 100; | const tipDollars = rawTipDollars;
