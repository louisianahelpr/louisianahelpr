// NEVER ROLE-BASED, IN THE COPY TOO.
//
// CLAUDE.md: "Every account posts and does jobs; every feature shows to
// everyone. Role bleed is not a bug, role-gating is never the fix, and copy
// addressing only Helprs or only posters is a defect."
//
// The owner-reported defects this guards the CLASS of (2026-09-15):
//   * RPC_ERROR_COPY.helper_cancel_booking.job_already_started said
//     "message the poster or contact support instead".
//   * recipientGate.ts said "only the poster…" / "Only the job's poster…".
// Both name a role as an identity. The rule is to name the other party by what
// they DID on this job: "the person who posted this job", "the person doing
// this job".
//
// TWO RULES, because the two words are not the same:
//
//   1. "poster" / "posters" / "customer" / "customers" — there is no approved
//      use in copy. The app's own replacement already exists in
//      RPC_ERROR_COPY ("Only the person who posted this job can do that").
//      So any of these in user-visible copy is a finding.
//
//   2. "Helpr" / "helper" — "Helpr" is the APPROVED noun for the person doing
//      a job and is also the brand (see helprNotHelperInCopy.test.ts, which
//      requires that spelling). So the bare noun is fine, and only
//      IDENTITY constructions are findings: "as a Helpr" (a thing you are),
//      "Helprs only" (a class a feature is gated to), "Helpr mode" (a mode you
//      switch into), "you're a Helpr". Note these are matched on the plural or
//      with an article, so the app name — "off for Helpr", "browsing Helpr",
//      "waiting for Helpr to review" — never trips them.
//
// Scope, exactly as helprNotHelperInCopy.test.ts does it: the TypeScript AST of
// every non-test file in src/, inspecting only STRING CONTENT (string literals,
// template text, JSX text). Identifiers (`posterId`), object keys, column and
// enum values (`"poster"` as a `who` discriminant — one lowercase token, no
// whitespace), comments, imports and log/console arguments are not copy.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ROLE_COPY_ALLOWLIST, isAllowedRoleCopy } from "./roleNeutralCopy.allowlist";

const ROOT = path.resolve(__dirname, "../..");
// supabase/functions since 2026-09-15 (owner decision): push, email and error
// copy written by edge functions reaches users exactly like src/ copy does.
// Admin-only and log-only strings there are allowlisted with reasons.
const SCAN_DIRS = ["src", "supabase/functions"];
// Files outside src/ whose strings the app renders as its own copy. The arrival
// rule's messages live in the edge runtime's _shared folder so create-payment
// and the app read one predicate, and src/lib/arrivalGate.ts re-exports
// `arrivalGateMessage` straight onto the tracker and the payout CTA.
const SCAN_FILES = ["supabase/functions/_shared/arrivalRule.ts"];

// Rule 1: a standalone role noun, not part of a path, identifier, hyphenated
// key or PostgREST embed (`customer:profiles!…`, `customer_id`, `poster-tier`).
const ROLE_NOUN = /(^|[^A-Za-z0-9_$./\\-])(posters?|customers?)(?![A-Za-z0-9_$/\\:(-])/i;

// Rule 2: role-as-identity constructions, for either side of a job.
const IDENTITY = [
  /\bas an? (helpr|poster|customer)s?\b/i,
  /\b(helpr|poster|customer)s? only\b/i,
  // A quoted role word still reads as a mode: `no separate "Helpr" mode`.
  /\b(helpr|poster|customer)s?["'”’]? mode\b/i,
  /\byou(?:'|’)?re an? (helpr|poster|customer)\b/i,
  /\bif you(?:'|’)?re an? (helpr|poster|customer)\b/i,
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "tests") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

// Calls whose string arguments only ever reach a log, the ops Slack channel or
// a cron's internal result — never a user's screen, inbox or push.
const INTERNAL_CALLEES = new Set([
  "log", "logStep", "record", "markFailed", "releaseClaimForRetry",
  "postSlackOpsAlert", "scanAll", "scanAllIn", "scanDefect", "cronResult",
]);

/**
 * True when this literal is INTERPOLATED INTO TEXT, so a bare role token with no
 * whitespace is still a word the user reads.
 *
 * `Job cancelled by ${who === "poster" ? "poster" : "Helpr"}.` shipped for
 * months and the first version of this guard walked straight past it: the copy
 * is "poster", one lowercase token, which the isCopy rule below treats as a
 * column name or an enum value. It is neither — it is the tail of a sentence.
 *
 * Only VALUE positions count. In that same template the first `"poster"` is the
 * right-hand side of `===`, a discriminant being compared and never rendered;
 * the second is the branch's result and is rendered. So walk up only through the
 * positions whose value becomes the interpolated text — a conditional's
 * branches, `||`/`??` operands, parentheses — and stop at anything else.
 */
function isInterpolatedIntoText(node: ts.Node): boolean {
  let cur: ts.Node = node;
  for (let p = cur.parent; p; cur = p, p = p.parent) {
    if (ts.isParenthesizedExpression(p)) continue;
    if (ts.isConditionalExpression(p) && (p.whenTrue === cur || p.whenFalse === cur)) continue;
    if (
      ts.isBinaryExpression(p) &&
      (p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      (p.left === cur || p.right === cur)
    ) {
      continue;
    }
    // Reached the slot itself: `${…}` in a template, or {…} inside JSX.
    if (ts.isTemplateSpan(p)) return p.expression === cur;
    // A JSX slot is text only as a CHILD. As an attribute initializer
    // (`side={… ? "helper" : "poster"}`, `audience={…}`) it is a prop
    // discriminant the user never reads.
    if (ts.isJsxExpression(p)) {
      if (p.expression !== cur) return false;
      const host = p.parent;
      return host !== undefined && (ts.isJsxElement(host) || ts.isJsxFragment(host));
    }
    return false;
  }
  return false;
}

function isInternalOnly(node: ts.Node): boolean {
  // An object key ("Customer ID": id) names a field, it is not a sentence.
  if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node) return true;
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "console") return true;
        if (INTERNAL_CALLEES.has(callee.name.text)) return true;
      } else if (ts.isIdentifier(callee) && INTERNAL_CALLEES.has(callee.text)) return true;
    }
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** The reason this string is a finding, or null when it is clean. */
function verdict(trimmed: string): string | null {
  if (IDENTITY.some((re) => re.test(trimmed))) return "names a role as an identity";
  if (ROLE_NOUN.test(trimmed)) return "addresses or names a party by role";
  return null;
}

export type RoleCopyHit = { file: string; line: number; why: string; text: string };

/**
 * Every role-naming string in this file, BEFORE the allowlist is applied.
 *
 * The allowlist is subtracted by `findRoleCopy`. Keeping the raw scan separate
 * is what lets the allowlist itself be checked: an entry that no longer
 * suppresses anything is a standing exemption over copy that has since been
 * rewritten or deleted, and it would silently widen the next time that file
 * grew a role word.
 */
export function scanRoleCopy(fileName: string, source: string): RoleCopyHit[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relFile = path.relative(ROOT, fileName);
  const hits: RoleCopyHit[] = [];
  const check = (node: ts.Node, text: string) => {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    // Keys, column names and enum values are single lowercase tokens with no
    // whitespace ("poster", "helper_id"); a capitalised standalone word is a
    // visible label ("Poster") and does count — and so does a bare token that is
    // interpolated into a sentence.
    const isCopy =
      /\s/.test(trimmed) ||
      /^(Posters?|Customers?|Helprs?|Helpers?)$/.test(trimmed) ||
      (/^(posters?|customers?|helprs?|helpers?)$/i.test(trimmed) && isInterpolatedIntoText(node));
    if (!isCopy) return;
    const why = verdict(trimmed);
    if (!why) return;
    if (isInternalOnly(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ file: relFile, line: line + 1, why, text: trimmed });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) check(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** The findings: every role-naming string the allowlist does not excuse. */
export function findRoleCopy(fileName: string, source: string): string[] {
  return scanRoleCopy(fileName, source)
    .filter((h) => !isAllowedRoleCopy(h.file, h.text))
    .map((h) => `${h.file}:${h.line}: ${h.why} — ${h.text.slice(0, 120)}`);
}

/** Every file the guard scans, derived from the tree — never a hand-typed list. */
function scannedFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  files.push(...SCAN_FILES.map((p) => path.join(ROOT, p)));
  return files;
}

describe("user-visible copy names what someone did on a job, never a role", () => {
  const f = (name: string) => path.join(ROOT, name);

  it("catches the two owner-reported defects (can fail)", () => {
    // RPC_ERROR_COPY.helper_cancel_booking.job_already_started, as it shipped.
    expect(
      findRoleCopy(f("src/lib/x.ts"), `const c = { job_already_started: "The start time has passed — message the poster or contact support instead." };`),
    ).toHaveLength(1);
    // recipientGate.ts, both strings, as they shipped.
    expect(
      findRoleCopy(
        f("src/lib/x.ts"),
        `export const A = "You can't send messages in this conversation. On this job, only the poster can message applicants and anyone with a pending offer.";\n` +
          `export const B = "Only the job's poster can message this person, so the message wasn't sent.";`,
      ),
    ).toHaveLength(2);
  });

  it("catches the whole class, not just those two strings (can fail)", () => {
    const cases = [
      `const t = "Posters love you.";`,
      `const t = "Stand out to posters with a verified badge";`,
      `const a = <p>Waiting for the poster to confirm</p>;`,
      "const t = `The poster has ${n} hours to approve`;",
      `const t = "Refunding the customer means the platform absorbs the loss";`,
      `const t = "As a Helpr";`, // role held as an identity
      `const t = "Helprs only";`, // a feature gated to a class
      `const t = 'There is no separate "Helpr" mode here';`,
      `const t = "Poster";`, // a bare visible label
      // A bare token INTERPOLATED into a sentence. This exact shape shipped in
      // jobSystemEvents.ts and the first version of this guard walked past it.
      'const t = `Job cancelled by ${who === "poster" ? "poster" : "Helpr"}.`;',
      `const a = <p>Opened by {who === "helper" ? "the Helpr" : "poster"}.</p>;`,
    ];
    for (const src of cases) {
      expect(findRoleCopy(f("src/components/X.tsx"), src), src).toHaveLength(1);
    }
  });

  it("covers edge-function copy too: the 2026-09-15 backend strings as they shipped (can fail)", () => {
    const shipped = [
      // create-payment, the Helpr's notification when revisions are requested.
      'await db.from("notifications").insert({ message: `The poster has requested revisions on "${job.title}": ${note}` });',
      // create-payment, a tip attempt by anyone else.
      'throw new Error("Only the customer can tip the Helpr");',
      // review-nag-cron, what the Helpr was asked to review.
      '{ user_id: job.helper_id, reviewing: "the customer", surface: "/jobs" }',
    ];
    for (const src of shipped) {
      expect(findRoleCopy(f("supabase/functions/create-payment/index.ts"), src), src).toHaveLength(1);
    }
  });

  it("leaves job-relative wording, the brand and non-copy alone", () => {
    const clean = [
      // The approved replacements.
      `const t = "Only the person who posted this job can do that.";`,
      `const t = "message the person who posted this job, or contact support if you can't reach them.";`,
      `const t = "the person doing this job";`,
      // "Helpr" as the approved noun, and as the app's own name.
      `const t = "Goes straight to the Helpr — no platform cut.";`,
      `const t = "Hire a Helpr or find local work";`,
      `const t = "Microphone access is off for Helpr. Turn it on in Settings.";`,
      `const t = "the feed for Helprs near you";`,
      // Identifiers, keys, columns, enum discriminants, comments, logs.
      `const posterId = row.customer_id; const w = "poster"; const k = { "Customer ID": id };`,
      `const q = supabase.from("jobs").select("customer:profiles!jobs_customer_id_fkey(full_name)");`,
      `// the poster sees this\nconsole.log("poster missing", posterId);`,
      `postSlackOpsAlert({ message: "the poster is unpaid" });`,
      // A discriminant COMPARED inside a template is never rendered, and a JSX
      // attribute is a prop, not text — both were false positives once.
      'const t = `Cancelled by ${who === "poster" ? "the person who posted it" : "the Helpr"}.`;',
      `const a = <DisputeDialog side={job.helper_id === uid ? "helper" : "poster"} />;`,
      `const a = <QuickReplies audience={isPoster ? "poster" : "helper"} />;`,
    ];
    for (const src of clean) {
      expect(findRoleCopy(f("src/components/X.tsx"), src), src).toEqual([]);
    }
  });

  it("every allowlist entry carries a reason and still matches something", () => {
    // The title used to promise the second half and the body only checked the
    // first, so a stale exemption could not fail: once the copy an entry was
    // written for is rewritten or deleted, the entry stays, standing open over
    // whatever that file (or path prefix) grows next. Both halves now hold.
    const raw = scannedFiles().flatMap((file) => scanRoleCopy(file, readFileSync(file, "utf8")));
    expect(raw.length, "raw scan found nothing — the allowlist check would pass vacuously").toBeGreaterThan(10);
    for (const e of ROLE_COPY_ALLOWLIST) {
      expect(e.reason.trim().length, `allowlist entry for ${e.file} needs a reason`).toBeGreaterThan(20);
      const suppressed = raw.filter(
        (h) => h.file.startsWith(e.file) && (e.text === undefined || h.text.includes(e.text)),
      );
      expect(
        suppressed.length,
        `the allowlist entry for ${e.file}${e.text ? ` ("${e.text}")` : ""} no longer excuses any copy.\n` +
          `Delete it: a standing exemption over copy that no longer exists silently widens\n` +
          `the moment that file grows a role word again.`,
      ).toBeGreaterThan(0);
    }
  });

  it("no source file ships copy that names a role", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(500);
    const hits = files.flatMap((file) => findRoleCopy(file, readFileSync(file, "utf8")));
    expect(
      hits,
      `Name the other party by what they did on THIS job ("the person who posted this job",\n` +
        `"the person doing this job"), never by a role. If an exception is genuinely right,\n` +
        `add it to src/test/roleNeutralCopy.allowlist.ts WITH A REASON.\n\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

// Proof this guard can fail: restore the owner-reported defect verbatim — the
// lifecycle error that named a role instead of what the person did on the job.
// @mutate src/lib/lifecycleErrors.ts |   not_authorized: "Only the person who posted this job can do that.", |   not_authorized: "Only the poster can do that.",
